'use client'

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { useLocale } from 'next-intl'
import { useTransition } from 'react'

const LOCALE_LABELS: Record<string, string> = {
	en: '🇬🇧 English',
	fr: '🇫🇷 Français',
}

export function LanguageSwitcher() {
	const locale = useLocale()
	const router = useRouter()
	const pathname = usePathname()
	const [isPending, startTransition] = useTransition()

	function handleChange(nextLocale: (typeof routing.locales)[number] | null) {
		if (!nextLocale) return
		startTransition(() => {
			router.replace(pathname, { locale: nextLocale })
		})
	}

	return (
		<Select value={locale} onValueChange={handleChange} disabled={isPending}>
			<SelectTrigger className="w-40">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{routing.locales.map((loc) => (
					<SelectItem key={loc} value={loc}>
						{LOCALE_LABELS[loc] ?? loc}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
