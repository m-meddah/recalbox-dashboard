import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getViewable = vi.fn()
const loadRecalboxes = vi.fn()
const getAllNowPlaying = vi.fn()
const getAgentLastSeen = vi.fn()
const getLatestSnapshots = vi.fn()
const getUnpushedInApp = vi.fn()
const markPushedInApp = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	getViewableRecalboxIds: (...a: unknown[]) => getViewable(...a),
}))
vi.mock('@/lib/auth/recalbox-acl', () => ({ loadRecalboxes: () => loadRecalboxes() }))
// Serverless: no MQTT clients, so the DB polls drive the stream.
vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => true }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/now-playing', async () => {
	const actual =
		await vi.importActual<typeof import('@/lib/db/now-playing')>('@/lib/db/now-playing')
	return { ...actual, getAllNowPlaying: () => getAllNowPlaying() }
})
vi.mock('@/lib/db/agent-liveness', () => ({
	AGENT_LIVENESS_MS: 120_000,
	getAgentLastSeen: () => getAgentLastSeen(),
}))
vi.mock('@/lib/db/system-info', () => ({
	getLatestSnapshots: () => getLatestSnapshots(),
	snapshotToSystemInfo: (row: { recalboxId: string }) => ({
		type: 'system:info',
		cpuTemp: 42,
		_from: row.recalboxId,
	}),
}))
// Capture the 'created' listener so a notification can be pushed deterministically.
// (The catch-up poll only fires after 20s — driving THAT would just test the timer.)
let onCreated: ((n: unknown) => void) | null = null
vi.mock('@/lib/notifications/service', () => ({
	getNotificationService: () => ({
		on: (_e: string, fn: (n: unknown) => void) => {
			onCreated = fn
		},
		off: () => {},
		getUnpushedInApp: () => getUnpushedInApp(),
		markPushedInApp: (id: number) => markPushedInApp(id),
	}),
}))
vi.mock('@/lib/feedback/service', () => ({
	feedbackService: { getUnpushed: async () => [], markPushed: async () => {} },
}))
vi.mock('@/lib/recalbox/mqtt-client', () => ({ mqttPool: { getClient: () => null } }))

import { GET } from '../route'

const MINE = 'rb-mine'
const OTHER = 'rb-other'

const nowPlayingRow = (recalboxId: string) => ({
	recalboxId,
	playing: true,
	romPath: `/roms/${recalboxId}.zip`,
	gameName: recalboxId,
	system: 'snes',
	startedAt: new Date(),
	updatedAt: new Date(),
})

function setup() {
	getUser.mockResolvedValue({ id: 'u1', email: 'u@x.y', role: 'member' })
	getViewable.mockResolvedValue([MINE])
	loadRecalboxes.mockResolvedValue([
		{ id: MINE, archived: false },
		{ id: OTHER, archived: false },
	])
	// Every source spans the whole deployment — that is the point.
	getAllNowPlaying.mockResolvedValue([nowPlayingRow(MINE), nowPlayingRow(OTHER)])
	getAgentLastSeen.mockResolvedValue(
		new Map([
			[MINE, new Date()],
			[OTHER, new Date()],
		]),
	)
	getLatestSnapshots.mockResolvedValue(
		new Map([
			[MINE, { id: 1, recalboxId: MINE }],
			[OTHER, { id: 2, recalboxId: OTHER }],
		]),
	)
	getUnpushedInApp.mockResolvedValue([])
	markPushedInApp.mockResolvedValue(true)
}

/** Open the stream, collect what it emits, then abort so the route tears its timers down. */
async function collect(url: string, onOpen?: () => void): Promise<Record<string, unknown>[]> {
	const ac = new AbortController()
	const res = await GET(new Request(url, { signal: ac.signal }))
	onOpen?.()
	const reader = (res.body as ReadableStream<Uint8Array>).getReader()
	const out: Record<string, unknown>[] = []
	const decoder = new TextDecoder()
	const deadline = Date.now() + 500
	try {
		while (Date.now() < deadline) {
			const chunk = await Promise.race([
				reader.read(),
				new Promise<null>((r) => setTimeout(() => r(null), 150)),
			])
			if (!chunk || chunk.done) break
			for (const line of decoder.decode(chunk.value).split('\n')) {
				if (line.startsWith('data: ')) out.push(JSON.parse(line.slice(6)))
			}
		}
	} finally {
		ac.abort()
		reader.cancel().catch(() => {})
	}
	return out
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('GET /api/events authorization', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await GET(new Request('http://x/api/events'))
		expect(res.status).toBe(401)
	})

	it('403s when asking for a box the user cannot view', async () => {
		setup()
		const res = await GET(new Request(`http://x/api/events?recalboxId=${OTHER}`))
		expect(res.status).toBe(403)
	})

	it('allows a box the user owns', async () => {
		setup()
		const res = await GET(new Request(`http://x/api/events?recalboxId=${MINE}`))
		expect(res.status).toBe(200)
	})

	// The regression this fix exists for: every feeding query spans all boxes, so an
	// unfiltered stream used to leak other tenants' live game, stats and online state.
	it('never emits another user’s box, even with no filter', async () => {
		setup()
		const events = await collect('http://x/api/events')
		expect(events.length).toBeGreaterThan(0)
		expect(events.some((e) => e.recalboxId === MINE)).toBe(true)
		expect(events.some((e) => e.recalboxId === OTHER)).toBe(false)
	})
})

const notif = (id: number, recalboxId: string | null) => ({
	id,
	recalboxId,
	type: 'x',
	data: '{}',
	createdAt: new Date(),
})

describe('GET /api/events notification scoping', () => {
	it('does not deliver — or CLAIM — a notification for a box the user cannot view', async () => {
		setup()
		const events = await collect('http://x/api/events', () => onCreated?.(notif(7, OTHER)))
		expect(events.some((e) => e.type === 'notification')).toBe(false)
		// Claiming is atomic: claiming someone else's notification would mean the
		// rightful owner never receives it at all.
		expect(markPushedInApp).not.toHaveBeenCalled()
	})

	it('delivers a notification for a box the user owns', async () => {
		setup()
		const events = await collect('http://x/api/events', () => onCreated?.(notif(8, MINE)))
		expect(events.some((e) => e.type === 'notification')).toBe(true)
		expect(markPushedInApp).toHaveBeenCalledWith(8)
	})

	it('delivers a global (box-less) notification', async () => {
		setup()
		const events = await collect('http://x/api/events', () => onCreated?.(notif(9, null)))
		expect(events.some((e) => e.type === 'notification')).toBe(true)
		expect(markPushedInApp).toHaveBeenCalledWith(9)
	})

	// Notifications are deliberately exempt from the ?recalboxId= UI filter: the bell
	// is cross-box, so narrowing the activity stream must not silence the other boxes.
	it('still delivers notifications from a non-active box when the stream is filtered', async () => {
		setup()
		getViewable.mockResolvedValue([MINE, 'rb-second'])
		const events = await collect(`http://x/api/events?recalboxId=${MINE}`, () =>
			onCreated?.(notif(10, 'rb-second')),
		)
		expect(events.some((e) => e.type === 'notification')).toBe(true)
	})
})
