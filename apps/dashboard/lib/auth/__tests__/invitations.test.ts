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
		getUserByEmail: vi.fn(async () => undefined),
		deletePendingByEmail: vi.fn(async () => {}),
		insertInvitation: vi.fn(async () => {}),
		generateToken: vi.fn(() => ({ token: 'raw', tokenHash: 'hash' })),
		newId: vi.fn(() => 'inv1'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('createInvitation', () => {
	it('rejects an email that already has an account', async () => {
		const deps = createDeps({ getUserByEmail: vi.fn(async () => ({ id: 'u1' })) })
		await expect(
			createInvitation({ email: 'kid@x.c', role: 'member', invitedByUserId: 'a' }, deps),
		).rejects.toBeInstanceOf(EmailAlreadyRegisteredError)
		expect(deps.insertInvitation).not.toHaveBeenCalled()
	})

	it('upserts: deletes any pending invite, then inserts a fresh one', async () => {
		const deps = createDeps()
		const { invitation, token } = await createInvitation(
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
		getInvitationByTokenHash: vi.fn(async () => row()),
		hashToken: vi.fn(() => 'hash'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('validateInvitation', () => {
	it('returns the row for a valid token', async () => {
		expect(await validateInvitation('raw', validateDeps())).toMatchObject({ id: 'inv1' })
	})

	it('returns null for an empty token', async () => {
		expect(await validateInvitation('', validateDeps())).toBeNull()
	})

	it('returns null when no invite matches', async () => {
		expect(
			await validateInvitation(
				'raw',
				validateDeps({ getInvitationByTokenHash: vi.fn(async () => undefined) }),
			),
		).toBeNull()
	})

	it('returns null when already accepted', async () => {
		expect(
			await validateInvitation(
				'raw',
				validateDeps({ getInvitationByTokenHash: vi.fn(async () => row({ acceptedAt: 500 })) }),
			),
		).toBeNull()
	})

	it('returns null when expired', async () => {
		expect(
			await validateInvitation(
				'raw',
				validateDeps({
					getInvitationByTokenHash: vi.fn(async () => row({ expiresAt: 999 })),
					now: vi.fn(() => 1000),
				}),
			),
		).toBeNull()
	})
})

function acceptDeps(over: Partial<AcceptInvitationDeps> = {}): AcceptInvitationDeps {
	return {
		validate: vi.fn(async () => row()),
		claim: vi.fn(async () => true),
		release: vi.fn(async () => {}),
		createUser: vi.fn(async () => {}),
		now: vi.fn(() => 2000),
		...over,
	}
}

describe('acceptInvitation', () => {
	it('creates the user and stamps accepted_at', async () => {
		const createUser = vi.fn(async () => {})
		const claim = vi.fn(async () => true)
		const deps = acceptDeps({ createUser, claim })

		const result = await acceptInvitation({ token: 'raw', password: 'secret12' }, deps)
		expect(result).toEqual({ email: 'kid@x.c' })
		expect(createUser).toHaveBeenCalledWith({
			email: 'kid@x.c',
			password: 'secret12',
			role: 'member',
		})
		expect(claim).toHaveBeenCalledWith('inv1', 2000)
	})

	it('claims the invitation before creating the account', async () => {
		const order: string[] = []
		const deps = acceptDeps({
			claim: vi.fn(async () => {
				order.push('claim')
				return true
			}),
			createUser: vi.fn(async () => {
				order.push('createUser')
			}),
		})

		await acceptInvitation({ token: 'raw', password: 'secret12' }, deps)

		// Stamping afterwards left both racers past validate(), so the loser crashed on
		// the duplicate email instead of being rejected cleanly.
		expect(order).toEqual(['claim', 'createUser'])
	})

	it('rejects the loser of a concurrent accept without creating a user', async () => {
		const createUser = vi.fn(async () => {})
		// The winner already stamped accepted_at, so the conditional update matches
		// nothing for this caller.
		const deps = acceptDeps({ claim: vi.fn(async () => false), createUser })

		await expect(
			acceptInvitation({ token: 'raw', password: 'secret12' }, deps),
		).rejects.toBeInstanceOf(InvalidInvitationError)
		expect(createUser).not.toHaveBeenCalled()
	})

	it('releases the claim when account creation fails, so the invite survives', async () => {
		const release = vi.fn(async () => {})
		const deps = acceptDeps({
			createUser: vi.fn(async () => {
				throw new Error('better-auth refused the password')
			}),
			release,
		})

		await expect(acceptInvitation({ token: 'raw', password: 'secret12' }, deps)).rejects.toThrow(
			'better-auth refused the password',
		)
		expect(release).toHaveBeenCalledWith('inv1')
	})

	it('does not release the claim on success', async () => {
		const release = vi.fn(async () => {})
		await acceptInvitation({ token: 'raw', password: 'secret12' }, acceptDeps({ release }))
		expect(release).not.toHaveBeenCalled()
	})

	it('throws InvalidInvitationError for a bad token and never creates a user', async () => {
		const createUser = vi.fn(async () => {})
		const deps = acceptDeps({ validate: vi.fn(async () => null), createUser })
		await expect(
			acceptInvitation({ token: 'bad', password: 'secret12' }, deps),
		).rejects.toBeInstanceOf(InvalidInvitationError)
		expect(createUser).not.toHaveBeenCalled()
	})
})
