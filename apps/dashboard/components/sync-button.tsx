'use client'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CheckCircle, RefreshCw, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useState } from 'react'

type SyncState =
	| { status: 'idle' }
	| { status: 'running'; current: string; done: number; total: number; games: number }
	| { status: 'done'; totalGames: number; durationMs: number }
	| { status: 'error'; message: string }

export function SyncButton({ system }: { system?: string }) {
	const t = useTranslations('collection.sync')
	const router = useRouter()
	const [state, setState] = useState<SyncState>({ status: 'idle' })

	async function startSync() {
		const url = system ? `/api/collection/sync?system=${system}` : '/api/collection/sync'

		setState({ status: 'running', current: '…', done: 0, total: 0, games: 0 })

		const res = await fetch(url, { method: 'POST' })
		if (!res.body) return

		const reader = res.body.getReader()
		const dec = new TextDecoder()
		let buf = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buf += dec.decode(value, { stream: true })
			const lines = buf.split('\n')
			buf = lines.pop() ?? ''

			for (const line of lines) {
				if (!line.trim()) continue
				try {
					const event = JSON.parse(line)
					if (event.type === 'start') {
						setState((s) => (s.status === 'running' ? { ...s, total: event.totalSystems } : s))
					} else if (event.type === 'system' && event.status === 'done') {
						setState((s) =>
							s.status === 'running'
								? {
										...s,
										current: event.system,
										done: s.done + 1,
										games: s.games + (event.count ?? 0),
									}
								: s,
						)
					} else if (event.type === 'system' && event.status === 'reading') {
						setState((s) => (s.status === 'running' ? { ...s, current: event.system } : s))
					} else if (event.type === 'done') {
						setState({ status: 'done', totalGames: event.totalGames, durationMs: event.durationMs })
						router.refresh()
					} else if (event.type === 'error') {
						setState({ status: 'error', message: event.message })
					}
				} catch {}
			}
		}
	}

	if (state.status === 'idle') {
		return (
			<Button onClick={startSync} variant="outline" size="sm">
				<RefreshCw className="mr-2 h-4 w-4" />
				{t('button')}
			</Button>
		)
	}

	if (state.status === 'running') {
		const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
		return (
			<div className="flex flex-col gap-1 min-w-64">
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<RefreshCw className="h-3 w-3 animate-spin" />
						{state.current}
					</span>
					<span>{t('progress', { done: state.done, total: state.total, games: state.games })}</span>
				</div>
				<Progress value={pct} className="h-1.5" />
			</div>
		)
	}

	if (state.status === 'done') {
		return (
			<div className="flex items-center gap-2 text-sm text-green-600">
				<CheckCircle className="h-4 w-4" />
				{t('done', { count: state.totalGames, seconds: (state.durationMs / 1000).toFixed(1) })}
				<Button variant="ghost" size="sm" onClick={() => setState({ status: 'idle' })}>
					×
				</Button>
			</div>
		)
	}

	return (
		<div className="flex items-center gap-2 text-sm text-destructive">
			<XCircle className="h-4 w-4" />
			{state.message}
			<Button variant="ghost" size="sm" onClick={() => setState({ status: 'idle' })}>
				{t('retry')}
			</Button>
		</div>
	)
}
