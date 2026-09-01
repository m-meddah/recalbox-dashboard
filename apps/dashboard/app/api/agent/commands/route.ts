import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { resolveTargetVersion } from '@/lib/agent/rollout'
import { readRolloutSettings } from '@/lib/agent/rollout-settings'
import { db } from '@/lib/db'
import { claimPendingCommands } from '@/lib/db/agent-commands'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { readAgentChannel } from '@/lib/db/agent-rollout-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Agent poll: returns pending commands for the token's Recalbox and atomically
// claims them so each is delivered once. Outbound from the box → NAT-friendly.
// It also carries the version this box must converge to — riding this existing
// round-trip rather than adding a second one, since each poll is a billed
// serverless invocation.
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const currentVersion = getAgentVersion(req)
	const resolved = await resolveAgentToken(db, token, currentVersion)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	const commands = await claimPendingCommands(db, resolved.recalboxId)
	return NextResponse.json({
		commands: commands.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {} })),
		agent: { target_version: await targetFor(resolved.recalboxId, currentVersion) },
	})
}

/**
 * La cible de cette box, ou `null`. Une panne du mécanisme de déploiement ne
 * doit pas emporter la remontée des commandes : le contrôle à distance est la
 * promesse la plus ancienne et la plus importante de cette route.
 */
async function targetFor(recalboxId: string, currentVersion: string | null) {
	try {
		const [channel, settings] = await Promise.all([
			readAgentChannel(db, recalboxId),
			readRolloutSettings(),
		])
		return resolveTargetVersion({
			channel,
			recalboxId,
			currentVersion,
			targetVersion: settings.targetVersion,
			rolloutPercent: settings.rolloutPercent,
		})
	} catch (err) {
		logger.error('[agent] rollout resolution failed', err)
		return null
	}
}
