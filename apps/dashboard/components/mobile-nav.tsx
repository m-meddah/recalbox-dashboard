'use client'

import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Link, usePathname } from '@/i18n/navigation'
import { Menu, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

export function MobileNav() {
	const t = useTranslations('nav')
	const pathname = usePathname()
	const [open, setOpen] = useState(false)

	useEffect(() => {
		setOpen(false)
	}, [pathname])

	// Prevent body scroll when open
	useEffect(() => {
		document.body.style.overflow = open ? 'hidden' : ''
		return () => {
			document.body.style.overflow = ''
		}
	}, [open])

	const links = [
		{ href: '/' as const, label: t('home') },
		{ href: '/play-tonight' as const, label: t('playTonight') },
		{ href: '/stats' as const, label: t('stats') },
		{ href: '/collection' as const, label: t('collection') },
		{ href: '/profile' as const, label: t('profile') },
		{ href: '/achievements' as const, label: t('achievements') },
		{ href: '/wrapped' as const, label: t('wrapped') },
		{ href: '/settings' as const, label: t('settings') },
	]

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="md:hidden p-2 rounded-md hover:bg-muted"
				aria-label="Menu"
			>
				{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
			</button>

			{open && (
				<div className="md:hidden fixed inset-x-0 top-14.25 bottom-0 bg-background z-50 border-t overflow-y-auto">
					<nav className="flex flex-col p-4 gap-1">
						{links.map(({ href, label }) => (
							<Link
								key={href}
								href={href}
								className="text-base font-medium py-3 px-4 rounded-md hover:bg-muted block"
								onClick={() => setOpen(false)}
							>
								{label}
							</Link>
						))}
					</nav>
					<div className="flex items-center gap-3 px-4 py-4 border-t">
						<ThemeToggle />
						<LanguageSwitcher />
					</div>
				</div>
			)}
		</>
	)
}
