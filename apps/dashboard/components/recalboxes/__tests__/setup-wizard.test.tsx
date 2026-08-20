// @vitest-environment jsdom
import { SetupWizard } from '@/components/recalboxes/setup-wizard'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
	// jsdom doesn't implement the Blob URL APIs, and it logs a "navigation not
	// implemented" warning when a real click on an <a href="blob:…" download>
	// runs — it doesn't understand the `download` attribute suppresses
	// navigation the way a real browser does. Stub both away: the download
	// path only needs them to exist and not throw, not to do anything real.
	URL.createObjectURL = vi.fn(() => 'blob:mock-url')
	URL.revokeObjectURL = vi.fn()
	HTMLAnchorElement.prototype.click = vi.fn()
})
afterEach(() => {
	// This test file imports `afterEach` rather than relying on it as a global
	// (the repo doesn't set `test.globals: true`), so @testing-library/react's
	// own auto-cleanup — which only registers if it finds a *global* `afterEach`
	// at import time — never fires. Without this, unmounted components (and
	// their "download"/"install"/"connected" text) pile up in the DOM across
	// tests in this file and later queries start matching more than one node.
	cleanup()
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
		// A flag-guarded "stop" (skip the fetch when already seen, but leave the
		// interval ticking) would also pass a plain call-count assertion. Spying
		// on clearInterval proves the interval itself was actually torn down.
		const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.connected)).toBeInTheDocument(),
		)
		expect(clearIntervalSpy).toHaveBeenCalled()
		const callsAfterConnect = fetchMock.mock.calls.length
		await vi.advanceTimersByTimeAsync(30_000)
		expect(fetchMock.mock.calls.length).toBe(callsAfterConnect)
	})

	it('affiche un message générique quand la création échoue avec un corps illisible', async () => {
		// Non-OK response whose body isn't the route's own JSON (an unhandled
		// 500 rendering an HTML error page, a proxy error, …) — `error` can't be
		// read off it, so the generic fallback must carry the message instead of
		// leaving the user with nothing.
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response('<html>Internal Server Error</html>', { status: 500 })),
		)
		renderAt({ startAt: 'name' })
		fireEvent.change(screen.getByPlaceholderText(messages.recalboxes.wizard.namePlaceholder), {
			target: { value: 'Salon' },
		})
		fireEvent.click(screen.getByRole('button', { name: messages.recalboxes.wizard.next }))
		await waitFor(() => expect(screen.getByText(messages.common.error)).toBeInTheDocument())
	})

	it('affiche downloadError et reste sur l écran d installation si le téléchargement échoue', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
		)
		renderAt({ startAt: 'install', recalboxId: 'rb-1' })
		fireEvent.click(screen.getByRole('button', { name: messages.recalboxes.wizard.download }))
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.downloadError)).toBeInTheDocument(),
		)
		expect(screen.getByText(messages.recalboxes.wizard.installTitle)).toBeInTheDocument()
	})

	it('ne montre pas d erreur quand le téléchargement réussit', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response('zip-bytes', {
					status: 200,
					headers: {
						'Content-Disposition': 'attachment; filename="recalbox-dashboard-salon.zip"',
					},
				}),
			),
		)
		renderAt({ startAt: 'install', recalboxId: 'rb-1' })
		fireEvent.click(screen.getByRole('button', { name: messages.recalboxes.wizard.download }))
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: messages.recalboxes.wizard.download }),
			).not.toBeDisabled(),
		)
		expect(screen.queryByText(messages.recalboxes.wizard.downloadError)).not.toBeInTheDocument()
	})
})
