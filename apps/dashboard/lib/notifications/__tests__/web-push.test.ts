import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendNotification, mockSetVapidDetails, mockDeleteSub, mockSelectAll } = vi.hoisted(
	() => ({
		mockSendNotification: vi.fn(),
		mockSetVapidDetails: vi.fn(),
		mockDeleteSub: vi.fn(),
		mockSelectAll: vi.fn(),
	}),
)

vi.mock('web-push', () => ({
	default: {
		setVapidDetails: mockSetVapidDetails,
		sendNotification: mockSendNotification,
	},
}))

vi.mock('@/lib/db/index', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				all: mockSelectAll,
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({ run: vi.fn() })),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({ run: mockDeleteSub })),
		})),
	},
}))

vi.mock('@/lib/db/schema', () => ({ pushSubscriptions: {}, settings: {} }))

vi.mock('@/lib/notifications/vapid', () => ({
	getOrCreateVapidKeys: vi.fn().mockResolvedValue({
		publicKey: 'test-pub-key',
		privateKey: 'test-priv-key',
	}),
}))

import type { Notification } from '../types'
import { buildPushPayload, sendWebPush } from '../web-push'

function makeNotif(type: string, data: object): Notification {
	return {
		id: 1,
		type,
		data: JSON.stringify(data),
		createdAt: new Date(),
		readAt: null,
		pushedInApp: false,
		pushedWeb: false,
		recalboxId: null,
	}
}

describe('buildPushPayload', () => {
	it('builds achievement payload', () => {
		const notif = makeNotif('achievement.unlocked', {
			title: 'First Blood',
			points: 25,
			isHardcore: false,
			gameTitle: 'Super Mario',
			gameId: 1,
			achievementId: 99,
			imageUrl: '',
		})
		const payload = buildPushPayload(notif)
		expect(payload.title).toContain('Super Mario')
		expect(payload.body).toContain('First Blood')
		expect(payload.body).toContain('25 pts')
		expect(payload.data.url).toBe('/achievements')
	})

	it('builds streak payload', () => {
		const notif = makeNotif('streak.milestone', { days: 7 })
		const payload = buildPushPayload(notif)
		expect(payload.body).toContain('7')
		expect(payload.data.url).toBe('/stats')
	})

	it('builds wrapped payload', () => {
		const notif = makeNotif('wrapped.available', { year: 2024 })
		const payload = buildPushPayload(notif)
		expect(payload.body).toContain('2024')
		expect(payload.data.url).toBe('/wrapped')
	})
})

describe('sendWebPush', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('skips when no subscriptions', async () => {
		mockSelectAll.mockReturnValue([])
		await sendWebPush(makeNotif('system.alert', { message: 'test' }))
		expect(mockSendNotification).not.toHaveBeenCalled()
	})

	it('sends to all subscriptions', async () => {
		mockSelectAll.mockReturnValue([
			{ endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
			{ endpoint: 'https://push.example.com/2', p256dh: 'key2', auth: 'auth2' },
		])
		mockSendNotification.mockResolvedValue({})

		await sendWebPush(makeNotif('system.alert', { message: 'hello' }))
		expect(mockSendNotification).toHaveBeenCalledTimes(2)
	})

	it('deletes subscription on 410 Gone', async () => {
		mockSelectAll.mockReturnValue([
			{ endpoint: 'https://push.example.com/expired', p256dh: 'k', auth: 'a' },
		])
		mockSendNotification.mockRejectedValue({ statusCode: 410 })

		await sendWebPush(makeNotif('system.alert', { message: 'gone' }))
		expect(mockDeleteSub).toHaveBeenCalled()
	})

	it('deletes subscription on 404 Not Found', async () => {
		mockSelectAll.mockReturnValue([
			{ endpoint: 'https://push.example.com/invalid', p256dh: 'k', auth: 'a' },
		])
		mockSendNotification.mockRejectedValue({ statusCode: 404 })

		await sendWebPush(makeNotif('system.alert', { message: 'nf' }))
		expect(mockDeleteSub).toHaveBeenCalled()
	})
})
