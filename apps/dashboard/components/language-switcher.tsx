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

const LOCALE_FLAGS: Record<string, string> = {
	en: '🇬🇧',
	fr: '🇫🇷',
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
			<SelectTrigger className="w-12 justify-center gap-0 px-2 [&>svg]:hidden">
				<span className="text-base">{LOCALE_FLAGS[locale] ?? locale}</span>
			</SelectTrigger>
			<SelectContent align="end">
				{routing.locales.map((loc) => (
					<SelectItem key={loc} value={loc}>
						<span className="text-base">{LOCALE_FLAGS[loc] ?? loc}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
