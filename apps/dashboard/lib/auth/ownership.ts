import { loadRecalboxes } from '@/lib/auth/recalbox-acl'
import type { AuthedUser } from '@/lib/auth/require-user'

export function isAdmin(user: AuthedUser): boolean {
	return user.role === 'admin'
}

/** Recalbox ids the user may READ. Admin sees all; members see only what they own.
 * Async because ownership MUST be decided against the DB: the in-memory configStore
 * cache goes stale across serverless instances. See recalbox-acl.ts. */
export async function getViewableRecalboxIds(user: AuthedUser): Promise<string[]> {
	const all = await loadRecalboxes()
	if (isAdmin(user)) return all.map((r) => r.id)
	return all.flatMap((r) => (r.ownerUserId === user.id ? [r.id] : []))
}

/** Whether the user may READ a specific recalbox. */
export async function canViewRecalbox(user: AuthedUser, recalboxId: string): Promise<boolean> {
	if (isAdmin(user)) return true
	const all = await loadRecalboxes()
	return all.find((r) => r.id === recalboxId)?.ownerUserId === user.id
}

/** Whether the user may CONTROL (write/launch/power) a recalbox. Owner only — admins are
 * read-only on machines they do not own, and nobody controls an unowned machine. */
export async function canControlRecalbox(user: AuthedUser, recalboxId: string): Promise<boolean> {
	const all = await loadRecalboxes()
	const row = all.find((r) => r.id === recalboxId)
	return row != null && row.ownerUserId != null && row.ownerUserId === user.id
}
