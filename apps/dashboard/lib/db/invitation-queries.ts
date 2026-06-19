import { db } from '@/lib/db/index'
import { invitations } from '@/lib/db/schema'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'

export type InvitationRow = {
	id: string
	email: string
	role: string
	tokenHash: string
	expiresAt: number
	invitedByUserId: string
	acceptedAt: number | null
	createdAt: number
}

export type PendingInvitation = Pick<
	InvitationRow,
	'id' | 'email' | 'role' | 'expiresAt' | 'createdAt'
>

export async function insertInvitation(row: InvitationRow): Promise<void> {
	await db.insert(invitations).values(row).run()
}

/** Remove any not-yet-accepted invite for this email (used to upsert before inserting). */
export async function deletePendingByEmail(email: string): Promise<void> {
	await db
		.delete(invitations)
		.where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
		.run()
}

export async function getInvitationByTokenHash(
	tokenHash: string,
): Promise<InvitationRow | undefined> {
	const rows = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).all()
	return rows[0] as InvitationRow | undefined
}

/** Pending = not accepted and not expired. Never exposes the token hash. */
export async function listPendingInvitations(): Promise<PendingInvitation[]> {
	return db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt,
			createdAt: invitations.createdAt,
		})
		.from(invitations)
		.where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, Date.now())))
		.orderBy(asc(invitations.createdAt))
		.all()
}

export async function markAccepted(id: string, acceptedAt: number): Promise<void> {
	await db.update(invitations).set({ acceptedAt }).where(eq(invitations.id, id)).run()
}

export async function deleteInvitationById(id: string): Promise<void> {
	await db.delete(invitations).where(eq(invitations.id, id)).run()
}
