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
	reason?: 'already_identical' | 'already_exists'
	error?: string
}

export async function POST(req: NextRequest) {
	const body: GenerateRequest = await req.json()
	if (!Array.isArray(body?.games)) {
		return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
	}
	const recalboxId = body.recalboxId ?? (await getActiveRecalboxId())
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const ssh = getSshClient(recalboxId)
	const results: GenerateResult[] = []

	for (const gameReq of body.games) {
		const { system, baseName, romsDir, discs, force = false } = gameReq
		const m3uFileName = sanitizeM3uFileName(baseName)

		if (!romsDir.startsWith('/recalbox/')) {
			results.push({ system, baseName, m3uFileName, status: 'error', error: 'Invalid romsDir' })
			continue
		}

		const game: MultiDiscGame = {
			system,
			baseName,
			m3uFileName,
			romsDir,
			discs: [...discs].sort((a, b) => a.discNumber - b.discNumber),
			m3uAlreadyExists: false,
			hasGap: false,
		}
		const expectedContent = generateM3uContent(game)
		const m3uPath = `${romsDir}/${m3uFileName}`

		try {
			const existsOutput = await ssh.exec(
				`test -f ${shellQuote(m3uPath)} && echo yes || echo no`,
			)

			if (existsOutput === 'yes' && !force) {
				const existing = await ssh.exec(`cat ${shellQuote(m3uPath)}`)
				const normalised = existing.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
				const clean = normalised.endsWith('\n') ? normalised : normalised + '\n'

				if (clean === expectedContent) {
					results.push({ system, baseName, m3uFileName, status: 'skipped', reason: 'already_identical' })
					continue
				}
				results.push({ system, baseName, m3uFileName, status: 'skipped', reason: 'already_exists' })
				continue
			}

			const b64 = Buffer.from(expectedContent).toString('base64')
			await ssh.exec(`printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(m3uPath)}`)
			logger.info(`m3u: created ${m3uPath}`)
			results.push({ system, baseName, m3uFileName, status: 'created' })
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			logger.error(`m3u: failed to write ${m3uPath}`, err)
			results.push({ system, baseName, m3uFileName, status: 'error', error: message })
		}
	}

	const summary = {
		created: results.filter((r) => r.status === 'created').length,
		skipped: results.filter((r) => r.status === 'skipped').length,
		errors: results.filter((r) => r.status === 'error').length,
	}

	return NextResponse.json({ results, summary })
}
