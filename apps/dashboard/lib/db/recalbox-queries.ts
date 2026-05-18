import { db } from '@/lib/db/index'
import { recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type RecalboxRow = typeof recalboxes.$inferSelect
export type RecalboxInsert = typeof recalboxes.$inferInsert

export function listRecalboxes(): RecalboxRow[] {
	try {
		return db.select().from(recalboxes).all()
	} catch {
		return []
	}
}
export function getRecalbox(id: string): RecalboxRow | null {
	try {
		return db.select().from(recalboxes).where(eq(recalboxes.id, id)).get() ?? null
	} catch {
		return null
	}
}
export function getDefaultRecalbox(): RecalboxRow | null {
	try {
		return db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get() ?? null
	} catch {
		return null
	}
}
export function insertRecalbox(row: RecalboxInsert): void {
	db.insert(recalboxes).values(row).run()
}
export function updateRecalbox(id: string, patch: Partial<Omit<RecalboxInsert, 'id'>>): void {
	db.update(recalboxes).set(patch).where(eq(recalboxes.id, id)).run()
}
export function deleteRecalbox(id: string): void {
	db.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}
export function setDefaultRecalbox(id: string): void {
	db.update(recalboxes).set({ isDefault: false }).run()
	db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}
export function countRecalboxes(): number {
	return db.select().from(recalboxes).all().length
}
