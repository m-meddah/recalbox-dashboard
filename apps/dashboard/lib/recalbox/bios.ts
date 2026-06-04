export type BiosStatus = 'ok' | 'mismatch' | 'missing'

export type BiosEntry = {
	system: string // theme/system key (e.g. "snes")
	systemName: string // human-readable name (e.g. "Super Nintendo")
	path: string // relative path under the bios dir, e.g. "amiga/bios/kick.rom"
	currentMd5: string
	expectedMd5: string[]
	mandatory: boolean
	notes: string
	status: BiosStatus
}

export type BiosReport = {
	entries: BiosEntry[]
	summary: { total: number; ok: number; mismatch: number; missing: number }
}

type RawBios = {
	mandatory?: boolean
	displayFileName?: string
	notes?: string
	currentMd5?: string
	md5List?: string[]
	lightStatus?: string // "Green" | "Yellow" | "Red"
	realStatus?: string // "HashMatching" | "HashNotMatching" | "FileNotFound"
}

type RawSystem = { fullName?: string; biosList?: Record<string, RawBios> }

// A not-found file reports an all-zero MD5; surface that as a blank in the UI.
const ZERO_MD5 = '00000000000000000000000000000000'

function toStatus(b: RawBios): BiosStatus {
	if (b.realStatus === 'FileNotFound' || b.lightStatus === 'Red') return 'missing'
	if (b.realStatus === 'HashNotMatching' || b.lightStatus === 'Yellow') return 'mismatch'
	return 'ok'
}

function emptySummary(): BiosReport['summary'] {
	return { total: 0, ok: 0, mismatch: 0, missing: 0 }
}

/**
 * BIOS scan results from the Recalbox Web Manager API (port 81) — the same data
 * as the Web Manager's BIOS page. Returns an empty report if unavailable.
 */
export async function fetchBiosInfo(host: string, port = 81): Promise<BiosReport> {
	try {
		const res = await fetch(`http://${host}:${port}/api/bios`, {
			signal: AbortSignal.timeout(8000),
		})
		if (!res.ok) return { entries: [], summary: emptySummary() }
		const data = (await res.json()) as Record<string, RawSystem>

		const entries: BiosEntry[] = []
		for (const [systemKey, sys] of Object.entries(data)) {
			for (const b of Object.values(sys.biosList ?? {})) {
				const current = (b.currentMd5 ?? '').toUpperCase()
				entries.push({
					system: systemKey,
					systemName: sys.fullName || systemKey,
					path: b.displayFileName ?? '',
					currentMd5: current === ZERO_MD5.toUpperCase() ? '' : current,
					expectedMd5: (b.md5List ?? []).map((m) => m.toUpperCase()),
					mandatory: b.mandatory ?? false,
					notes: b.notes ?? '',
					status: toStatus(b),
				})
			}
		}

		entries.sort((a, b) => a.systemName.localeCompare(b.systemName) || a.path.localeCompare(b.path))

		return {
			entries,
			summary: {
				total: entries.length,
				ok: entries.filter((e) => e.status === 'ok').length,
				mismatch: entries.filter((e) => e.status === 'mismatch').length,
				missing: entries.filter((e) => e.status === 'missing').length,
			},
		}
	} catch {
		// Best-effort: the BIOS page handles an empty report gracefully.
		return { entries: [], summary: emptySummary() }
	}
}
