import { user as userTable } from '@/lib/auth/auth-schema'
import { db } from '@/lib/db/index'
import { asc, eq } from 'drizzle-orm'

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

/** Look up a single user by email. Returns undefined when none exists. */
export function getUserByEmail(email: string): AppUser | undefined {
	try {
		const rows = db
			.select({ id: userTable.id, email: userTable.email, role: userTable.role })
			.from(userTable)
			.where(eq(userTable.email, email))
			.all()
		const row = rows[0]
		return row ? { id: row.id, email: row.email, role: row.role ?? 'member' } : undefined
	} catch {
		return undefined
	}
}
