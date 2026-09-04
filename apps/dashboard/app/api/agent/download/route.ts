import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { readAgentPayload } from '@/lib/agent/payload'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sert le paquet de l'agent embarque par CE deploiement — le seul dont le cloud
 * dispose. Une box qui veut redescendre d'une version restaure sa propre
 * sauvegarde locale et ne passe jamais par ici.
 *
 * Le lanceur `userscripts/` est volontairement absent du paquet : c'est le seul
 * fichier dont la corruption serait irrattrapable.
 */
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	try {
		const payload = await readAgentPayload()
		return NextResponse.json(
			{
				version: payload.version,
				files: {
					'agent.py': payload.agentPy,
					'scan_roms.py': payload.scanRomsPy,
					'launch.py': payload.launchPy,
					'updater.py': payload.updaterPy,
					VERSION: `${payload.version}\n`,
				},
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		)
	} catch (err) {
		// Mieux vaut un 500 qu'un paquet incomplet : l'agent verifie ce qu'il
		// recoit, mais un paquet amputé d'un fichier passerait la compilation.
		logger.error('[agent] download payload read failed', err)
		return NextResponse.json({ error: 'payload_unavailable' }, { status: 500 })
	}
}
