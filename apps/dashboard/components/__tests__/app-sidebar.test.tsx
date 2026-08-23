// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import messages from '@/messages/fr.json'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `@/i18n/navigation`'s Link/usePathname/useRouter wrap next/navigation, which
// throws ("invariant expected app router to be mounted") without a real
// AppRouterContext — not present under Vitest. Stub the whole module with
// plain equivalents; the sidebar only needs an <a href> and a pathname.
vi.mock('@/i18n/navigation', () => ({
	Link: ({
		href,
		children,
		prefetch: _prefetch,
		...props
	}: ComponentProps<'a'> & { href: string; prefetch?: boolean }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	usePathname: () => '/',
	useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

// Footer widgets unrelated to nav-item visibility; LanguageSwitcher pulls in
// the same navigation hooks plus a Radix/base-ui Select, so stub both out to
// keep this test focused on the sidebar's own nav list.
vi.mock('@/components/language-switcher', () => ({
	LanguageSwitcher: () => null,
}))
vi.mock('@/components/theme-toggle', () => ({
	ThemeToggle: () => null,
}))

function renderSidebar(props: ComponentProps<typeof AppSidebar> = {}) {
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			<SidebarProvider>
				<AppSidebar {...props} />
			</SidebarProvider>
		</NextIntlClientProvider>,
	)
}

beforeEach(() => {
	// jsdom has no matchMedia; SidebarProvider's useIsMobile() calls it
	// unconditionally on mount.
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}))
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('AppSidebar — accès à /recalboxes', () => {
	it('affiche une entrée Recalboxes qui pointe vers /recalboxes', () => {
		renderSidebar()
		const link = screen.getByRole('link', { name: messages.nav.recalboxes })
		expect(link).toHaveAttribute('href', '/recalboxes')
	})

	it('reste visible en mode serverless', () => {
		renderSidebar({ serverless: true })
		expect(screen.getByRole('link', { name: messages.nav.recalboxes })).toHaveAttribute(
			'href',
			'/recalboxes',
		)
	})

	it('reste visible en mode auto-hébergé', () => {
		renderSidebar({ serverless: false })
		expect(screen.getByRole('link', { name: messages.nav.recalboxes })).toHaveAttribute(
			'href',
			'/recalboxes',
		)
	})
})
