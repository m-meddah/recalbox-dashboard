import { readAgentVersion } from '@/lib/agent/payload'
import { readRolloutSettings, writeRolloutSettings } from '@/lib/agent/rollout-settings'
import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { readFleetVersions } from '@/lib/db/agent-rollout-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Commandes de déploiement du parc. Au premier niveau et NON sous `/api/agent/`,
// qui désigne les routes authentifiées par jeton de machine : y glisser une
// route à session humaine invite à confondre les deux modèles d'authentification.
export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const [deployedVersion, settings, versions] = await Promise.all([
		readAgentVersion(),
		readRolloutSettings(),
		readFleetVersions(db),
	])
	return NextResponse.json({ deployedVersion, ...settings, versions })
}

const updateSchema = z.object({
	targetVersion: z.string().min(1).max(32).optional(),
	rolloutPercent: z.number().int().min(0).max(100).optional(),
})

export async function PUT(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const body = await req.json().catch(() => null)
	const parsed = updateSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })

	if (parsed.data.targetVersion !== undefined) {
		// La cible n'est pas un champ libre. Une faute de frappe enverrait le parc
		// converger vers une version qui n'existe nulle part : personne n'y
		// arriverait, donc rien ne bougerait — une panne parfaitement silencieuse.
		// L'ensemble autorisé se construit tout seul à partir de la télémétrie.
		// La cible précédente en fait partie même si plus aucune box ne la
		// déclare : c'est précisément le cas d'un déploiement arrivé à 100 %, et
		// c'est là que le bouton de rapatriement doit encore fonctionner. Les box
		// la gardent dans leur `backup/` local, donc la demander a un sens.
		const [deployed, fleet, settings] = await Promise.all([
			readAgentVersion(),
			readFleetVersions(db),
			readRolloutSettings(),
		])
		const allowed = new Set([deployed, ...fleet.map((v) => v.version)])
		if (settings.previousTargetVersion) allowed.add(settings.previousTargetVersion)
		if (!allowed.has(parsed.data.targetVersion)) {
			return NextResponse.json(
				{ error: `Unknown target version: ${parsed.data.targetVersion}` },
				{ status: 422 },
			)
		}
	}

	await writeRolloutSettings(parsed.data)
	return NextResponse.json({ ok: true })
}
