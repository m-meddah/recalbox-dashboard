import { installerReadme, resolveInstallerLocale } from '@/lib/agent/installer-readme'
import { buildInstallerZip } from '@/lib/agent/installer-zip'
import { readAgentPayload } from '@/lib/agent/payload'
import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { INSTALLER_TOKEN_NAME, createAgentToken } from '@/lib/db/agent-queries'
import { logger } from '@/lib/logger'
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

	// `new URL(req.url)` rather than `req.nextUrl`: this route is exercised in tests
	// against a plain `Request`, which has no `nextUrl` getter (that's a `NextRequest`
	// runtime addition — a TS cast doesn't add it), and `.url` works identically on both.
	const locale = resolveInstallerLocale(new URL(req.url).searchParams.get('locale'))

	// Tout ce qui peut échouer entre ici et la réponse doit rester dans ce try : la
	// création du zip mint déjà un token en base (côté agent-queries, jamais révoqué
	// au téléchargement — voir la note dans agent-queries.ts), donc si l'assemblage du
	// zip ou la réponse échoue APRÈS le mint, l'utilisateur doit recevoir le même
	// message stable que pour un échec plus tôt, pas un 500 brut.
	try {
		const payload = await readAgentPayload()
		const { token } = await createAgentToken(db, id, INSTALLER_TOKEN_NAME)

		const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')

		const zip = buildInstallerZip({
			agentPy: payload.agentPy,
			scanRomsPy: payload.scanRomsPy,
			launchPy: payload.launchPy,
			updaterPy: payload.updaterPy,
			launcherSh: payload.launcherSh,
			readme: installerReadme(locale, rb.name, payload.version),
			config: { recalbox_id: id, token, cloud_url: `${base}/api/agent/ingest` },
			version: payload.version,
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
	} catch (err) {
		// Ne jamais renvoyer le texte de l'exception : l'utilisateur est en plein
		// onboarding, sans terminal pour en faire quoi que ce soit. Le détail va aux
		// logs serveur ; la réponse reste un message stable et intelligible.
		logger.error('[installer] failed to prepare installer zip', err)
		return NextResponse.json(
			{ error: "Impossible de préparer l'archive d'installation. Réessayez dans un instant." },
			{ status: 500 },
		)
	}
}
