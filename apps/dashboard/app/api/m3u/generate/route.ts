import { dirname, resolve as pathResolve } from 'node:path'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { generateM3uContent, sanitizeM3uFileName } from '@/lib/recalbox/m3u-generator'
import type { MultiDiscGame } from '@/lib/recalbox/multidisc-detector'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GenerateRequest = {
	recalboxId?: string
	games: Array<
		Pick<MultiDiscGame, 'system' | 'baseName' | 'romsDir' | 'discs'> & { force?: boolean }
	>
}

type GenerateResult = {
	system: string
	baseName: string
	m3uFileName: string
	status: 'created' | 'skipped' | 'error'
	reason?: 'already_exists'
	error?: string
}

type WriteSpec = {
	system: string
	baseName: string
	m3uFileName: string
	m3uPath: string
	content: string
	force: boolean
}

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	const body: GenerateRequest = await req.json()
	if (!Array.isArray(body?.games)) {
		return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
	}
	if (body.games.length > 200) {
		return NextResponse.json({ error: 'Too many games in one request (max 200)' }, { status: 413 })
	}
	const recalboxId = body.recalboxId ?? (await getActiveRecalboxId())
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const ssh = getSshClient(recalboxId)
	const results: GenerateResult[] = []
	const specs: WriteSpec[] = []

	// Step 1: validate all games and compute write specs
	for (const gameReq of body.games) {
		const { system, baseName, romsDir, discs, force = false } = gameReq
		const m3uFileName = sanitizeM3uFileName(baseName)
		const normalizedDir = pathResolve(romsDir)

		if (!normalizedDir.startsWith('/recalbox/')) {
			results.push({ system, baseName, m3uFileName, status: 'error', error: 'Invalid romsDir' })
			continue
		}

		const game: MultiDiscGame = {
			system,
			baseName,
			m3uFileName,
			romsDir,
			discs: discs.toSorted((a, b) => a.discNumber - b.discNumber),
			m3uAlreadyExists: false,
			hasGap: false,
		}

		specs.push({
			system,
			baseName,
			m3uFileName,
			m3uPath: `${normalizedDir}/${m3uFileName}`,
			content: generateM3uContent(game),
			force,
		})
	}

	if (specs.length === 0) {
		const summary = { created: 0, skipped: 0, errors: results.length }
		return NextResponse.json({ results, summary })
	}

	// Step 2: single SSH call to find which m3u files already exist
	const existingFiles = new Set<string>()
	try {
		const uniqueDirs = [...new Set(specs.map((s) => dirname(s.m3uPath)))]
		const dirArgs = uniqueDirs.map((d) => shellQuote(d)).join(' ')
		const output = await ssh.exec(`find ${dirArgs} -maxdepth 1 -name '*.m3u' 2>/dev/null || true`)
		for (const line of output.split('\n').flatMap((s) => {
			const t = s.trim()
			return t ? [t] : []
		})) {
			existingFiles.add(line)
		}
	} catch (err) {
		logger.error('m3u: failed to check existing files', err)
		// fall through — treat all as new files
	}

	// Step 3: split specs into skip vs write
	const toWrite: WriteSpec[] = []
	for (const spec of specs) {
		if (existingFiles.has(spec.m3uPath) && !spec.force) {
			results.push({
				system: spec.system,
				baseName: spec.baseName,
				m3uFileName: spec.m3uFileName,
				status: 'skipped',
				reason: 'already_exists',
			})
		} else {
			toWrite.push(spec)
		}
	}

	// Step 4: single SSH call to write all files that need writing
	if (toWrite.length > 0) {
		const writeCommands = toWrite.map((spec) => {
			const b64 = Buffer.from(spec.content).toString('base64')
			return `printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(spec.m3uPath)}`
		})
		try {
			await ssh.exec(writeCommands.join(';'))
			for (const spec of toWrite) {
				logger.info(`m3u: created ${spec.m3uPath}`)
				results.push({
					system: spec.system,
					baseName: spec.baseName,
					m3uFileName: spec.m3uFileName,
					status: 'created',
				})
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			logger.error('m3u: batch write failed', err)
			for (const spec of toWrite) {
				results.push({
					system: spec.system,
					baseName: spec.baseName,
					m3uFileName: spec.m3uFileName,
					status: 'error',
					error: message,
				})
			}
		}
	}

	const summary = {
		created: results.filter((r) => r.status === 'created').length,
		skipped: results.filter((r) => r.status === 'skipped').length,
		errors: results.filter((r) => r.status === 'error').length,
	}

	return NextResponse.json({ results, summary })
}
