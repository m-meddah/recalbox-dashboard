// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { RecalboxInstance } from '@/lib/settings/schemas'
import messages from '@/messages/fr.json'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getViewableRecalboxIds = vi.fn()
const loadRecalboxes = vi.fn()
const getActiveRecalboxId = vi.fn()
const isServerlessMode = vi.fn()
const listAgentTokens = vi.fn()

vi.mock('@/lib/auth/require-user', () => ({
	getUser: () => getUser(),
}))
vi.mock('@/lib/auth/ownership', () => ({
	getViewableRecalboxIds: (...args: unknown[]) => getViewableRecalboxIds(...args),
}))
vi.mock('@/lib/auth/recalbox-acl', () => ({
	loadRecalboxes: () => loadRecalboxes(),
}))
vi.mock('@/lib/recalbox/active', () => ({
	getActiveRecalboxId: () => getActiveRecalboxId(),
}))
vi.mock('@/lib/serverless', () => ({
	isServerlessMode: () => isServerlessMode(),
}))
vi.mock('@/lib/db', () => ({
	db: {},
}))
vi.mock('@/lib/db/agent-queries', () => ({
	listAgentTokens: (...args: unknown[]) => listAgentTokens(...args),
}))

// Server-only next-intl needs a live request context we don't have under
// Vitest. Stub it with a translator that reads the real messages/fr.json —
// the same file the assertions below check against — so a copy typo would
// fail here exactly like it would in the app.
// biome-ignore lint/suspicious/noExplicitAny: recursive JSON message tree
function readNested(obj: any, path: string): unknown {
	return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj)
}
vi.mock('next-intl/server', () => ({
	getTranslations: async (namespace: string) => {
		const ns = readNested(messages, namespace)
		return (key: string) => {
			const value = readNested(ns, key)
			return typeof value === 'string' ? value : key
		}
	},
}))

const { default: RecalboxesPage } = await import('../page')

function makeRecalbox(overrides: Partial<RecalboxInstance> & { id: string }): RecalboxInstance {
	return {
		name: 'Salon',
		host: 'recalbox.local',
		sshUser: 'root',
		sshPassword: 'secret',
		sshPort: 22,
		mqttPort: 1883,
		color: null,
		iconEmoji: null,
		ownerUserId: 'u1',
		isDefault: false,
		archived: false,
		...overrides,
	}
}

async function renderPage() {
	const jsx = await RecalboxesPage()
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			{jsx}
		</NextIntlClientProvider>,
	)
}

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	getActiveRecalboxId.mockResolvedValue(null)
})

afterEach(() => {
	cleanup()
	vi.resetAllMocks()
})

describe('RecalboxesPage — box en attente d’installation', () => {
	it('étiquette la box jamais vue et lui offre une reprise', async () => {
		const rb1 = makeRecalbox({ id: 'rb-1', name: 'Salon' })
		const rb2 = makeRecalbox({ id: 'rb-2', name: 'Chambre' })
		loadRecalboxes.mockResolvedValue([rb1, rb2])
		getViewableRecalboxIds.mockResolvedValue(['rb-1', 'rb-2'])
		isServerlessMode.mockReturnValue(true)
		listAgentTokens.mockImplementation((_db: unknown, recalboxId: string) =>
			Promise.resolve(
				recalboxId === 'rb-1'
					? []
					: [{ id: 't1', lastUsedAt: new Date('2026-08-18T20:00:00Z'), revokedAt: null }],
			),
		)

		await renderPage()

		expect(screen.getByText(messages.recalboxes.wizard.pending)).toBeInTheDocument()
		expect(screen.getByRole('link', { name: messages.recalboxes.wizard.resume })).toHaveAttribute(
			'href',
			expect.stringContaining('rb-1'),
		)
	})

	it('ne propose pas de reprise pour une box déjà vue', async () => {
		const rb1 = makeRecalbox({ id: 'rb-1', name: 'Salon' })
		const rb2 = makeRecalbox({ id: 'rb-2', name: 'Chambre' })
		loadRecalboxes.mockResolvedValue([rb1, rb2])
		getViewableRecalboxIds.mockResolvedValue(['rb-1', 'rb-2'])
		isServerlessMode.mockReturnValue(true)
		listAgentTokens.mockImplementation((_db: unknown, recalboxId: string) =>
			Promise.resolve(
				recalboxId === 'rb-1'
					? []
					: [{ id: 't1', lastUsedAt: new Date('2026-08-18T20:00:00Z'), revokedAt: null }],
			),
		)

		await renderPage()

		// Only one box is pending — one label, one resume link, not two of either.
		expect(screen.getAllByText(messages.recalboxes.wizard.pending)).toHaveLength(1)
		expect(screen.getAllByRole('link', { name: messages.recalboxes.wizard.resume })).toHaveLength(1)
	})

	it('masque les informations SSH/MQTT en mode serverless', async () => {
		const rb1 = makeRecalbox({ id: 'rb-1', host: 'recalbox.local', sshPort: 22, mqttPort: 1883 })
		const rb2 = makeRecalbox({ id: 'rb-2', host: 'recalbox.local', sshPort: 22, mqttPort: 1883 })
		loadRecalboxes.mockResolvedValue([rb1, rb2])
		getViewableRecalboxIds.mockResolvedValue(['rb-1', 'rb-2'])
		isServerlessMode.mockReturnValue(true)
		listAgentTokens.mockResolvedValue([])

		await renderPage()

		expect(screen.queryByText(/SSH:22/)).not.toBeInTheDocument()
		expect(screen.queryByText(/MQTT:1883/)).not.toBeInTheDocument()
	})

	it('mode auto-hébergé : garde SSH/MQTT visibles et ne montre jamais la reprise', async () => {
		const rb1 = makeRecalbox({ id: 'rb-1', host: 'recalbox.local', sshPort: 22, mqttPort: 1883 })
		loadRecalboxes.mockResolvedValue([rb1])
		getViewableRecalboxIds.mockResolvedValue(['rb-1'])
		isServerlessMode.mockReturnValue(false)

		await renderPage()

		expect(screen.getByText(/SSH:22/)).toBeInTheDocument()
		expect(screen.queryByText(messages.recalboxes.wizard.pending)).not.toBeInTheDocument()
		expect(
			screen.queryByRole('link', { name: messages.recalboxes.wizard.resume }),
		).not.toBeInTheDocument()
		// Self-hosted never needs the agent-status lookup — no DB round trip per box.
		expect(listAgentTokens).not.toHaveBeenCalled()
	})
})
