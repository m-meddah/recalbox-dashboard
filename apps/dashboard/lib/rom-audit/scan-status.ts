/**
 * Scan status logic, split out of the button component.
 *
 * The repo has no component-test harness (vitest runs in the `node` environment,
 * with no jsdom and no Testing Library), so the decisions worth guarding —
 * when to keep polling, when to stop, what the bar shows — live here, where they
 * can be tested without pulling a browser environment into the project.
 */

export type ScanStatus = 'pending' | 'running' | 'done' | 'failed'

export type ScanProgress = {
	status: ScanStatus
	systemsDone: number
	systemsTotal: number
}

/**
 * True while the scan is still going. `pending` counts: a serverless scan sits
 * there until the agent claims the command, and the UI must keep watching.
 */
export function isScanLive(scan: { status: string } | null | undefined): boolean {
	return scan?.status === 'pending' || scan?.status === 'running'
}

/** Whether the page's server-rendered aggregates need re-fetching. */
export function scanJustFinished(
	previous: { status: string } | null | undefined,
	next: { status: string } | null | undefined,
): boolean {
	return isScanLive(previous) && !!next && !isScanLive(next)
}

/** 0 when the total is unknown — never NaN, which React renders as a broken bar. */
export function scanPercent(scan: ScanProgress | null | undefined): number {
	if (!scan || scan.systemsTotal <= 0) return 0
	return Math.min(100, (scan.systemsDone / scan.systemsTotal) * 100)
}
