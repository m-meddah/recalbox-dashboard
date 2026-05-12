import { sshClient } from '@/lib/recalbox/ssh-client'
import { logger } from '@/lib/logger'

export type SystemStats = {
	cpuTemp: number | null
	cpuUsage: number | null
	ramUsedMb: number | null
	ramTotalMb: number | null
	uptimeSec: number | null
	takenAt: Date
}

/** Parse CPU temperature from /sys/class/thermal output (millidegrees → °C). */
function parseCpuTemp(raw: string): number | null {
	const val = parseInt(raw, 10)
	if (Number.isNaN(val)) return null
	return val / 1000
}

type ProcStatLine = { total: number; idle: number }

/** Parse a /proc/stat cpu line into total and idle tick counts. */
function parseProcStat(raw: string): ProcStatLine | null {
	// Format: cpu  user nice system idle iowait irq softirq steal guest guest_nice
	const parts = raw.trim().split(/\s+/).slice(1).map(Number)
	if (parts.length < 5 || parts.some(Number.isNaN)) return null
	const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] =
		parts
	const total = user + nice + system + idle + iowait + irq + softirq + steal
	return { total, idle: idle + iowait }
}

/** Compute CPU usage % from two /proc/stat snapshots 200 ms apart. */
async function getCpuUsage(): Promise<number | null> {
	try {
		const raw1 = await sshClient.exec('head -1 /proc/stat')
		await new Promise((r) => setTimeout(r, 200))
		const raw2 = await sshClient.exec('head -1 /proc/stat')

		const s1 = parseProcStat(raw1)
		const s2 = parseProcStat(raw2)
		if (!s1 || !s2) return null

		const totalDiff = s2.total - s1.total
		const idleDiff = s2.idle - s1.idle
		if (totalDiff === 0) return null

		return Math.round(((totalDiff - idleDiff) / totalDiff) * 100 * 10) / 10
	} catch (err) {
		logger.warn('getCpuUsage failed', err)
		return null
	}
}

/** Parse RAM usage from `free -m` output. */
function parseRam(raw: string): { used: number; total: number } | null {
	// Format: Mem:   total  used  free  shared  buff/cache  available
	const parts = raw.trim().split(/\s+/)
	const total = parseInt(parts[1] ?? '', 10)
	const used = parseInt(parts[2] ?? '', 10)
	if (Number.isNaN(total) || Number.isNaN(used)) return null
	return { total, used }
}

/** Parse uptime seconds from /proc/uptime output. */
function parseUptime(raw: string): number | null {
	const val = parseFloat(raw.split(' ')[0] ?? '')
	return Number.isNaN(val) ? null : val
}

/** Retrieve current system stats from the Recalbox via SSH. Partial results on failure. */
export async function getSystemStats(): Promise<SystemStats> {
	const [tempRaw, ramRaw, uptimeRaw, cpuUsage] = await Promise.all([
		sshClient.exec('cat /sys/class/thermal/thermal_zone0/temp').catch((err) => {
			logger.warn('cpuTemp fetch failed', err)
			return null
		}),
		sshClient.exec('free -m | grep Mem').catch((err) => {
			logger.warn('RAM fetch failed', err)
			return null
		}),
		sshClient.exec('cat /proc/uptime').catch((err) => {
			logger.warn('uptime fetch failed', err)
			return null
		}),
		getCpuUsage(),
	])

	const ram = ramRaw ? parseRam(ramRaw) : null

	return {
		cpuTemp: tempRaw ? parseCpuTemp(tempRaw) : null,
		cpuUsage,
		ramUsedMb: ram?.used ?? null,
		ramTotalMb: ram?.total ?? null,
		uptimeSec: uptimeRaw ? parseUptime(uptimeRaw) : null,
		takenAt: new Date(),
	}
}
