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

export function listRecalboxes(): RecalboxRow[] {
	try {
		return db.select().from(recalboxes).all().map(decryptRow)
	} catch (err) {
		logger.error('listRecalboxes failed', err)
		return []
	}
}
export function getRecalbox(id: string): RecalboxRow | null {
	try {
		const row = db.select().from(recalboxes).where(eq(recalboxes.id, id)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getRecalbox failed', err)
		return null
	}
}
export function getDefaultRecalbox(): RecalboxRow | null {
	try {
		const row = db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getDefaultRecalbox failed', err)
		return null
	}
}
export function insertRecalbox(row: RecalboxInsert): void {
	db.insert(recalboxes)
		.values({ ...row, sshPassword: encryptSecret(row.sshPassword) })
		.run()
}
export function updateRecalbox(id: string, patch: Partial<Omit<RecalboxInsert, 'id'>>): void {
	const next =
		patch.sshPassword !== undefined
			? { ...patch, sshPassword: encryptSecret(patch.sshPassword) }
			: patch
	db.update(recalboxes).set(next).where(eq(recalboxes.id, id)).run()
}
export function deleteRecalbox(id: string): void {
	db.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}
export function setDefaultRecalbox(id: string): void {
	db.update(recalboxes).set({ isDefault: false }).run()
	db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}
function countRecalboxes(): number {
	return db.select().from(recalboxes).all().length
}
