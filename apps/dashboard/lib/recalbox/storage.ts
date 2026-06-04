export type StorageMount = {
	label: string
	mount: string
	usedBytes: number
	sizeBytes: number
	percent: number
}

type RawStorage = {
	mount?: string
	filesystem?: string
	filesystemtype?: string
	label?: string
	size?: number
	used?: number
}

/**
 * Disk usage per partition, from the Recalbox Web Manager API (port 81).
 * Same source as the Web Manager's Monitoring page. Returns [] if unavailable.
 */
export async function fetchStorageInfo(host: string, port = 81): Promise<StorageMount[]> {
	try {
		const res = await fetch(`http://${host}:${port}/api/monitoring/storageinfo`, {
			signal: AbortSignal.timeout(4000),
		})
		if (!res.ok) return []
		const data = (await res.json()) as { storages?: Record<string, RawStorage> }
		const seen = new Set<string>()
		const out: StorageMount[] = []
		for (const s of Object.values(data.storages ?? {})) {
			if (!s || typeof s.size !== 'number' || s.size <= 0) continue
			if (s.filesystemtype === 'overlay' || s.filesystemtype === 'tmpfs') continue
			const key = `${s.filesystem}:${s.size}:${s.used}`
			if (seen.has(key)) continue
			seen.add(key)
			const used = s.used ?? 0
			const label =
				s.label?.trim() || s.mount?.split('/').filter(Boolean).pop() || s.filesystem || '—'
			out.push({
				label,
				mount: s.mount ?? '',
				usedBytes: used,
				sizeBytes: s.size,
				percent: Math.round((used / s.size) * 100),
			})
		}
		return out.sort((a, b) => b.percent - a.percent)
	} catch {
		// Best-effort: the monitoring panel handles an empty result silently.
		return []
	}
}
