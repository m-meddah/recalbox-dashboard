'use client'

import { useCanControl } from '@/components/can-control-provider'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useRouter } from '@/i18n/navigation'
import { isScanLive, scanJustFinished, scanPercent } from '@/lib/rom-audit/scan-status'
import { RefreshCw, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

// Polled only while a scan is in flight. The shared SSE stream is deliberately
// left alone: every open tab re-runs its polls for its whole lifetime, so a
// source added there would cost reads on every tab, forever, scan or no scan.
const POLL_MS = 3000

type ScanRow = {
	id: string
	status: 'pending' | 'running' | 'done' | 'failed'
	systemsDone: number
	systemsTotal: number
	currentSystem: string | null
	error: string | null
}

export function ScanButton({ recalboxId }: { recalboxId: string }) {
	const t = useTranslations('romAudit.scan')
	const router = useRouter()
	const canControl = useCanControl()
	const [scan, setScan] = useState<ScanRow | null>(null)
	const [starting, setStarting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const live = isScanLive(scan)

	const poll = useCallback(async () => {
		const res = await fetch(`/api/rom-audit/scan?recalboxId=${encodeURIComponent(recalboxId)}`)
		if (!res.ok) return null
		const body = (await res.json()) as { scan: ScanRow | null }
		setScan(body.scan)
		return body.scan
	}, [recalboxId])

	useEffect(() => {
		if (!live) return
		timer.current = setTimeout(async () => {
			const next = await poll()
			// The run just ended: bring the page's server-rendered aggregates up to date.
			if (scanJustFinished(scan, next)) router.refresh()
		}, POLL_MS)
		// Unmounting mid-scan must not leave a timer running against a dead component.
		return () => {
			if (timer.current) clearTimeout(timer.current)
		}
	}, [live, poll, router, scan])

	async function start() {
		setStarting(true)
		setError(null)
		try {
			const res = await fetch('/api/rom-audit/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ recalboxId }),
			})
			// 409 means a scan is already running — follow it instead of shouting.
			if (res.status === 409) {
				await poll()
				return
			}
			if (!res.ok) {
				setError(t('failed'))
				return
			}
			await poll()
		} finally {
			setStarting(false)
		}
	}

	if (!canControl) return null

	return (
		<div className="flex flex-col items-end gap-2">
			<Button size="sm" onClick={start} disabled={starting || live}>
				<RefreshCw className={`mr-2 size-4 ${live ? 'animate-spin' : ''}`} />
				{live ? t('running') : t('start')}
			</Button>

			{live && (
				<div className="w-56 space-y-1">
					<Progress value={scanPercent(scan)} />
					<p className="text-right text-xs text-muted-foreground">
						{t('progress', {
							done: scan?.systemsDone ?? 0,
							total: scan?.systemsTotal ?? 0,
							system: scan?.currentSystem ?? '…',
						})}
					</p>
				</div>
			)}

			{scan?.status === 'failed' && (
				<p className="flex items-center gap-1 text-xs text-destructive">
					<XCircle className="size-3" />
					{scan.error ?? t('failed')}
				</p>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	)
}
