import type { InvitationRow } from '@/lib/db/invitation-queries'
import { describe, expect, it, vi } from 'vitest'
import {
	type AcceptInvitationDeps,
	type CreateInvitationDeps,
	EmailAlreadyRegisteredError,
	INVITATION_TTL_MS,
	InvalidInvitationError,
	type ValidateInvitationDeps,
	acceptInvitation,
	createInvitation,
	validateInvitation,
} from '../invitations'

function row(over: Partial<InvitationRow> = {}): InvitationRow {
	return {
		id: 'inv1',
		email: 'kid@x.c',
		role: 'member',
		tokenHash: 'hash',
		expiresAt: 9_999_999_999_999,
		invitedByUserId: 'admin1',
		acceptedAt: null,
		createdAt: 1000,
		...over,
	}
}

function createDeps(over: Partial<CreateInvitationDeps> = {}): CreateInvitationDeps {
	return {
		getUserByEmail: vi.fn(() => undefined),
		deletePendingByEmail: vi.fn(),
		insertInvitation: vi.fn(),
		generateToken: vi.fn(() => ({ token: 'raw', tokenHash: 'hash' })),
		newId: vi.fn(() => 'inv1'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('createInvitation', () => {
	it('rejects an email that already has an account', () => {
		const deps = createDeps({ getUserByEmail: vi.fn(() => ({ id: 'u1' })) })
		expect(() =>
			createInvitation({ email: 'kid@x.c', role: 'member', invitedByUserId: 'a' }, deps),
		).toThrow(EmailAlreadyRegisteredError)
		expect(deps.insertInvitation).not.toHaveBeenCalled()
	})

	it('upserts: deletes any pending invite, then inserts a fresh one', () => {
		const deps = createDeps()
		const { invitation, token } = createInvitation(
			{ email: 'kid@x.c', role: 'member', invitedByUserId: 'admin1' },
			deps,
		)
		expect(deps.deletePendingByEmail).toHaveBeenCalledWith('kid@x.c')
		expect(deps.insertInvitation).toHaveBeenCalledWith(invitation)
		expect(token).toBe('raw')
		expect(invitation).toMatchObject({
			id: 'inv1',
			email: 'kid@x.c',
			role: 'member',
			tokenHash: 'hash',
			invitedByUserId: 'admin1',
			acceptedAt: null,
			createdAt: 1000,
			expiresAt: 1000 + INVITATION_TTL_MS,
		})
	})
})

function validateDeps(over: Partial<ValidateInvitationDeps> = {}): ValidateInvitationDeps {
	return {
		getInvitationByTokenHash: vi.fn(() => row()),
		hashToken: vi.fn(() => 'hash'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('validateInvitation', () => {
	it('returns the row for a valid token', () => {
		expect(validateInvitation('raw', validateDeps())).toMatchObject({ id: 'inv1' })
	})

	it('returns null for an empty token', () => {
		expect(validateInvitation('', validateDeps())).toBeNull()
	})

	it('returns null when no invite matches', () => {
		expect(
			validateInvitation('raw', validateDeps({ getInvitationByTokenHash: vi.fn(() => undefined) })),
		).toBeNull()
	})

	it('returns null when already accepted', () => {
		expect(
			validateInvitation(
				'raw',
				validateDeps({ getInvitationByTokenHash: vi.fn(() => row({ acceptedAt: 500 })) }),
			),
		).toBeNull()
	})

	it('returns null when expired', () => {
		expect(
			validateInvitation(
				'raw',
				validateDeps({
					getInvitationByTokenHash: vi.fn(() => row({ expiresAt: 999 })),
					now: vi.fn(() => 1000),
				}),
			),
		).toBeNull()
	})
})

describe('acceptInvitation', () => {
	it('creates the user and stamps accepted_at', async () => {
		const createUser = vi.fn(async () => {})
		const markAccepted = vi.fn()
		const deps: AcceptInvitationDeps = {
			validate: vi.fn(() => row()),
			createUser,
			markAccepted,
			now: vi.fn(() => 2000),
		}
		const result = await acceptInvitation({ token: 'raw', password: 'secret12' }, deps)
		expect(result).toEqual({ email: 'kid@x.c' })
		expect(createUser).toHaveBeenCalledWith({
			email: 'kid@x.c',
			password: 'secret12',
			role: 'member',
		})
		expect(markAccepted).toHaveBeenCalledWith('inv1', 2000)
	})

	it('throws InvalidInvitationError for a bad token and never creates a user', async () => {
		const createUser = vi.fn(async () => {})
		const deps: AcceptInvitationDeps = {
			validate: vi.fn(() => null),
			createUser,
			markAccepted: vi.fn(),
			now: vi.fn(() => 2000),
		}
		await expect(
			acceptInvitation({ token: 'bad', password: 'secret12' }, deps),
		).rejects.toBeInstanceOf(InvalidInvitationError)
		expect(createUser).not.toHaveBeenCalled()
	})
})
