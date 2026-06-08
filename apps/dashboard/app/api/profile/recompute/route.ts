import { getUser, unauthorized } from '@/lib/auth/require-user'
import { computeUserProfile } from '@/lib/profile/compute-profile'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Force un recompute synchrone du profil. Utilisé par le bouton "Recalculer"
 * de la page profil et pour le debug.
 */
export async function POST() {
	if (!(await getUser())) return unauthorized()
	const start = Date.now()
	try {
		await computeUserProfile()
		return NextResponse.json({ ok: true, durationMs: Date.now() - start })
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'unknown'
		console.error('[profile] Manual recompute failed:', err)
		return NextResponse.json({ ok: false, error: message }, { status: 500 })
	}
}
