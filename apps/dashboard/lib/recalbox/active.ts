import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { getUser } from '@/lib/auth/require-user'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'active_recalbox_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function getActiveRecalboxId(): Promise<string | null> {
	const user = await getUser()
	if (!user) return null
	const viewable = getViewableRecalboxIds(user)
	if (viewable.length === 0) return null
	const jar = await cookies()
	const fromCookie = jar.get(COOKIE_NAME)?.value
	if (fromCookie && viewable.includes(fromCookie)) return fromCookie
	return viewable[0] ?? null
}

export async function setActiveRecalboxId(id: string): Promise<void> {
	const jar = await cookies()
	jar.set(COOKIE_NAME, id, {
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE,
		path: '/',
		secure: process.env.NODE_ENV === 'production',
	})
}
