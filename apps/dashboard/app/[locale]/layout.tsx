import { ThemeProvider } from '@/components/theme-provider'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Geist } from 'next/font/google'
import { notFound } from 'next/navigation'
import '../globals.css'
import { LanguageSwitcher } from '@/components/language-switcher'
import { MobileNav } from '@/components/mobile-nav'
import { NotificationBell } from '@/components/notification-bell'
import { NotificationListener } from '@/components/notification-listener'
import { PowerControls } from '@/components/power-controls'
import { InstallBanner } from '@/components/pwa/install-banner'
import { ServiceWorkerUpdater } from '@/components/pwa/service-worker-updater'
import { RecalboxSwitcher } from '@/components/recalbox-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Toaster } from '@/components/ui/sonner'
import { Link } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { cn } from '@/lib/utils'
import { FeedbackPromptProvider } from '@/components/feedback/feedback-prompt-provider'
import { RecalboxEventsProvider } from '../recalbox-events-provider'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

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

	const t = await getTranslations({ locale, namespace: 'nav' })

	const recalboxes = configStore.getRecalboxes()
	const activeRecalboxId = await getActiveRecalboxId()

	return (
		<html lang={locale} className={cn('font-sans', geist.variable)} suppressHydrationWarning>
			<body>
				<ThemeProvider>
					<NextIntlClientProvider>
						<RecalboxEventsProvider>
							<header className="border-b px-4 py-3">
								<nav className="flex items-center gap-6">
									{/* Desktop nav links */}
									<div className="hidden md:flex items-center gap-6">
										<Link href="/" className="text-sm font-semibold hover:text-primary">
											{t('home')}
										</Link>
										<Link
											href="/play-tonight"
											className="text-sm font-semibold text-primary hover:text-primary/80"
										>
											{t('playTonight')}
										</Link>
										<Link
											href="/stats"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('stats')}
										</Link>
										<Link
											href="/collection"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('collection')}
										</Link>
										<Link
											href="/profile"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('profile')}
										</Link>
										<Link
											href="/achievements"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('achievements')}
										</Link>
										<Link
											href="/wrapped"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('wrapped')}
										</Link>
										<Link
											href="/settings"
											className="text-sm text-muted-foreground hover:text-foreground"
										>
											{t('settings')}
										</Link>
									</div>
									{/* Mobile hamburger */}
									<MobileNav />
									<div className="ml-auto flex items-center gap-2">
										<NotificationBell />
										<RecalboxSwitcher recalboxes={recalboxes} activeId={activeRecalboxId} />
										<PowerControls />
										<div className="hidden md:flex items-center gap-2">
											<ThemeToggle />
											<LanguageSwitcher />
										</div>
									</div>
								</nav>
							</header>
							<FeedbackPromptProvider>{children}</FeedbackPromptProvider>
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
