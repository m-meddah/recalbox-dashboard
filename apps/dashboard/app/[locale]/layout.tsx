import { ThemeProvider } from '@/components/theme-provider'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { Roboto } from 'next/font/google'
import { notFound } from 'next/navigation'
import '../globals.css'
import { AppSidebar } from '@/components/app-sidebar'
import { CanControlProvider } from '@/components/can-control-provider'
import { FeedbackPromptProvider } from '@/components/feedback/feedback-prompt-provider'
import { NotificationBell } from '@/components/notification-bell'
import { NotificationListener } from '@/components/notification-listener'
import { PowerControls } from '@/components/power-controls'
import { InstallBanner } from '@/components/pwa/install-banner'
import { ServiceWorkerUpdater } from '@/components/pwa/service-worker-updater'
import { RecalboxSwitcher } from '@/components/recalbox-switcher'
import { ServerlessProvider } from '@/components/serverless-provider'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { routing } from '@/i18n/routing'
import { canControlRecalbox, getViewableRecalboxIds, isAdmin } from '@/lib/auth/ownership'
import { loadRecalboxes } from '@/lib/auth/recalbox-acl'
import { getUser } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { isServerlessMode } from '@/lib/serverless'
import { buildSeedState } from '@/lib/sse/build-seed-state'
import { cn } from '@/lib/utils'
import { RecalboxEventsProvider } from '../recalbox-events-provider'

const roboto = Roboto({
	subsets: ['latin'],
	weight: ['300', '400', '500', '700'],
	variable: '--font-sans',
})

type Props = {
	children: React.ReactNode
	params: Promise<{ locale: string }>
}

export async function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }))
}

export const metadata: Metadata = {
	title: 'Recalbox Dashboard',
	description:
		'Companion analytics dashboard for your Recalbox — playtime history, achievement progress, and an annual recap.',
	manifest: '/manifest.webmanifest',
	appleWebApp: {
		capable: true,
		statusBarStyle: 'black-translucent',
		title: 'Recalbox',
	},
	other: {
		'apple-mobile-web-app-capable': 'yes',
	},
}

export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#ffffff' },
		{ media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
	],
	viewportFit: 'cover',
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params

	if (!hasLocale(routing.locales, locale)) {
		notFound()
	}

	setRequestLocale(locale)

	const user = await getUser()
	const viewable = user ? new Set(await getViewableRecalboxIds(user)) : new Set<string>()
	const recalboxes = (user ? await loadRecalboxes() : []).filter((rb) => viewable.has(rb.id))
	const activeRecalboxId = await getActiveRecalboxId()
	const canControl =
		user && activeRecalboxId ? await canControlRecalbox(user, activeRecalboxId) : false
	const showAdmin = user ? isAdmin(user) : false
	// Serverless: no SSH to the box — hide live-SSH UI (power, recalbox.conf editor).
	const serverless = isServerlessMode()
	// Serverless: no SSE stream, so the live state is read once here and handed to the
	// provider. The viewable check is the security boundary — buildSeedState trusts its
	// caller, and an unchecked id would leak another user's box state.
	const seed =
		serverless && activeRecalboxId && viewable.has(activeRecalboxId)
			? await buildSeedState(db, activeRecalboxId)
			: null

	return (
		<html lang={locale} className={cn('font-sans', roboto.variable)} suppressHydrationWarning>
			<body>
				<ThemeProvider>
					<NextIntlClientProvider>
						<ServerlessProvider value={serverless}>
							<RecalboxEventsProvider
								recalboxId={activeRecalboxId}
								live={!serverless}
								initialState={seed}
							>
								<CanControlProvider value={canControl}>
									<SidebarProvider>
										<AppSidebar showAdmin={showAdmin} serverless={serverless} />
										<SidebarInset>
											<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
												<SidebarTrigger className="-ml-1" />
												<div className="ml-auto flex items-center gap-2">
													<NotificationBell />
													<RecalboxSwitcher recalboxes={recalboxes} activeId={activeRecalboxId} />
													{!serverless && <PowerControls />}
												</div>
											</header>
											<FeedbackPromptProvider>{children}</FeedbackPromptProvider>
										</SidebarInset>
									</SidebarProvider>
									<NotificationListener />
									<ServiceWorkerUpdater />
									<InstallBanner />
									<Toaster />
								</CanControlProvider>
							</RecalboxEventsProvider>
						</ServerlessProvider>
					</NextIntlClientProvider>
				</ThemeProvider>
			</body>
		</html>
	)
}
