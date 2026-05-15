import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
	locales: ['en', 'fr'] as const,
	defaultLocale: 'en',
	localePrefix: 'always',
})
