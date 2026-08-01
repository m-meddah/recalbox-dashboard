import { randomUUID } from 'node:crypto'
import { generateInvitationToken, hashInvitationToken } from '@/lib/auth/invitation-token'
import { auth } from '@/lib/auth/server'
import {
	type InvitationRow,
	claimInvitation,
	deletePendingByEmail,
	getInvitationByTokenHash,
	insertInvitation,
	releaseInvitation,
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
	getUserByEmail: (email: string) => Promise<{ id: string } | undefined>
	deletePendingByEmail: (email: string) => Promise<void>
	insertInvitation: (row: InvitationRow) => Promise<void>
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

export async function createInvitation(
	input: { email: string; role: string; invitedByUserId: string },
	deps: CreateInvitationDeps = defaultCreateDeps,
): Promise<{ invitation: InvitationRow; token: string }> {
	if (await deps.getUserByEmail(input.email)) throw new EmailAlreadyRegisteredError()
	await deps.deletePendingByEmail(input.email)
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
	await deps.insertInvitation(invitation)
	return { invitation, token }
}

export type ValidateInvitationDeps = {
	getInvitationByTokenHash: (hash: string) => Promise<InvitationRow | undefined>
	hashToken: (token: string) => string
	now: () => number
}

const defaultValidateDeps: ValidateInvitationDeps = {
	getInvitationByTokenHash,
	hashToken: hashInvitationToken,
	now: Date.now,
}

export async function validateInvitation(
	token: string,
	deps: ValidateInvitationDeps = defaultValidateDeps,
): Promise<InvitationRow | null> {
	if (!token) return null
	const invite = await deps.getInvitationByTokenHash(deps.hashToken(token))
	if (!invite) return null
	if (invite.acceptedAt != null) return null
	if (invite.expiresAt <= deps.now()) return null
	return invite
}

export type AcceptInvitationDeps = {
	validate: (token: string) => Promise<InvitationRow | null>
	createUser: (args: { email: string; password: string; role: string }) => Promise<void>
	/** Atomically take the invitation; false means somebody else already did. */
	claim: (id: string, acceptedAt: number) => Promise<boolean>
	release: (id: string) => Promise<void>
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
	claim: claimInvitation,
	release: releaseInvitation,
	now: Date.now,
}

export async function acceptInvitation(
	input: { token: string; password: string },
	deps: AcceptInvitationDeps = defaultAcceptDeps,
): Promise<{ email: string }> {
	const invite = await deps.validate(input.token)
	if (!invite) throw new InvalidInvitationError()

	// Claim BEFORE creating the account. An unconditional "stamp accepted_at" used to
	// run AFTER createUser(), so two concurrent requests carrying the same token both got past
	// validation. The unique email meant no second account was ever created, but the
	// loser crashed on the duplicate insert and surfaced a 500 instead of a clean
	// rejection. The conditional update decides a single winner.
	if (!(await deps.claim(invite.id, deps.now()))) throw new InvalidInvitationError()

	try {
		await deps.createUser({ email: invite.email, password: input.password, role: invite.role })
	} catch (err) {
		// The account was not created (a password Better Auth refuses, a transient DB
		// error…). Give the invitation back rather than burning it on a failed attempt.
		await deps.release(invite.id).catch(() => {})
		throw err
	}
	return { email: invite.email }
}
