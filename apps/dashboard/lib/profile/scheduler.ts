import { computeUserProfile } from './compute-profile'

const DEBOUNCE_MS = 30_000
const MIN_INTERVAL_MS = 5 * 60_000
const PERIODIC_INTERVAL_MS = 6 * 60 * 60 * 1000

let pendingTimeout: NodeJS.Timeout | null = null
let lastComputedAt = 0
let isComputing = false

export type RecomputeReason = 'significant_session' | 'new_rating' | 'manual' | 'periodic' | 'startup'

/**
 * Planifie un recompute du profil avec debounce de 30s.
 * Évite de recalculer en rafale si plusieurs sessions arrivent simultanément.
 * Respecte un intervalle minimum de 5 min entre deux computes.
 */
export function scheduleProfileRecompute(opts: { reason: RecomputeReason }): void {
	const now = Date.now()
	const sinceLastCompute = now - lastComputedAt

	if (pendingTimeout) clearTimeout(pendingTimeout)

	const delay =
		sinceLastCompute < MIN_INTERVAL_MS
			? Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - sinceLastCompute)
			: DEBOUNCE_MS

	pendingTimeout = setTimeout(() => runCompute(opts.reason), delay)
}

async function runCompute(reason: RecomputeReason): Promise<void> {
	if (isComputing) return
	isComputing = true
	pendingTimeout = null

	try {
		console.log(`[profile] Recomputing (reason: ${reason})`)
		await computeUserProfile()
		lastComputedAt = Date.now()
		console.log(`[profile] Recomputed at ${new Date().toISOString()}`)
	} catch (err) {
		console.error('[profile] Compute failed:', err)
	} finally {
		isComputing = false
	}
}

/**
 * Démarre le scheduler : compute initial différé de 5s + recompute périodique toutes les 6h.
 * À appeler une seule fois au démarrage du scrobbler.
 */
export function startProfileScheduler(): void {
	setTimeout(() => scheduleProfileRecompute({ reason: 'startup' }), 5000)

	setInterval(() => {
		scheduleProfileRecompute({ reason: 'periodic' })
	}, PERIODIC_INTERVAL_MS)
}
