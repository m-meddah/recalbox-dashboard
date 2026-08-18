import { buildInstallerZip } from '@/lib/agent/installer-zip'
import { readAgentPayload } from '@/lib/agent/payload'
import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { createAgentToken } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** Nom de fichier sûr pour l'entête Content-Disposition. */
function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'recalbox'
	)
}

export async function GET(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	// Propriétaire uniquement : le zip contient un token d'agent en clair, donc le
	// lien ne doit jamais être partageable — même pas avec un admin lecteur.
	if (!(await canControlRecalbox(user, id))) return forbidden()

	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const payload = await readAgentPayload()
	const { token } = await createAgentToken(db, id, 'installeur')
	const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')

	const zip = buildInstallerZip({
		agentPy: payload.agentPy,
		scanRomsPy: payload.scanRomsPy,
		launchPy: payload.launchPy,
		launcherSh: payload.launcherSh,
		readme: readme(rb.name, payload.version),
		config: { recalbox_id: id, token, cloud_url: `${base}/api/agent/ingest` },
	})

	return new NextResponse(zip as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="recalbox-dashboard-${slug(rb.name)}.zip"`,
			// Le zip embarque un secret à usage unique : ne jamais le laisser en cache.
			'Cache-Control': 'no-store',
		},
	})
}

function readme(boxName: string, version: string): string {
	return [
		`Recalbox Dashboard — installation de l'agent (version ${version})`,
		`Box : ${boxName}`,
		'',
		'1. Ouvrez ce fichier zip.',
		"2. Dans l'explorateur de fichiers, tapez \\\\RECALBOX (Windows)",
		'   ou smb://recalbox (macOS), puis ouvrez le dossier "share".',
		'3. Glissez les dossiers "system" et "userscripts" dans "share".',
		'   Si Windows propose de fusionner, acceptez : rien ne sera écrasé.',
		'4. Redémarrez la Recalbox.',
		'',
		"L'agent démarre tout seul et votre box apparaît dans le dashboard.",
		'Ce fichier contient une clé propre à votre box : ne le partagez pas.',
	].join('\n')
}
