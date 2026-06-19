import { db } from '@/lib/db/index'
import { pushSubscriptions, settings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import webpush from 'web-push'

const PUBLIC_KEY = 'vapid.publicKey'
const PRIVATE_KEY = 'vapid.privateKey'

export async function getOrCreateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
	const pubRow = await db.select().from(settings).where(eq(settings.key, PUBLIC_KEY)).get()
	const privRow = await db.select().from(settings).where(eq(settings.key, PRIVATE_KEY)).get()

	if (pubRow && privRow) {
		return { publicKey: pubRow.value, privateKey: privRow.value }
	}

	const keys = webpush.generateVAPIDKeys()
	const now = new Date()

	await db
		.insert(settings)
		.values({ key: PUBLIC_KEY, value: keys.publicKey, updatedAt: now })
		.onConflictDoUpdate({ target: settings.key, set: { value: keys.publicKey, updatedAt: now } })
		.run()

	await db
		.insert(settings)
		.values({ key: PRIVATE_KEY, value: keys.privateKey, updatedAt: now })
		.onConflictDoUpdate({ target: settings.key, set: { value: keys.privateKey, updatedAt: now } })
		.run()

	return keys
}

export async function getVapidPublicKey(): Promise<string | null> {
	const row = await db.select().from(settings).where(eq(settings.key, PUBLIC_KEY)).get()
	return row?.value ?? null
}

export async function deleteVapidKeys(): Promise<void> {
	await db.delete(settings).where(eq(settings.key, PUBLIC_KEY)).run()
	await db.delete(settings).where(eq(settings.key, PRIVATE_KEY)).run()
	await db.delete(pushSubscriptions).run()
}
