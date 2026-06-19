import { decryptSecret, encryptSecret } from '@/lib/crypto/credentials'
import { db } from '@/lib/db/index'
import { recalboxes } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { eq } from 'drizzle-orm'

export type RecalboxRow = typeof recalboxes.$inferSelect
export type RecalboxInsert = typeof recalboxes.$inferInsert

function decryptRow(row: RecalboxRow): RecalboxRow {
	try {
		return { ...row, sshPassword: decryptSecret(row.sshPassword) }
	} catch (err) {
		logger.error(`Failed to decrypt ssh_password for recalbox ${row.id}`, err)
		return row
	}
}

export async function listRecalboxes(): Promise<RecalboxRow[]> {
	try {
		const rows = await db.select().from(recalboxes).all()
		return rows.map(decryptRow)
	} catch (err) {
		logger.error('listRecalboxes failed', err)
		return []
	}
}
export async function getRecalbox(id: string): Promise<RecalboxRow | null> {
	try {
		const row = await db.select().from(recalboxes).where(eq(recalboxes.id, id)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getRecalbox failed', err)
		return null
	}
}
export async function getDefaultRecalbox(): Promise<RecalboxRow | null> {
	try {
		const row = await db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getDefaultRecalbox failed', err)
		return null
	}
}
export async function insertRecalbox(row: RecalboxInsert): Promise<void> {
	await db
		.insert(recalboxes)
		.values({ ...row, sshPassword: encryptSecret(row.sshPassword) })
		.run()
}
export async function updateRecalbox(
	id: string,
	patch: Partial<Omit<RecalboxInsert, 'id'>>,
): Promise<void> {
	const next =
		patch.sshPassword !== undefined
			? { ...patch, sshPassword: encryptSecret(patch.sshPassword) }
			: patch
	await db.update(recalboxes).set(next).where(eq(recalboxes.id, id)).run()
}
export async function deleteRecalbox(id: string): Promise<void> {
	await db.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}
export async function setDefaultRecalbox(id: string): Promise<void> {
	await db.update(recalboxes).set({ isDefault: false }).run()
	await db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}
