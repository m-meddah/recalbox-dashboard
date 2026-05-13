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

export function formatRelativeDate(date: Date, locale = 'fr-FR'): string {
  const now = Date.now()
  const diffMs = date.getTime() - now
  const diffSec = Math.round(diffMs / 1000)
  const diffMin = Math.round(diffSec / 60)
  const diffHour = Math.round(diffMin / 60)
  const diffDay = Math.round(diffHour / 24)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'seconds')
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minutes')
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hours')
  return rtf.format(diffDay, 'days')
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
