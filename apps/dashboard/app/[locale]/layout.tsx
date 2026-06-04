import { ThemeProvider } from '@/components/theme-provider'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { Roboto } from 'next/font/google'
import { notFound } from 'next/navigation'
import '../globals.css'
import { AppSidebar } from '@/components/app-sidebar'
import { FeedbackPromptProvider } from '@/components/feedback/feedback-prompt-provider'
import { NotificationBell } from '@/components/notification-bell'
import { NotificationListener } from '@/components/notification-listener'
import { PowerControls } from '@/components/power-controls'
import { InstallBanner } from '@/components/pwa/install-banner'
import { ServiceWorkerUpdater } from '@/components/pwa/service-worker-updater'
import { RecalboxSwitcher } from '@/components/recalbox-switcher'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { routing } from '@/i18n/routing'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
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

	const recalboxes = configStore.getRecalboxes()
	const activeRecalboxId = await getActiveRecalboxId()

	return (
		<html lang={locale} className={cn('font-sans', roboto.variable)} suppressHydrationWarning>
			<body>
				<ThemeProvider>
					<NextIntlClientProvider>
						<RecalboxEventsProvider>
							<SidebarProvider>
								<AppSidebar />
								<SidebarInset>
									<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
										<SidebarTrigger className="-ml-1" />
										<div className="ml-auto flex items-center gap-2">
											<NotificationBell />
											<RecalboxSwitcher recalboxes={recalboxes} activeId={activeRecalboxId} />
											<PowerControls />
										</div>
									</header>
									<FeedbackPromptProvider>{children}</FeedbackPromptProvider>
								</SidebarInset>
							</SidebarProvider>
							<NotificationListener />
							<ServiceWorkerUpdater />
							<InstallBanner />
							<Toaster />
						</RecalboxEventsProvider>
					</NextIntlClientProvider>
				</ThemeProvider>
			</body>
		</html>
	)
}
