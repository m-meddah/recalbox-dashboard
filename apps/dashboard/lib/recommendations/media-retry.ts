// A freshly-recommended game's artwork/video is often not mirrored to blob
// storage yet: the agent only starts uploading once /api/media 404s and marks
// the path "wanted", then needs up to its poll interval (30s by default) to
// fetch and push it. This schedule lets a <video>/<Image> retry a few times
// so it can self-heal once the agent catches up, without a manual reload.
const RETRY_DELAYS_MS = [3_000, 6_000, 10_000, 15_000]

/** Delay before the given retry attempt (0-indexed), or null once exhausted. */
export function getRetryDelayMs(attempt: number): number | null {
	return RETRY_DELAYS_MS[attempt] ?? null
}

/** Appends a cache-busting param on retries so the browser re-fetches instead of reusing the cached 404. */
export function withCacheBust(url: string, attempt: number): string {
	return attempt === 0 ? url : `${url}&retry=${attempt}`
}
