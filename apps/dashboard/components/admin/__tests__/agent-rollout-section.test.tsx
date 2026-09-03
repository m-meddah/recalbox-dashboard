// @vitest-environment jsdom
import { AgentRolloutSection } from '@/components/admin/agent-rollout-section'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import messages from '@/messages/fr.json'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

function renderSection() {
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			<AgentRolloutSection />
		</NextIntlClientProvider>,
	)
}

const state = {
	deployedVersion: '1.1.0',
	targetVersion: '1.1.0',
	rolloutPercent: 0,
	versions: [
		{ version: '1.1.0', boxes: 1, seenLastHour: 1 },
		{ version: '1.0.0', boxes: 3, seenLastHour: 2 },
	],
}

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

function stubFetch(put = vi.fn().mockResolvedValue({ ok: true })) {
	vi.stubGlobal(
		'fetch',
		vi.fn((_url: string, init?: RequestInit) =>
			init?.method === 'PUT' ? put(init) : Promise.resolve({ ok: true, json: async () => state }),
		),
	)
}

describe('AgentRolloutSection', () => {
	it('shows one row per version with its liveness', async () => {
		// Scoped to the table: the select's options carry the same version
		// strings by construction, so an unscoped query is ambiguous.
		stubFetch()
		renderSection()
		const table = await screen.findByRole('table')
		expect(within(table).getByText('1.0.0')).toBeInTheDocument()
		expect(within(table).getByText('1.1.0')).toBeInTheDocument()
	})

	it('offers only versions that exist, never a free text field', async () => {
		// The guard against typing a version that exists nowhere lives in the UI
		// as well as the API: the select cannot express the mistake.
		stubFetch()
		renderSection()
		const select = (await screen.findByLabelText('Version cible')) as HTMLSelectElement
		expect(select.tagName).toBe('SELECT')
		expect([...select.options].map((o) => o.value).sort()).toEqual(['1.0.0', '1.1.0'])
	})

	it('sends the chosen percentage step', async () => {
		const put = vi.fn().mockResolvedValue({ ok: true })
		stubFetch(put)
		renderSection()
		fireEvent.click(await screen.findByRole('button', { name: '25' }))
		await waitFor(() => expect(put).toHaveBeenCalled())
		expect(JSON.parse(put.mock.calls[0]?.[0].body)).toEqual({ rolloutPercent: 25 })
	})
})
