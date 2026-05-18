import { configStore } from '@/lib/config-store'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'active_recalbox_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function getActiveRecalboxId(): Promise<string | null> {
	const jar = await cookies()
	const fromCookie = jar.get(COOKIE_NAME)?.value
	if (fromCookie && configStore.getRecalbox(fromCookie)) return fromCookie
	return configStore.getDefaultRecalbox()?.id ?? configStore.getRecalboxes()[0]?.id ?? null
}

export async function setActiveRecalboxId(id: string): Promise<void> {
	const jar = await cookies()
	jar.set(COOKIE_NAME, id, {
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE,
		path: '/',
	})
}
