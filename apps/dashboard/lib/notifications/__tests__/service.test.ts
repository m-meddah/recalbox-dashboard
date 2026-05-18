import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the DB and settings before importing service
vi.mock('@/lib/db/index', () => ({
	db: {
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(() => ({
					get: vi.fn(() => ({
						id: 1,
						type: 'system.alert',
						data: '{"message":"test"}',
						createdAt: new Date(),
						readAt: null,
						pushedInApp: false,
						pushedWeb: false,
					})),
				})),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					run: vi.fn(),
					returning: vi.fn(() => ({ get: vi.fn(() => ({ id: 1 })) })),
				})),
			})),
		})),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					all: vi.fn(() => []),
					get: vi.fn(() => null),
				})),
				orderBy: vi.fn(() => ({
					limit: vi.fn(() => ({
						all: vi.fn(() => []),
					})),
				})),
			})),
		})),
	},
}))

vi.mock('@/lib/db/schema', () => ({
	notifications: {},
	settings: {},
}))

vi.mock('@/lib/db/queries', () => ({
	upsertSetting: vi.fn(),
}))

import { DEFAULT_PREFERENCES, type NotificationPreferences } from '../types'
import { shouldNotify, isInQuietHours } from '../preferences'

describe('shouldNotify', () => {
	it('returns false when notifications disabled', () => {
		const prefs: NotificationPreferences = { ...DEFAULT_PREFERENCES, enabled: false }
		expect(shouldNotify({ type: 'system.alert', data: { message: 'x' } }, prefs)).toBe(false)
	})

	it('returns false when achievement type disabled', () => {
		const prefs: NotificationPreferences = {
			...DEFAULT_PREFERENCES,
			types: { ...DEFAULT_PREFERENCES.types, achievementUnlocked: false },
		}
		expect(
			shouldNotify(
				{
					type: 'achievement.unlocked',
					data: { achievementId: 1, title: 'x', points: 10, imageUrl: '', isHardcore: false, gameTitle: 'y', gameId: 1 },
				},
				prefs,
			),
		).toBe(false)
	})

	it('filters non-hardcore when hardcoreOnly enabled', () => {
		const prefs: NotificationPreferences = {
			...DEFAULT_PREFERENCES,
			types: { ...DEFAULT_PREFERENCES.types, achievementUnlocked: true, achievementHardcoreOnly: true },
		}
		expect(
			shouldNotify(
				{
					type: 'achievement.unlocked',
					data: { achievementId: 1, title: 'x', points: 10, imageUrl: '', isHardcore: false, gameTitle: 'y', gameId: 1 },
				},
				prefs,
			),
		).toBe(false)
	})

	it('allows hardcore when hardcoreOnly enabled', () => {
		const prefs: NotificationPreferences = {
			...DEFAULT_PREFERENCES,
			types: { ...DEFAULT_PREFERENCES.types, achievementUnlocked: true, achievementHardcoreOnly: true },
		}
		expect(
			shouldNotify(
				{
					type: 'achievement.unlocked',
					data: { achievementId: 1, title: 'x', points: 10, imageUrl: '', isHardcore: true, gameTitle: 'y', gameId: 1 },
				},
				prefs,
			),
		).toBe(true)
	})

	it('returns false for gameStarted when disabled', () => {
		const prefs = { ...DEFAULT_PREFERENCES }
		expect(shouldNotify({ type: 'game.started', data: { system: 'nes', romPath: '/x' } }, prefs)).toBe(false)
	})

	it('returns true for streak milestones when enabled', () => {
		const prefs = { ...DEFAULT_PREFERENCES }
		expect(shouldNotify({ type: 'streak.milestone', data: { days: 7 } }, prefs)).toBe(true)
	})
})

describe('isInQuietHours', () => {
	it('returns false when quiet hours disabled', () => {
		const prefs = { ...DEFAULT_PREFERENCES, quietHours: { enabled: false, startHour: 22, endHour: 8 } }
		expect(isInQuietHours(prefs)).toBe(false)
	})

	it('detects quiet hours spanning midnight', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-01-01T23:30:00'))
		const prefs = { ...DEFAULT_PREFERENCES, quietHours: { enabled: true, startHour: 22, endHour: 8 } }
		expect(isInQuietHours(prefs)).toBe(true)
		vi.useRealTimers()
	})

	it('returns false outside quiet hours', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-01-01T12:00:00'))
		const prefs = { ...DEFAULT_PREFERENCES, quietHours: { enabled: true, startHour: 22, endHour: 8 } }
		expect(isInQuietHours(prefs)).toBe(false)
		vi.useRealTimers()
	})

	it('detects quiet hours within same day', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-01-01T14:00:00'))
		const prefs = { ...DEFAULT_PREFERENCES, quietHours: { enabled: true, startHour: 12, endHour: 18 } }
		expect(isInQuietHours(prefs)).toBe(true)
		vi.useRealTimers()
	})
})
