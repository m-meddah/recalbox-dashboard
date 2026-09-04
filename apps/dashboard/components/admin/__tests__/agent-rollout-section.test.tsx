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
		// strings by construction, so an unscoped query is ambiguous. Cells are
		// read by position rather than text, since 1.1.0's boxes and
		// seenLastHour are both "1" — a text query alone would be ambiguous too.
		stubFetch()
		renderSection()
		const table = await screen.findByRole('table')
		const rows = within(table).getAllByRole('row').slice(1) // drop the header row
		expect(rows).toHaveLength(2)
		const cellsOf = (row: HTMLElement) =>
			within(row)
				.getAllByRole('cell')
				.map((cell) => cell.textContent)
		expect(cellsOf(rows[0] as HTMLElement)).toEqual(['1.1.0', '1', '1'])
		expect(cellsOf(rows[1] as HTMLElement)).toEqual(['1.0.0', '3', '2'])
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

	it('keeps the persisted target selectable even if no box currently reports it', async () => {
		// The select must never display a value it cannot also offer: that is
		// the exact failure mode it exists to prevent, just relocated.
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => ({ ...state, targetVersion: '1.2.0' }),
				}),
			),
		)
		renderSection()
		const select = (await screen.findByLabelText('Version cible')) as HTMLSelectElement
		expect([...select.options].map((o) => o.value).sort()).toEqual(['1.0.0', '1.1.0', '1.2.0'])
		expect(select.value).toBe('1.2.0')
	})

	it('marks the active percentage step as pressed inside a labelled group', async () => {
		stubFetch()
		renderSection()
		const group = await screen.findByRole('group', { name: messages.agentRollout.percent })
		const zeroButton = within(group).getByRole('button', { name: '0' })
		const tenButton = within(group).getByRole('button', { name: '10' })
		expect(zeroButton).toHaveAttribute('aria-pressed', 'true')
		expect(tenButton).toHaveAttribute('aria-pressed', 'false')
	})

	it('shows a retry control when the initial load fails, and retrying issues a new GET', async () => {
		const get = vi
			.fn()
			.mockResolvedValueOnce({ ok: false })
			.mockResolvedValue({
				ok: true,
				json: async () => state,
			})
		vi.stubGlobal('fetch', get)
		renderSection()
		expect(await screen.findByText(messages.agentRollout.loadError)).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: messages.agentRollout.retry }))
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
		expect(await screen.findByRole('table')).toBeInTheDocument()
	})
})
