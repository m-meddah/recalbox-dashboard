export function formatDuration(seconds: number): string {
	if (seconds <= 0) return '0s'
	const s = Math.floor(seconds)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m`
	const h = Math.floor(m / 60)
	const remainMin = m % 60
	return `${h}h${String(remainMin).padStart(2, '0')}`
}

// Built once at module load (locale-data tables are expensive to rebuild per call).
// The app only routes `en`/`fr`; unknown locales fall back to `en`.
const enRelativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const RELATIVE_TIME_FORMATTERS: Record<string, Intl.RelativeTimeFormat> = {
	en: enRelativeTimeFormat,
	fr: new Intl.RelativeTimeFormat('fr', { numeric: 'auto' }),
}

/**
 * Timezone for rendering absolute wall-clock times on the server. Vercel runs in
 * UTC and the `TZ` env var is reserved, so server components must pass this
 * explicitly (otherwise a 23:39 CEST session renders as 21:39 UTC).
 */
export const APP_TIME_ZONE = 'Europe/Paris'

export function formatRelativeDate(date: Date, locale = 'en'): string {
	const now = Date.now()
	const diffMs = date.getTime() - now
	const diffSec = Math.round(diffMs / 1000)
	const diffMin = Math.round(diffSec / 60)
	const diffHour = Math.round(diffMin / 60)
	const diffDay = Math.round(diffHour / 24)

	const rtf = RELATIVE_TIME_FORMATTERS[locale] ?? enRelativeTimeFormat

	if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'seconds')
	if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minutes')
	if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hours')
	return rtf.format(diffDay, 'days')
}

export function toDateKey(date: Date): string {
	// Bucket by wall-clock day in APP_TIME_ZONE (Vercel runs UTC; TZ is reserved),
	// so a session played at 00:30 CEST counts on that day, not the UTC day before.
	// en-CA formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: APP_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)
}
