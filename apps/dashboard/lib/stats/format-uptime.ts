/** Human-readable uptime from seconds, e.g. "3 j 4 h", "5 h 30 min", "42 min". */
export function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '—'
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	if (days > 0) return `${days} j ${hours} h`
	if (hours > 0) return `${hours} h ${minutes} min`
	return `${minutes} min`
}
