import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import '../globals.css'
import { RecalboxEventsProvider } from '../recalbox-events-provider'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { routing } from '@/i18n/routing'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

type Props = {
	children: React.ReactNode
	params: Promise<{ locale: string }>
}

export async function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params
	return {
		title: 'Recalbox Dashboard',
		description:
			'Companion analytics dashboard for your Recalbox — playtime history, achievement progress, and an annual recap.',
	} satisfies Metadata
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params

	if (!hasLocale(routing.locales, locale)) {
		notFound()
	}

	setRequestLocale(locale)

	const t = await getTranslations({ locale, namespace: 'nav' })

	return (
		<html lang={locale} className={cn('font-sans', geist.variable)}>
			<body>
				<NextIntlClientProvider>
					<RecalboxEventsProvider>
						<header className="border-b px-6 py-3">
							<nav className="flex items-center gap-6">
								<Link href="/" className="text-sm font-semibold hover:text-primary">
									{t('home')}
								</Link>
								<Link
									href="/collection"
									className="text-sm text-muted-foreground hover:text-foreground"
								>
									{t('collection')}
								</Link>
								<Link
									href="/stats"
									className="text-sm text-muted-foreground hover:text-foreground"
								>
									{t('stats')}
								</Link>
								<Link
									href="/settings"
									className="text-sm text-muted-foreground hover:text-foreground"
								>
									{t('settings')}
								</Link>
							</nav>
						</header>
						{children}
					</RecalboxEventsProvider>
				</NextIntlClientProvider>
			</body>
		</html>
	)
}
