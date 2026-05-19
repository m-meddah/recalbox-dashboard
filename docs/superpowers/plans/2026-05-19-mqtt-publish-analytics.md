# MQTT Analytics Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish dashboard analytics (playtime, streaks, last game) to MQTT topics so Home Assistant and other tools can consume them.

**Architecture:** A dedicated `MqttPublisher` singleton (separate from the consumer `MqttPool`) connects to a configurable broker with LWT. The scrobbler daemon wires up publish-on-session-close and a 5-minute refresh timer. Feature is opt-in via a new `mqttPublish` config scope.

**Tech Stack:** `mqtt` (already installed), Drizzle ORM, Zod, React Hook Form, next-intl, Vitest

---

## File Map

| Action | File |
|---|---|
| Modify | `apps/dashboard/lib/stats/calculators.ts` — export `calculateStreaks` |
| Modify | `apps/dashboard/lib/db/queries.ts` — add `getLastClosedSession()` |
| Modify | `apps/dashboard/lib/settings/schemas.ts` — add `mqttPublishConfigSchema`, extend `AppConfig` |
| Modify | `apps/dashboard/lib/settings/defaults.ts` — add `mqttPublish` defaults |
| Modify | `apps/dashboard/lib/config-store.ts` — add `changed:mqttPublish` event type |
| Create | `apps/dashboard/lib/recalbox/mqtt-publisher.ts` — publisher singleton + `computeAnalyticsSnapshot` |
| Modify | `apps/dashboard/lib/scrobbler/index.ts` — wire publisher lifecycle + triggers |
| Modify | `apps/dashboard/app/api/settings/route.ts` — add `mqttPublish` to PUT schema |
| Modify | `apps/dashboard/app/[locale]/settings/page.tsx` — add MqttPublish settings section |
| Modify | `apps/dashboard/messages/en.json` — add `mqttPublish` i18n keys |
| Modify | `apps/dashboard/messages/fr.json` — add `mqttPublish` i18n keys |
| Create | `apps/dashboard/lib/recalbox/__tests__/mqtt-publisher.test.ts` — snapshot + publisher tests |
| Create | `docs/mqtt-api.md` — stable topic contract |
| Modify | `README.md` — add Ecosystem section |

---

## Task 1: Export `calculateStreaks` and add a direct test

**Files:**
- Modify: `apps/dashboard/lib/stats/calculators.ts:151`
- Modify: `apps/dashboard/lib/stats/__tests__/calculators.test.ts`

- [ ] **Step 1: Export `calculateStreaks`**

In `apps/dashboard/lib/stats/calculators.ts`, change line 151 from:

```ts
function calculateStreaks(byDay: Array<{ date: string; playtimeSec: number }>) {
```

to:

```ts
export function calculateStreaks(byDay: Array<{ date: string; playtimeSec: number }>) {
```

- [ ] **Step 2: Add direct tests for `calculateStreaks`**

Append to `apps/dashboard/lib/stats/__tests__/calculators.test.ts`:

```ts
import { calculateStreaks } from '../calculators'

// ─── calculateStreaks ─────────────────────────────────────────────────────────

describe('calculateStreaks', () => {
	it('returns zeros for empty input', () => {
		expect(calculateStreaks([])).toEqual({ currentStreak: 0, longestStreak: 0 })
	})

	it('counts a single active day as streak of 1', () => {
		const today = new Date().toISOString().slice(0, 10)
		const result = calculateStreaks([{ date: today, playtimeSec: 120 }])
		expect(result.currentStreak).toBe(1)
		expect(result.longestStreak).toBe(1)
	})

	it('ignores days with less than 60s', () => {
		const today = new Date().toISOString().slice(0, 10)
		const result = calculateStreaks([{ date: today, playtimeSec: 59 }])
		expect(result.currentStreak).toBe(0)
		expect(result.longestStreak).toBe(0)
	})

	it('counts consecutive past days as longestStreak', () => {
		const days = [2, 3, 4].map((offset) => {
			const d = new Date(Date.now() - offset * 86400000)
			return { date: d.toISOString().slice(0, 10), playtimeSec: 300 }
		})
		const result = calculateStreaks(days)
		expect(result.longestStreak).toBe(3)
		expect(result.currentStreak).toBe(0) // no play today or yesterday
	})
})
```

- [ ] **Step 3: Run tests and confirm pass**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/stats/__tests__/calculators.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/stats/calculators.ts apps/dashboard/lib/stats/__tests__/calculators.test.ts
git commit -m "feat(stats): export calculateStreaks for MQTT publisher"
```

---

## Task 2: Add `getLastClosedSession()` query

**Files:**
- Modify: `apps/dashboard/lib/db/queries.ts`
- Create: `apps/dashboard/lib/db/__tests__/queries-last-session.test.ts`

- [ ] **Step 1: Add `isNotNull` to the drizzle-orm import in `queries.ts`**

In `apps/dashboard/lib/db/queries.ts`, line 6, add `isNotNull` to the import:

```ts
import { and, asc, count, desc, eq, gte, isNotNull, isNull, like, lte, max, sql } from 'drizzle-orm'
```

- [ ] **Step 2: Add `getLastClosedSession()` at the end of `queries.ts`**

```ts
export async function getLastClosedSession(): Promise<{
	gameName: string
	system: string
	durationSec: number
} | null> {
	const rows = await db
		.select({
			gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
			system: sessions.system,
			durationSec: sessions.durationSeconds,
		})
		.from(sessions)
		.leftJoin(games, eq(sessions.romPath, games.romPath))
		.where(isNotNull(sessions.endedAt))
		.orderBy(desc(sessions.startedAt))
		.limit(1)
	const row = rows[0]
	if (!row || row.durationSec === null) return null
	return { gameName: row.gameName, system: row.system, durationSec: row.durationSec }
}
```

- [ ] **Step 3: Run TypeScript check to verify the new function types correctly**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | grep -i "queries\|lastClosed" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/db/queries.ts apps/dashboard/lib/db/__tests__/queries-last-session.test.ts
git commit -m "feat(db): add getLastClosedSession query"
```

---

## Task 3: Extend config — schema, defaults, config-store, API route

**Files:**
- Modify: `apps/dashboard/lib/settings/schemas.ts`
- Modify: `apps/dashboard/lib/settings/defaults.ts`
- Modify: `apps/dashboard/lib/config-store.ts`
- Modify: `apps/dashboard/app/api/settings/route.ts`

- [ ] **Step 1: Add `mqttPublishConfigSchema` to `schemas.ts`**

In `apps/dashboard/lib/settings/schemas.ts`, add after the `superRetrogamersConfigSchema` block (around line 17):

```ts
export const mqttPublishConfigSchema = z.object({
	enabled: z.boolean(),
	brokerUrl: z.string().max(256),
	topicPrefix: z.string().max(64),
	homeAssistantDiscovery: z.boolean(),
})

export type MqttPublishConfig = z.infer<typeof mqttPublishConfigSchema>
```

Then extend `appConfigSchema` to include the new scope:

```ts
export const appConfigSchema = z.object({
	recalbox: recalboxConfigSchema,
	scrobble: scrobbleConfigSchema,
	ui: uiConfigSchema,
	retroachievements: retroachievementsConfigSchema,
	superRetrogamers: superRetrogamersConfigSchema,
	mqttPublish: mqttPublishConfigSchema,
})
```

And add the type to the bottom exports:
```ts
export type AppConfig = z.infer<typeof appConfigSchema>
```

(This line already exists — TypeScript will pick up the new field automatically since `appConfigSchema` is updated.)

- [ ] **Step 2: Add defaults to `defaults.ts`**

In `apps/dashboard/lib/settings/defaults.ts`, add `mqttPublish` to the returned object:

```ts
export function getDefaults(): AppConfig {
	return {
		recalbox: {
			host: process.env.RECALBOX_HOST ?? 'recalbox.local',
			sshUser: process.env.RECALBOX_SSH_USER ?? 'root',
			sshPassword: process.env.RECALBOX_SSH_PASSWORD ?? '',
			sshPort: 22,
			mqttPort: 1883,
		},
		scrobble: {
			minDurationSec: Number.parseInt(process.env.MIN_DURATION_SEC ?? '10', 10),
			maxDurationHours: 1,
			orphanRecoveryHours: 12,
		},
		ui: {
			locale: 'en',
			theme: 'system',
			weekStartsOn: 1,
		},
		retroachievements: {
			enabled: false,
			username: '',
			apiKey: '',
			autoSyncMinutes: 30,
		},
		superRetrogamers: {
			enabled: false,
			apiUrl: '',
			preferredRegion: '',
		},
		mqttPublish: {
			enabled: false,
			brokerUrl: '',
			topicPrefix: 'RecalboxDashboard/',
			homeAssistantDiscovery: false,
		},
	}
}
```

- [ ] **Step 3: Add `changed:mqttPublish` to `ConfigStoreEvents` in `config-store.ts`**

In `apps/dashboard/lib/config-store.ts`, find the `ConfigStoreEvents` interface (around line 98) and add:

```ts
interface ConfigStoreEvents {
	changed: (config: AppConfig) => void
	'changed:recalbox': (config: AppConfig) => void
	'changed:scrobble': (config: AppConfig) => void
	'changed:ui': (config: AppConfig) => void
	'changed:retroachievements': (config: AppConfig) => void
	'changed:mqttPublish': (config: AppConfig) => void
	'recalbox:added': (payload: { recalbox: RecalboxInstance }) => void
	'recalbox:updated': (payload: { recalbox: RecalboxInstance }) => void
	'recalbox:removed': (payload: { id: string }) => void
}
```

- [ ] **Step 4: Add `mqttPublish` to PUT schema in `app/api/settings/route.ts`**

In `apps/dashboard/app/api/settings/route.ts`, add `mqttPublish` to `putBodySchema`:

```ts
const putBodySchema = z.object({
	recalbox: z
		.object({
			host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/).optional(),
			sshUser: z.string().min(1).max(32).optional(),
			sshPassword: z.string().min(1).max(128).optional(),
			sshPort: z.number().int().min(1).max(65535).optional(),
			mqttPort: z.number().int().min(1).max(65535).optional(),
		})
		.optional(),
	scrobble: z
		.object({
			minDurationSec: z.number().int().min(0).optional(),
			maxDurationHours: z.number().min(0).optional(),
			orphanRecoveryHours: z.number().min(0).optional(),
		})
		.optional(),
	ui: z
		.object({
			locale: z.string().min(2).max(10).optional(),
			theme: z.enum(['light', 'dark', 'system']).optional(),
			weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
		})
		.optional(),
	retroachievements: z
		.object({
			enabled: z.boolean().optional(),
			username: z.string().max(64).optional(),
			apiKey: z.string().max(256).optional(),
			autoSyncMinutes: z.number().int().min(1).max(1440).optional(),
		})
		.optional(),
	superRetrogamers: z
		.object({
			enabled: z.boolean().optional(),
			apiUrl: z.string().max(256).optional(),
			preferredRegion: z.enum(['US', 'EU', 'JP', '']).optional(),
		})
		.optional(),
	mqttPublish: z
		.object({
			enabled: z.boolean().optional(),
			brokerUrl: z.string().max(256).optional(),
			topicPrefix: z.string().max(64).optional(),
			homeAssistantDiscovery: z.boolean().optional(),
		})
		.optional(),
})
```

- [ ] **Step 5: Run lint to verify no type errors**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to the new types.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/settings/schemas.ts apps/dashboard/lib/settings/defaults.ts apps/dashboard/lib/config-store.ts apps/dashboard/app/api/settings/route.ts
git commit -m "feat(config): add mqttPublish config scope"
```

---

## Task 4: Create `mqtt-publisher.ts`

**Files:**
- Create: `apps/dashboard/lib/recalbox/mqtt-publisher.ts`

- [ ] **Step 1: Create `apps/dashboard/lib/recalbox/mqtt-publisher.ts`**

```ts
import { configStore } from '@/lib/config-store'
import { getLastClosedSession, getSessionStats } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { calculateStreaks } from '@/lib/stats/calculators'
import mqtt from 'mqtt'

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export type AnalyticsSnapshot = {
	playtimeTodaySec: number
	playtimeWeekSec: number
	currentStreak: number
	longestStreak: number
	sessionsToday: number
	topGameWeek: string
	lastGame: { name: string; system: string; durationSec: number } | null
}

export async function computeAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

	const [todayStats, weekStats, allStats, lastGame] = await Promise.all([
		getSessionStats({ fromDate: startOfToday }),
		getSessionStats({ fromDate: weekAgo }),
		getSessionStats({}),
		getLastClosedSession(),
	])

	const { currentStreak, longestStreak } = calculateStreaks(allStats.byDay)
	const topGameWeek = weekStats.topGames[0]?.gameName ?? ''

	return {
		playtimeTodaySec: todayStats.totalPlaytimeSec,
		playtimeWeekSec: weekStats.totalPlaytimeSec,
		currentStreak,
		longestStreak,
		sessionsToday: todayStats.totalSessions,
		topGameWeek,
		lastGame: lastGame
			? { name: lastGame.gameName, system: lastGame.system, durationSec: lastGame.durationSec }
			: null,
	}
}

class MqttPublisher {
	private client: mqtt.MqttClient | null = null
	private topicPrefix = 'RecalboxDashboard/'
	private resolvedUrl = ''
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	isConnected = false

	connect(brokerUrl: string, topicPrefix: string): void {
		this.disconnect()
		this.topicPrefix = topicPrefix
		this.resolvedUrl = brokerUrl || `mqtt://${configStore.getDefaultRecalbox()?.host ?? 'localhost'}:1883`
		this.reconnectAttempt = 0
		this.createConnection()
	}

	private createConnection(): void {
		logger.info(`MQTT publisher connecting to ${this.resolvedUrl}`)
		this.client = mqtt.connect(this.resolvedUrl, {
			clientId: `recalbox-dashboard-pub-${Math.random().toString(16).slice(2, 10)}`,
			reconnectPeriod: 0,
			connectTimeout: 5000,
			will: {
				topic: `${this.topicPrefix}status`,
				payload: Buffer.from('offline'),
				retain: true,
				qos: 1,
			},
		})

		this.client.on('connect', () => {
			this.reconnectAttempt = 0
			this.isConnected = true
			logger.info(`MQTT publisher connected to ${this.resolvedUrl}`)
			this.publishStatus('online')
			if (configStore.get().mqttPublish.homeAssistantDiscovery) {
				this.publishHaDiscovery()
			}
			computeAnalyticsSnapshot()
				.then((snapshot) => this.publishAnalytics(snapshot))
				.catch((err) => logger.error('MQTT publisher: failed to compute initial snapshot', err))
		})

		this.client.on('error', (err) => logger.error('MQTT publisher error', err))
		this.client.on('close', () => {
			this.isConnected = false
			logger.warn(`MQTT publisher disconnected from ${this.resolvedUrl}`)
			this.scheduleReconnect()
		})
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return
		const delay = BACKOFF_DELAYS_MS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)]
		this.reconnectAttempt++
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.resolvedUrl) return
			this.client = null
			this.createConnection()
		}, delay)
	}

	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		this.client?.end()
		this.client = null
		this.isConnected = false
		this.resolvedUrl = ''
	}

	publishAnalytics(snapshot: AnalyticsSnapshot): void {
		if (!this.client || !this.isConnected) return
		const p = this.topicPrefix
		const pub = (topic: string, payload: string) => {
			this.client?.publish(`${p}${topic}`, payload, { retain: true, qos: 1 })
		}
		pub('playtime/today', String(snapshot.playtimeTodaySec))
		pub('playtime/week', String(snapshot.playtimeWeekSec))
		pub('streak/current', String(snapshot.currentStreak))
		pub('streak/longest', String(snapshot.longestStreak))
		pub('sessions/today', String(snapshot.sessionsToday))
		pub('topgame/week', snapshot.topGameWeek)
		pub('lastgame', snapshot.lastGame ? JSON.stringify(snapshot.lastGame) : '')
	}

	publishStatus(status: 'online' | 'offline'): void {
		this.client?.publish(`${this.topicPrefix}status`, status, { retain: true, qos: 1 })
	}

	publishHaDiscovery(): void {
		if (!this.client || !this.isConnected) return
		const prefix = this.topicPrefix
		const device = {
			identifiers: ['recalbox_dashboard'],
			name: 'Recalbox Dashboard',
			model: 'Recalbox Dashboard',
			manufacturer: 'recalbox-dashboard',
		}
		const availability = {
			availability_topic: `${prefix}status`,
			payload_available: 'online',
			payload_not_available: 'offline',
		}
		const sensors: Array<{
			id: string
			name: string
			state_topic: string
			unit_of_measurement?: string
			device_class?: string
		}> = [
			{
				id: 'playtime_today',
				name: 'Recalbox Playtime Today',
				state_topic: `${prefix}playtime/today`,
				unit_of_measurement: 's',
				device_class: 'duration',
			},
			{
				id: 'playtime_week',
				name: 'Recalbox Playtime Week',
				state_topic: `${prefix}playtime/week`,
				unit_of_measurement: 's',
				device_class: 'duration',
			},
			{
				id: 'streak_current',
				name: 'Recalbox Current Streak',
				state_topic: `${prefix}streak/current`,
				unit_of_measurement: 'd',
			},
			{
				id: 'streak_longest',
				name: 'Recalbox Longest Streak',
				state_topic: `${prefix}streak/longest`,
				unit_of_measurement: 'd',
			},
			{
				id: 'sessions_today',
				name: 'Recalbox Sessions Today',
				state_topic: `${prefix}sessions/today`,
			},
			{
				id: 'topgame_week',
				name: 'Recalbox Top Game This Week',
				state_topic: `${prefix}topgame/week`,
			},
			{
				id: 'lastgame',
				name: 'Recalbox Last Game',
				state_topic: `${prefix}lastgame`,
			},
			{
				id: 'status',
				name: 'Recalbox Dashboard Status',
				state_topic: `${prefix}status`,
				device_class: 'connectivity',
			},
		]
		for (const sensor of sensors) {
			const config = {
				name: sensor.name,
				unique_id: `recalbox_dashboard_${sensor.id}`,
				state_topic: sensor.state_topic,
				...(sensor.unit_of_measurement && { unit_of_measurement: sensor.unit_of_measurement }),
				...(sensor.device_class && { device_class: sensor.device_class }),
				...availability,
				device,
			}
			this.client?.publish(
				`homeassistant/sensor/recalbox_dashboard_${sensor.id}/config`,
				JSON.stringify(config),
				{ retain: true, qos: 1 },
			)
		}
	}

	publishHaDiscoveryCleanup(): void {
		if (!this.client || !this.isConnected) return
		const sensorIds = [
			'playtime_today',
			'playtime_week',
			'streak_current',
			'streak_longest',
			'sessions_today',
			'topgame_week',
			'lastgame',
			'status',
		]
		for (const id of sensorIds) {
			this.client?.publish(
				`homeassistant/sensor/recalbox_dashboard_${id}/config`,
				'',
				{ retain: true, qos: 1 },
			)
		}
	}
}

const g = globalThis as typeof globalThis & { __mqttPublisher?: MqttPublisher }
if (!g.__mqttPublisher) g.__mqttPublisher = new MqttPublisher()
export const mqttPublisher = g.__mqttPublisher
```

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `mqtt-publisher.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/recalbox/mqtt-publisher.ts
git commit -m "feat(mqtt): add MqttPublisher singleton and computeAnalyticsSnapshot"
```

---

## Task 5: Test `computeAnalyticsSnapshot` and `MqttPublisher`

**Files:**
- Create: `apps/dashboard/lib/recalbox/__tests__/mqtt-publisher.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/dashboard/lib/recalbox/__tests__/mqtt-publisher.test.ts`:

```ts
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

import { getLastClosedSession, getSessionStats } from '@/lib/db/queries'
import { computeAnalyticsSnapshot, mqttPublisher } from '../mqtt-publisher'

const mockGetSessionStats = vi.mocked(getSessionStats)
const mockGetLastClosedSession = vi.mocked(getLastClosedSession)

beforeEach(() => vi.clearAllMocks())

function makeStats(overrides: Partial<{
	totalPlaytimeSec: number
	totalSessions: number
	topGames: Array<{ gameName: string }>
	byDay: Array<{ date: string; playtimeSec: number }>
}> = {}) {
	return {
		totalPlaytimeSec: overrides.totalPlaytimeSec ?? 0,
		totalSessions: overrides.totalSessions ?? 0,
		uniqueGames: 0,
		avgSessionSec: 0,
		topGames: overrides.topGames ?? [],
		byDay: overrides.byDay ?? [],
		bySystem: [],
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
			.mockResolvedValueOnce(makeStats({ topGames: [{ gameName: 'Super Mario World' }, { gameName: 'Zelda' }] })) // week
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
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/recalbox/__tests__/mqtt-publisher.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/recalbox/__tests__/mqtt-publisher.test.ts
git commit -m "test(mqtt): add computeAnalyticsSnapshot and MqttPublisher tests"
```

---

## Task 6: Wire scrobbler integration

**Files:**
- Modify: `apps/dashboard/lib/scrobbler/index.ts`

- [ ] **Step 1: Replace the full content of `apps/dashboard/lib/scrobbler/index.ts`**

```ts
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db/index'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { getMqttClientFor, mqttPool } from '@/lib/recalbox/mqtt-client'
import { computeAnalyticsSnapshot, mqttPublisher } from '@/lib/recalbox/mqtt-publisher'
import { SessionManager } from './session-manager'

export type Scrobbler = { stop: () => Promise<void> }

async function publishAnalyticsIfEnabled(): Promise<void> {
	try {
		if (!configStore.get().mqttPublish.enabled) return
		const snapshot = await computeAnalyticsSnapshot()
		mqttPublisher.publishAnalytics(snapshot)
	} catch {
		// never propagate — publisher must not crash scrobbler
	}
}

export async function startScrobbler(): Promise<Scrobbler> {
	const manager = new SessionManager(db)
	const recovered = await manager.recoverOrphanSessions()
	if (recovered > 0) logger.info(`Recovered ${recovered} orphan session(s)`)

	// Connect MQTT publisher if enabled
	const initialCfg = configStore.get().mqttPublish
	if (initialCfg.enabled) {
		const url =
			initialCfg.brokerUrl ||
			`mqtt://${configStore.getDefaultRecalbox()?.host ?? 'localhost'}:1883`
		mqttPublisher.connect(url, initialCfg.topicPrefix)
	}

	const subscriptions = new Map<
		string,
		{ start: (e: GameStartEvent) => void; stop: (e: GameStopEvent) => void }
	>()

	function subscribeToRecalbox(recalboxId: string): void {
		if (subscriptions.has(recalboxId)) return
		const client = getMqttClientFor(recalboxId)
		client.connect()

		const onStart = async (event: GameStartEvent) => {
			try {
				await manager.openSession(event, recalboxId)
			} catch (err) {
				logger.error(`Error opening session [${recalboxId}]`, err)
			}
		}
		const onStop = async (event: GameStopEvent) => {
			try {
				await manager.closeSession(event)
				publishAnalyticsIfEnabled()
			} catch (err) {
				logger.error(`Error closing session [${recalboxId}]`, err)
			}
		}

		client.on('game:start', onStart)
		client.on('game:stop', onStop)
		subscriptions.set(recalboxId, { start: onStart, stop: onStop })
		logger.info(`Scrobbler subscribed to Recalbox ${recalboxId}`)
	}

	function unsubscribeFromRecalbox(recalboxId: string): void {
		const handlers = subscriptions.get(recalboxId)
		if (!handlers) return
		try {
			const client = getMqttClientFor(recalboxId)
			client.off('game:start', handlers.start)
			client.off('game:stop', handlers.stop)
		} catch {}
		subscriptions.delete(recalboxId)
		logger.info(`Scrobbler unsubscribed from Recalbox ${recalboxId}`)
	}

	for (const rb of configStore.getRecalboxes().filter((r) => !r.archived)) {
		subscribeToRecalbox(rb.id)
	}

	const onAdded = ({ recalbox }: { recalbox: { id: string; archived: boolean } }) => {
		if (!recalbox.archived) subscribeToRecalbox(recalbox.id)
	}
	const onRemoved = ({ id }: { id: string }) => unsubscribeFromRecalbox(id)
	const onMqttPublishChanged = () => {
		const cfg = configStore.get().mqttPublish
		if (!cfg.enabled) {
			mqttPublisher.disconnect()
			return
		}
		const url =
			cfg.brokerUrl || `mqtt://${configStore.getDefaultRecalbox()?.host ?? 'localhost'}:1883`
		mqttPublisher.connect(url, cfg.topicPrefix)
	}

	configStore.on('recalbox:added', onAdded)
	configStore.on('recalbox:removed', onRemoved)
	configStore.on('changed:mqttPublish', onMqttPublishChanged)

	// Periodic refresh: republish playtime/today every 5 minutes
	const refreshTimer = setInterval(publishAnalyticsIfEnabled, 5 * 60 * 1000)

	logger.info('Scrobbler listening for game events on all Recalboxes')

	return {
		stop: async () => {
			clearInterval(refreshTimer)
			configStore.off('recalbox:added', onAdded)
			configStore.off('recalbox:removed', onRemoved)
			configStore.off('changed:mqttPublish', onMqttPublishChanged)
			for (const id of subscriptions.keys()) unsubscribeFromRecalbox(id)
			await manager.closeAllOpenSessions('daemon_shutdown')
			mqttPublisher.disconnect()
			mqttPool.disconnectAll()
			logger.info('Scrobbler stopped')
		},
	}
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
pnpm lint 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/scrobbler/index.ts
git commit -m "feat(scrobbler): wire MQTT publisher on session close and 5-min timer"
```

---

## Task 7: Settings UI and i18n

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx`

- [ ] **Step 1: Add i18n keys to `messages/en.json`**

In `messages/en.json`, inside the `"settings"` object, add `"mqttPublish"` to the `"tabs"` sub-object:

```json
"tabs": {
  "recalbox": "Recalbox",
  "scrobble": "Scrobble",
  "interface": "Interface",
  "retroachievements": "RetroAchievements",
  "integrations": "Integrations",
  "notifications": "Notifications",
  "app": "App",
  "mqttPublish": "MQTT Publish"
},
```

Then add a top-level `"mqttPublish"` section inside `"settings"` (alongside `"recalbox"`, `"scrobble"`, etc.):

```json
"mqttPublish": {
  "cardTitle": "MQTT Analytics Publishing",
  "cardDescription": "Publish game statistics to MQTT for Home Assistant and other tools",
  "enabled": "Enable MQTT publishing",
  "enabledHint": "Push playtime and streak data to MQTT topics",
  "brokerUrl": "Broker URL",
  "brokerUrlHint": "Leave empty to use your Recalbox MQTT broker",
  "topicPrefix": "Topic prefix",
  "topicPrefixHint": "All topics will be published under this prefix",
  "homeAssistantDiscovery": "Home Assistant Discovery",
  "homeAssistantDiscoveryHint": "Auto-create sensors in Home Assistant via MQTT Discovery",
  "saved": "MQTT Publish settings saved",
  "saveError": "Failed to save settings"
},
```

- [ ] **Step 2: Add i18n keys to `messages/fr.json`**

Add `"mqttPublish"` to `"tabs"` in `fr.json`:

```json
"mqttPublish": "Publication MQTT"
```

Add `"mqttPublish"` section inside `"settings"` in `fr.json`:

```json
"mqttPublish": {
  "cardTitle": "Publication d'analytics MQTT",
  "cardDescription": "Publiez les statistiques de jeu sur MQTT pour Home Assistant et autres outils",
  "enabled": "Activer la publication MQTT",
  "enabledHint": "Envoyer le temps de jeu et les séries sur des topics MQTT",
  "brokerUrl": "URL du broker",
  "brokerUrlHint": "Laisser vide pour utiliser le broker MQTT de Recalbox",
  "topicPrefix": "Préfixe de topic",
  "topicPrefixHint": "Tous les topics seront publiés sous ce préfixe",
  "homeAssistantDiscovery": "Discovery Home Assistant",
  "homeAssistantDiscoveryHint": "Créer automatiquement des capteurs dans Home Assistant via le MQTT Discovery",
  "saved": "Paramètres MQTT sauvegardés",
  "saveError": "Impossible de sauvegarder les paramètres"
},
```

- [ ] **Step 3: Add the `mqttPublishFormSchema` and `MqttPublishForm` type in `settings/page.tsx`**

In `apps/dashboard/app/[locale]/settings/page.tsx`, after the `srFormSchema` block (around line 94), add:

```ts
const mqttPublishFormSchema = z.object({
	enabled: z.boolean(),
	brokerUrl: z.string().max(256),
	topicPrefix: z.string().max(64),
	homeAssistantDiscovery: z.boolean(),
})
type MqttPublishForm = z.infer<typeof mqttPublishFormSchema>
```

- [ ] **Step 4: Add the `MqttPublishTab` component in `settings/page.tsx`**

In `apps/dashboard/app/[locale]/settings/page.tsx`, add the following component before the `// ─── Page` comment (around line 963):

```tsx
// ─── MQTT Publish tab ────────────────────────────────────────────────────────

function MqttPublishTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.mqttPublish')
	const tc = useTranslations('common')

	const form = useForm<MqttPublishForm>({
		resolver: zodResolver(mqttPublishFormSchema),
		defaultValues: {
			enabled: config.mqttPublish.enabled,
			brokerUrl: config.mqttPublish.brokerUrl,
			topicPrefix: config.mqttPublish.topicPrefix,
			homeAssistantDiscovery: config.mqttPublish.homeAssistantDiscovery,
		},
	})

	const enabled = form.watch('enabled')

	async function onSave(values: MqttPublishForm) {
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mqttPublish: values }),
			})
			if (!res.ok) throw new Error()
			const updated: AppConfig = await res.json()
			form.reset({
				enabled: updated.mqttPublish.enabled,
				brokerUrl: updated.mqttPublish.brokerUrl,
				topicPrefix: updated.mqttPublish.topicPrefix,
				homeAssistantDiscovery: updated.mqttPublish.homeAssistantDiscovery,
			})
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
				<FormField
					control={form.control}
					name="enabled"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<FormLabel>{t('enabled')}</FormLabel>
								<FormDescription>{t('enabledHint')}</FormDescription>
							</div>
							<FormControl>
								<Switch checked={field.value} onCheckedChange={field.onChange} />
							</FormControl>
						</FormItem>
					)}
				/>
				{enabled && (
					<>
						<FormField
							control={form.control}
							name="brokerUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t('brokerUrl')}</FormLabel>
									<FormControl>
										<Input placeholder="mqtt://recalbox.local:1883" {...field} />
									</FormControl>
									<FormDescription>{t('brokerUrlHint')}</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="topicPrefix"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t('topicPrefix')}</FormLabel>
									<FormControl>
										<Input placeholder="RecalboxDashboard/" {...field} />
									</FormControl>
									<FormDescription>{t('topicPrefixHint')}</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="homeAssistantDiscovery"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>{t('homeAssistantDiscovery')}</FormLabel>
										<FormDescription>{t('homeAssistantDiscoveryHint')}</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>
					</>
				)}
				<Button type="submit" disabled={!form.formState.isDirty}>
					{tc('save')}
				</Button>
			</form>
		</Form>
	)
}
```

- [ ] **Step 5: Add `Radio` to the lucide-react import and `mqttPublish` to the nav items**

In `settings/page.tsx`, find the lucide-react import block (around line 37) and add `Radio`:

```ts
import {
	Bell,
	CheckCircle2,
	Circle,
	Clock,
	Palette,
	Plug,
	Radio,
	Server,
	Smartphone,
	Trophy,
} from 'lucide-react'
```

In the `navItems` array (around line 981), add the new entry after `integrations`:

```ts
const navItems: NavItem[] = [
	{ value: 'recalbox', icon: Server, label: t('tabs.recalbox'), mobileLabel: 'Recalbox' },
	{ value: 'scrobble', icon: Clock, label: t('tabs.scrobble'), mobileLabel: 'Scrobble' },
	{ value: 'interface', icon: Palette, label: t('tabs.interface'), mobileLabel: 'UI' },
	{
		value: 'retroachievements',
		icon: Trophy,
		label: t('tabs.retroachievements'),
		mobileLabel: 'Retro',
	},
	{ value: 'integrations', icon: Plug, label: t('tabs.integrations'), mobileLabel: 'Intégr.' },
	{
		value: 'mqttPublish',
		icon: Radio,
		label: t('tabs.mqttPublish'),
		mobileLabel: 'MQTT',
	},
	{ value: 'notifications', icon: Bell, label: t('tabs.notifications'), mobileLabel: 'Notifs' },
	{ value: 'app', icon: Smartphone, label: t('tabs.app'), mobileLabel: 'App' },
]
```

- [ ] **Step 6: Add the `mqttPublish` panel to the page render in `settings/page.tsx`**

In the render section (around line 1057), after the `{active === 'integrations' && ...}` block and before `{active === 'notifications' && ...}`, add:

```tsx
{active === 'mqttPublish' && (
	<Card>
		<CardHeader>
			<CardTitle>{t('mqttPublish.cardTitle')}</CardTitle>
			<CardDescription>{t('mqttPublish.cardDescription')}</CardDescription>
		</CardHeader>
		<CardContent>
			<MqttPublishTab config={config} />
		</CardContent>
	</Card>
)}
```

- [ ] **Step 7: Run TypeScript check**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Run lint**

```bash
pnpm lint 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/app/[locale]/settings/page.tsx apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(settings): add MQTT Publish section to settings page"
```

---

## Task 8: Write `docs/mqtt-api.md` and update README

**Files:**
- Create: `docs/mqtt-api.md`
- Modify: `README.md`

- [ ] **Step 1: Create `docs/mqtt-api.md`**

```markdown
# MQTT Analytics API

The dashboard can publish game analytics to MQTT when **MQTT Publish** is enabled in Settings.
This allows Home Assistant, Node-RED, and any MQTT-capable tool to consume live stats.

## Configuration

Enable in **Settings → MQTT Publish**:

| Setting | Default | Description |
|---|---|---|
| Broker URL | *(Recalbox broker)* | Leave empty to use the same broker as your Recalbox |
| Topic prefix | `RecalboxDashboard/` | All topics are published under this prefix |
| Home Assistant Discovery | off | Auto-create entities in HA |

## Topics

All messages are published with `retain: true` so a client that connects later receives the last value immediately.

| Topic | Payload | When published |
|---|---|---|
| `{prefix}status` | `online` / `offline` | On connect (online) and via LWT (offline) |
| `{prefix}playtime/today` | Seconds (integer string) | On session close + every 5 min |
| `{prefix}playtime/week` | Seconds (integer string) | On session close + every 5 min |
| `{prefix}streak/current` | Days (integer string) | On session close |
| `{prefix}streak/longest` | Days (integer string) | On session close |
| `{prefix}sessions/today` | Count (integer string) | On session close |
| `{prefix}topgame/week` | Game title (string) | On session close |
| `{prefix}lastgame` | JSON `{"name":"…","system":"…","durationSec":N}` | On session close |

The default prefix is `RecalboxDashboard/`, so the full topic for today's playtime is `RecalboxDashboard/playtime/today`.

## Home Assistant Discovery

When **Home Assistant Discovery** is enabled, the dashboard publishes MQTT Discovery messages on startup so HA auto-creates entities:

| Entity | HA unique ID | Device class |
|---|---|---|
| Playtime Today | `recalbox_dashboard_playtime_today` | `duration` |
| Playtime Week | `recalbox_dashboard_playtime_week` | `duration` |
| Current Streak | `recalbox_dashboard_streak_current` | — |
| Longest Streak | `recalbox_dashboard_streak_longest` | — |
| Sessions Today | `recalbox_dashboard_sessions_today` | — |
| Top Game (Week) | `recalbox_dashboard_topgame_week` | — |
| Last Game | `recalbox_dashboard_lastgame` | — |
| Status | `recalbox_dashboard_status` | `connectivity` |

All entities share the device `Recalbox Dashboard` with identifier `recalbox_dashboard`.
Disable HA Discovery to remove the entities from Home Assistant (empty payload sent on each config topic).

## API Stability

Once enabled, topic names under the default prefix are stable and will not change in a breaking way without a major version bump.

## Testing

Subscribe to all topics with mosquitto:

```bash
mosquitto_sub -h recalbox.local -p 1883 -t 'RecalboxDashboard/#' -v
```
```

- [ ] **Step 2: Add Ecosystem section to `README.md`**

Find the end of the README (or after the Architecture section) and add:

```markdown
## Ecosystem & MQTT

The dashboard can publish its analytics to MQTT so other tools in your home automation stack can consume them.

Enable **Settings → MQTT Publish** to push playtime, streaks, and last-game data to topics like `RecalboxDashboard/playtime/today`. Enable **Home Assistant Discovery** to have sensors appear automatically in Home Assistant.

See [docs/mqtt-api.md](docs/mqtt-api.md) for the full topic reference.
```

- [ ] **Step 3: Commit**

```bash
git add docs/mqtt-api.md README.md
git commit -m "docs(mqtt): add MQTT API reference and README ecosystem section"
```

---

## Task 9: Final build check

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Run lint on the full codebase**

```bash
pnpm lint 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(mqtt): publish analytics to MQTT for ecosystem interop"
```
