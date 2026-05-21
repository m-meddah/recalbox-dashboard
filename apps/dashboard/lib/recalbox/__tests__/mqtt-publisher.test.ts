// vi.mock calls are hoisted to the top by Vitest before any imports resolve.
// Imports below get the mocked versions automatically.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
	getSessionStats: vi.fn(),
	getLastClosedSession: vi.fn(),
}))

vi.mock('@/lib/config-store', () => ({
	configStore: {
		get: vi.fn(() => ({
			mqttPublish: {
				enabled: true,
				brokerUrl: '',
				topicPrefix: 'RecalboxDashboard/',
				homeAssistantDiscovery: false,
			},
		})),
		getDefaultRecalbox: vi.fn(() => ({ host: 'recalbox.local' })),
	},
}))

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { type SessionStats, getLastClosedSession, getSessionStats } from '@/lib/db/queries'
import { computeAnalyticsSnapshot, mqttPublisher } from '../mqtt-publisher'

const mockGetSessionStats = vi.mocked(getSessionStats)
const mockGetLastClosedSession = vi.mocked(getLastClosedSession)

beforeEach(() => vi.clearAllMocks())

function makeStats(
	overrides: Partial<{
		totalPlaytimeSec: number
		totalSessions: number
		topGames: Array<{ gameName: string }>
		byDay: Array<{ date: string; playtimeSec: number; sessionCount: number }>
	}> = {},
) {
	return {
		totalPlaytimeSec: overrides.totalPlaytimeSec ?? 0,
		totalSessions: overrides.totalSessions ?? 0,
		uniqueGames: 0,
		avgSessionSec: 0,
		topGames: (overrides.topGames ?? []) as unknown as SessionStats['topGames'],
		byDay: overrides.byDay ?? [],
		bySystem: [] as SessionStats['bySystem'],
	}
}

// ─── computeAnalyticsSnapshot ────────────────────────────────────────────────

describe('computeAnalyticsSnapshot', () => {
	it('returns zeros when no sessions', async () => {
		mockGetSessionStats.mockResolvedValue(makeStats())
		mockGetLastClosedSession.mockResolvedValue(null)

		const snapshot = await computeAnalyticsSnapshot()

		expect(snapshot.playtimeTodaySec).toBe(0)
		expect(snapshot.playtimeWeekSec).toBe(0)
		expect(snapshot.currentStreak).toBe(0)
		expect(snapshot.longestStreak).toBe(0)
		expect(snapshot.sessionsToday).toBe(0)
		expect(snapshot.topGameWeek).toBe('')
		expect(snapshot.lastGame).toBeNull()
	})

	it('maps todayStats.totalPlaytimeSec → playtimeTodaySec', async () => {
		mockGetSessionStats
			.mockResolvedValueOnce(makeStats({ totalPlaytimeSec: 3600, totalSessions: 2 })) // today
			.mockResolvedValueOnce(makeStats({ totalPlaytimeSec: 7200 })) // week
			.mockResolvedValueOnce(makeStats()) // all-time

		mockGetLastClosedSession.mockResolvedValue(null)

		const snapshot = await computeAnalyticsSnapshot()

		expect(snapshot.playtimeTodaySec).toBe(3600)
		expect(snapshot.playtimeWeekSec).toBe(7200)
		expect(snapshot.sessionsToday).toBe(2)
	})

	it('picks first topGame from weekStats', async () => {
		mockGetSessionStats
			.mockResolvedValueOnce(makeStats()) // today
			.mockResolvedValueOnce(
				makeStats({ topGames: [{ gameName: 'Super Mario World' }, { gameName: 'Zelda' }] }),
			) // week
			.mockResolvedValueOnce(makeStats()) // all-time

		mockGetLastClosedSession.mockResolvedValue(null)

		const snapshot = await computeAnalyticsSnapshot()
		expect(snapshot.topGameWeek).toBe('Super Mario World')
	})

	it('maps lastGame fields correctly', async () => {
		mockGetSessionStats.mockResolvedValue(makeStats())
		mockGetLastClosedSession.mockResolvedValue({
			gameName: 'Donkey Kong Country',
			system: 'snes',
			durationSec: 1800,
		})

		const snapshot = await computeAnalyticsSnapshot()

		expect(snapshot.lastGame).toEqual({
			name: 'Donkey Kong Country',
			system: 'snes',
			durationSec: 1800,
		})
	})
})

// ─── MqttPublisher ───────────────────────────────────────────────────────────

describe('MqttPublisher', () => {
	it('publishAnalytics is a no-op when not connected', () => {
		// mqttPublisher.isConnected is false by default (no broker in tests)
		expect(() =>
			mqttPublisher.publishAnalytics({
				playtimeTodaySec: 100,
				playtimeWeekSec: 500,
				currentStreak: 3,
				longestStreak: 10,
				sessionsToday: 2,
				topGameWeek: 'Mario',
				lastGame: null,
			}),
		).not.toThrow()
	})

	it('disconnect is idempotent', () => {
		expect(() => mqttPublisher.disconnect()).not.toThrow()
		expect(() => mqttPublisher.disconnect()).not.toThrow()
	})

	it('publishStatus is a no-op when not connected', () => {
		expect(() => mqttPublisher.publishStatus('online')).not.toThrow()
	})
})
