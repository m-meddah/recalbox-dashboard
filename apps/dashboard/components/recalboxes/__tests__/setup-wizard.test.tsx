// @vitest-environment jsdom
import { SetupWizard } from '@/components/recalboxes/setup-wizard'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import messages from '@/messages/fr.json'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function renderAt(props: Parameters<typeof SetupWizard>[0]) {
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			<SetupWizard {...props} />
		</NextIntlClientProvider>,
	)
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('SetupWizard', () => {
	it('affiche l écran d attente quand on y entre directement', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ seen: false, lastSeenAt: null }))),
		)
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		expect(screen.getByText(messages.recalboxes.wizard.waitTitle)).toBeInTheDocument()
	})

	it('bascule au vert dès que la box a appelé', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ seen: true, lastSeenAt: '2026-08-18T20:00:00Z' })),
				),
		)
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.connected)).toBeInTheDocument(),
		)
	})

	it('déroule le dépannage au bout de trois minutes sans réponse', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ seen: false, lastSeenAt: null }))),
		)
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 1000)
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.troubleTitle)).toBeInTheDocument(),
		)
	})

	it('arrête d interroger le serveur une fois la box vue', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ seen: true, lastSeenAt: '2026-08-18T20:00:00Z' })),
			)
		vi.stubGlobal('fetch', fetchMock)
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.connected)).toBeInTheDocument(),
		)
		const callsAfterConnect = fetchMock.mock.calls.length
		await vi.advanceTimersByTimeAsync(30_000)
		expect(fetchMock.mock.calls.length).toBe(callsAfterConnect)
	})
})
