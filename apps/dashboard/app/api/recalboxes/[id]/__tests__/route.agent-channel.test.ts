// apps/dashboard/app/api/recalboxes/[id]/__tests__/route.agent-channel.test.ts
//
// End-to-end round trip through the REAL route handlers + REAL configStore +
// an in-memory DB (not the fully-mocked configStore used by route.test.ts).
// A field that's accepted by the zod schema but silently dropped somewhere in
// the write path (configStore.updateRecalboxConfig's whitelist, rowToInstance,
// updateRecalbox) would not fail the typecheck — this is the only test that
// would catch it.
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../../../drizzle/migrations')

const { db, sqlite } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db/index', () => ({ db }))

const getUser = vi.fn()
vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: () => true,
	canControlRecalbox: () => true,
}))

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long-aaaa'
	const { migrate } = require('drizzle-orm/better-sqlite3/migrator')
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	getUser.mockResolvedValue({ id: 'owner-1', email: 'o@b.c', role: 'member' })
})

afterAll(() => {
	// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
	delete process.env.BETTER_AUTH_SECRET
	sqlite.close()
})

describe('agentChannel round trip through PUT/GET /api/recalboxes/[id]', () => {
	it('a PUT with agentChannel: "beta" is reflected by a subsequent GET', async () => {
		const { insertRecalbox } = await import('@/lib/db/recalbox-queries')
		const { configStore } = await import('@/lib/config-store')
		const { GET, PUT } = await import('../route')

		await insertRecalbox({
			id: 'rb-channel-1',
			name: 'Salon',
			host: '10.0.0.9',
			sshUser: 'root',
			sshPassword: 'recalboxroot',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: true,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})
		await configStore.hydrate()

		const ctx = { params: Promise.resolve({ id: 'rb-channel-1' }) }

		const putRes = await PUT(
			new Request('http://localhost/api/recalboxes/rb-channel-1', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ agentChannel: 'beta' }),
				// biome-ignore lint/suspicious/noExplicitAny: NextRequest shape not needed here
			}) as any,
			ctx as never,
		)
		expect(putRes.status).toBe(200)
		const putBody = (await putRes.json()) as { agentChannel?: string }
		expect(putBody.agentChannel).toBe('beta')

		const getRes = await GET({} as never, ctx as never)
		expect(getRes.status).toBe(200)
		const getBody = (await getRes.json()) as { agentChannel?: string }
		expect(getBody.agentChannel).toBe('beta')
	})
})
