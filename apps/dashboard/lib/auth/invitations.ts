import { randomUUID } from 'node:crypto'
import { generateInvitationToken, hashInvitationToken } from '@/lib/auth/invitation-token'
import { auth } from '@/lib/auth/server'
import {
	type InvitationRow,
	deletePendingByEmail,
	getInvitationByTokenHash,
	insertInvitation,
	markAccepted,
} from '@/lib/db/invitation-queries'
import { getUserByEmail } from '@/lib/db/user-queries'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class EmailAlreadyRegisteredError extends Error {
	constructor() {
		super('Email already registered')
		this.name = 'EmailAlreadyRegisteredError'
	}
}

export class InvalidInvitationError extends Error {
	constructor() {
		super('Invalid or expired invitation')
		this.name = 'InvalidInvitationError'
	}
}

export type CreateInvitationDeps = {
	getUserByEmail: (email: string) => { id: string } | undefined
	deletePendingByEmail: (email: string) => void
	insertInvitation: (row: InvitationRow) => void
	generateToken: () => { token: string; tokenHash: string }
	newId: () => string
	now: () => number
}

const defaultCreateDeps: CreateInvitationDeps = {
	getUserByEmail,
	deletePendingByEmail,
	insertInvitation,
	generateToken: generateInvitationToken,
	newId: randomUUID,
	now: Date.now,
}

export function createInvitation(
	input: { email: string; role: string; invitedByUserId: string },
	deps: CreateInvitationDeps = defaultCreateDeps,
): { invitation: InvitationRow; token: string } {
	if (deps.getUserByEmail(input.email)) throw new EmailAlreadyRegisteredError()
	deps.deletePendingByEmail(input.email)
	const { token, tokenHash } = deps.generateToken()
	const nowMs = deps.now()
	const invitation: InvitationRow = {
		id: deps.newId(),
		email: input.email,
		role: input.role,
		tokenHash,
		expiresAt: nowMs + INVITATION_TTL_MS,
		invitedByUserId: input.invitedByUserId,
		acceptedAt: null,
		createdAt: nowMs,
	}
	deps.insertInvitation(invitation)
	return { invitation, token }
}

export type ValidateInvitationDeps = {
	getInvitationByTokenHash: (hash: string) => InvitationRow | undefined
	hashToken: (token: string) => string
	now: () => number
}

const defaultValidateDeps: ValidateInvitationDeps = {
	getInvitationByTokenHash,
	hashToken: hashInvitationToken,
	now: Date.now,
}

export function validateInvitation(
	token: string,
	deps: ValidateInvitationDeps = defaultValidateDeps,
): InvitationRow | null {
	if (!token) return null
	const invite = deps.getInvitationByTokenHash(deps.hashToken(token))
	if (!invite) return null
	if (invite.acceptedAt != null) return null
	if (invite.expiresAt <= deps.now()) return null
	return invite
}

export type AcceptInvitationDeps = {
	validate: (token: string) => InvitationRow | null
	createUser: (args: { email: string; password: string; role: string }) => Promise<void>
	markAccepted: (id: string, acceptedAt: number) => void
	now: () => number
}

const defaultAcceptDeps: AcceptInvitationDeps = {
	validate: (token) => validateInvitation(token),
	createUser: async ({ email, password, role }) => {
		// Headless createUser: called server-side without request headers, so the admin
		// plugin skips its UNAUTHORIZED guard (same path as scripts/create-user.ts). The
		// role cast matches that script — the SDK types role as 'user' | 'admin' but our
		// app stores 'admin' | 'member' verbatim.
		await auth.api.createUser({
			body: { email, password, name: email, role: role as 'user' | 'admin' },
		})
	},
	markAccepted,
	now: Date.now,
}

export async function acceptInvitation(
	input: { token: string; password: string },
	deps: AcceptInvitationDeps = defaultAcceptDeps,
): Promise<{ email: string }> {
	const invite = deps.validate(input.token)
	if (!invite) throw new InvalidInvitationError()
	await deps.createUser({ email: invite.email, password: input.password, role: invite.role })
	deps.markAccepted(invite.id, deps.now())
	return { email: invite.email }
}
