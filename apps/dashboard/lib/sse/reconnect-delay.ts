/** First retry after a transient drop — the stream self-rotates every ~290s, so this
 * is the common case and stays snappy. Doubles per consecutive failure, reset on open. */
export const RECONNECT_BASE_MS = 3_000
/** First retry after the server REFUSED the stream (401/403). Starts far higher: only
 * re-authenticating or regaining access fixes it, so fast retries are pure waste. */
export const REFUSED_BASE_MS = 30_000
export const MAX_RECONNECT_MS = 60_000

/**
 * Backoff before reconnecting the SSE stream. `attempt` is 1 for the first failure
 * since the last successful open.
 *
 * A refusal (401/403) starts much higher because nothing the client does will fix it:
 * the old flat 3s retry turned an expired session — or a box the user may no longer
 * view — into a permanent hammer, one serverless invocation every 3s for as long as
 * the tab stayed open.
 *
 * Lives outside the provider module so the component file only exports components
 * (Fast Refresh) and so this stays unit-testable without a DOM.
 */
export function reconnectDelay(attempt: number, refused: boolean): number {
	const base = refused ? REFUSED_BASE_MS : RECONNECT_BASE_MS
	return Math.min(base * 2 ** Math.max(0, attempt - 1), MAX_RECONNECT_MS)
}
