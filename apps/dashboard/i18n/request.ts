import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
	const requested = await requestLocale
	const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

	const messageModules = {
		en: () => import('../messages/en.json'),
		fr: () => import('../messages/fr.json'),
	}
	const messages = (await messageModules[locale as keyof typeof messageModules]()).default

	return {
		locale,
		messages,
		timeZone: 'Europe/Paris',
		now: new Date(),
	}
})
