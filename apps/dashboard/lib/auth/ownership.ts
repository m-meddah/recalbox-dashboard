import type { AuthedUser } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'

export function isAdmin(user: AuthedUser): boolean {
	return user.role === 'admin'
}

/** Recalbox ids the user may READ. Admin sees all; members see only what they own.
 * Reads from the configStore in-memory cache (sync) so request-path gating stays synchronous. */
export function getViewableRecalboxIds(user: AuthedUser): string[] {
	const all = configStore.getRecalboxes()
	if (isAdmin(user)) return all.map((r) => r.id)
	return all.filter((r) => r.ownerUserId === user.id).map((r) => r.id)
}

/** Whether the user may READ a specific recalbox. */
export function canViewRecalbox(user: AuthedUser, recalboxId: string): boolean {
	if (isAdmin(user)) return true
	const row = configStore.getRecalboxes().find((r) => r.id === recalboxId)
	return row?.ownerUserId === user.id
}

/** Whether the user may CONTROL (write/launch/power) a recalbox. Owner only — admins are
 * read-only on machines they do not own, and nobody controls an unowned machine. */
export function canControlRecalbox(user: AuthedUser, recalboxId: string): boolean {
	const row = configStore.getRecalboxes().find((r) => r.id === recalboxId)
	return row != null && row.ownerUserId != null && row.ownerUserId === user.id
}
