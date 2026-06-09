import { user as userTable } from '@/lib/auth/auth-schema'
import { db } from '@/lib/db/index'
import { asc } from 'drizzle-orm'

export type AppUser = { id: string; email: string; role: string }

/** All registered users, ordered by email. Role defaults to 'member' when unset. */
export function listUsers(): AppUser[] {
	try {
		const rows = db
			.select({ id: userTable.id, email: userTable.email, role: userTable.role })
			.from(userTable)
			.orderBy(asc(userTable.email))
			.all()
		return rows.map((r) => ({ id: r.id, email: r.email, role: r.role ?? 'member' }))
	} catch {
		return []
	}
}
