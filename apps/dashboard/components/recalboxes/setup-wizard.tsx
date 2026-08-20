'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useRef, useState } from 'react'

const POLL_MS = 5_000
const TROUBLE_AFTER_MS = 3 * 60 * 1000

type Screen = 'name' | 'install' | 'wait'
type Os = 'windows' | 'mac'

const SCREEN_INDEX: Record<Screen, number> = { name: 1, install: 2, wait: 3 }

function detectOs(): Os {
	if (typeof navigator === 'undefined') return 'windows'
	return navigator.userAgent.includes('Mac') ? 'mac' : 'windows'
}

/** Pulls the filename out of `Content-Disposition: attachment; filename="…"` —
 * the installer route already builds a sanitised, per-box name; this just
 * carries it through instead of inventing a generic one. */
function filenameFromContentDisposition(header: string | null): string | undefined {
	if (!header) return undefined
	const match = /filename="?([^";]+)"?/i.exec(header)
	return match?.[1]
}

export function SetupWizard({
	startAt = 'name',
	recalboxId: initialId,
}: {
	startAt?: Screen
	recalboxId?: string
}) {
	const t = useTranslations('recalboxes.wizard')
	const tc = useTranslations('common')
	const locale = useLocale()
	const [screen, setScreen] = useState<Screen>(startAt)
	const [recalboxId, setRecalboxId] = useState<string | undefined>(initialId)

	// Screen 1 — name.
	const [name, setName] = useState('')
	const [emoji, setEmoji] = useState('🕹️')
	const [creating, setCreating] = useState(false)
	const [createError, setCreateError] = useState<string | null>(null)

	// Screen 2 — install.
	const [os, setOs] = useState<Os>('windows')
	const [downloading, setDownloading] = useState(false)
	const [downloadError, setDownloadError] = useState<string | null>(null)
	useEffect(() => {
		setOs(detectOs())
	}, [])

	// Screen 3 — wait.
	const [seen, setSeen] = useState(false)
	const [trouble, setTrouble] = useState(false)

	async function handleCreate(e: FormEvent) {
		e.preventDefault()
		setCreating(true)
		setCreateError(null)
		try {
			const res = await fetch('/api/recalboxes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					iconEmoji: emoji,
					host: 'recalbox.local',
					sshUser: 'root',
					sshPassword: '',
					sshPort: 22,
					mqttPort: 1883,
				}),
			})
			const data: { id?: string; error?: string } = await res.json().catch(() => ({}))
			if (!res.ok) {
				// The route's own JSON always carries a readable sentence, but a non-OK
				// response can come from somewhere that never ran the route at all — an
				// unhandled 500, a proxy error page, a gateway timeout. Its body parses
				// to `{}` or something with no `error` string, and silently rendering
				// nothing is indistinguishable from the app being broken for someone
				// with no terminal to check. Fall back to the same generic message the
				// network-failure branch below already uses.
				setCreateError(data.error?.trim() ? data.error : tc('error'))
				return
			}
			if (data.id) setRecalboxId(data.id)
			setScreen('install')
		} catch {
			// No response at all (offline, DNS, …) — there's no server sentence to
			// show, so fall back to the generic error string.
			setCreateError(tc('error'))
		} finally {
			setCreating(false)
		}
	}

	// The installer route can legitimately answer with a JSON 500 (payload
	// missing, token minting failed, …). Navigating the tab there — the
	// original approach — would throw the user out of the wizard mid-onboarding
	// onto a raw JSON blob, with no way back. Fetching lets us tell success from
	// failure before touching the page: on failure we show `downloadError` and
	// leave the wizard exactly where it was; on success we save the blob via a
	// temporary anchor, using the filename the server already sanitised rather
	// than inventing one.
	async function handleDownload() {
		if (!recalboxId || downloading) return
		setDownloading(true)
		setDownloadError(null)
		try {
			const res = await fetch(`/api/recalboxes/${recalboxId}/installer`)
			if (!res.ok) {
				setDownloadError(t('downloadError'))
				return
			}
			const blob = await res.blob()
			const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition'))
			const url = URL.createObjectURL(blob)
			// `url` pins the blob in memory until revoked. A plain statement at the
			// end of the block only runs on the happy path — if appendChild/click/
			// remove throws, control jumps straight to the outer catch and the
			// revoke never happens. Scoping a try/finally around just the DOM steps
			// guarantees the revoke runs either way, while the outer catch still
			// gets the chance to surface the failure to the user.
			try {
				const a = document.createElement('a')
				a.href = url
				a.download = filename ?? 'recalbox-dashboard-installer.zip'
				document.body.appendChild(a)
				a.click()
				a.remove()
			} finally {
				URL.revokeObjectURL(url)
			}
		} catch {
			setDownloadError(t('downloadError'))
		} finally {
			setDownloading(false)
		}
	}

	// Screen 3 — poll `agent-status` every POLL_MS and stop the moment `seen`
	// flips true (the fourth test asserts no further fetch calls after that).
	// A second, independent timer flips `trouble` after TROUBLE_AFTER_MS — it
	// never stops the poll, it only adds the troubleshooting panel alongside
	// the waiting state.
	//
	// The interval id lives in a ref, set *before* `check()` is ever invoked.
	// `check` is async, so its continuation past the first `await` only runs on
	// a later microtask — reading a `const` declared right after the call would
	// also work today, but only because of that ordering, which is exactly the
	// kind of thing a later refactor (an early guard, a reordered line) breaks
	// silently. The ref removes the dependency on that ordering entirely.
	const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	useEffect(() => {
		if (screen !== 'wait' || !recalboxId) return
		let cancelled = false

		async function check() {
			try {
				const res = await fetch(`/api/recalboxes/${recalboxId}/agent-status`)
				if (!res.ok || cancelled) return
				const data: { seen: boolean; lastSeenAt: string | null } = await res.json()
				if (cancelled) return
				if (data.seen) {
					setSeen(true)
					if (pollIntervalRef.current !== null) {
						clearInterval(pollIntervalRef.current)
						pollIntervalRef.current = null
					}
				}
			} catch {
				// Network hiccup — the next tick will retry on its own.
			}
		}

		pollIntervalRef.current = setInterval(check, POLL_MS)
		check()
		const troubleTimeout = setTimeout(() => {
			if (!cancelled) setTrouble(true)
		}, TROUBLE_AFTER_MS)

		return () => {
			cancelled = true
			if (pollIntervalRef.current !== null) {
				clearInterval(pollIntervalRef.current)
				pollIntervalRef.current = null
			}
			clearTimeout(troubleTimeout)
		}
	}, [screen, recalboxId])

	return (
		<div className="w-full max-w-lg mx-auto space-y-4">
			<p className="text-xs text-muted-foreground text-center">
				{t('step', { current: SCREEN_INDEX[screen], total: 3 })}
			</p>

			{screen === 'name' && (
				<Card>
					<CardHeader>
						<CardTitle>{t('nameTitle')}</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleCreate} className="space-y-4">
							<p className="text-sm text-muted-foreground">{t('nameHint')}</p>
							<div className="flex gap-2">
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t('namePlaceholder')}
									required
									className="flex-1"
								/>
								<Input
									value={emoji}
									onChange={(e) => setEmoji(e.target.value)}
									className="w-16 text-center"
									maxLength={8}
								/>
							</div>
							{createError && <p className="text-sm text-destructive">{createError}</p>}
							<Button type="submit" disabled={creating || !name.trim()}>
								{t('next')}
							</Button>
						</form>
					</CardContent>
				</Card>
			)}

			{screen === 'install' && (
				<Card>
					<CardHeader>
						<CardTitle>{t('installTitle')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<Tabs value={os} onValueChange={(v) => setOs(v as Os)}>
							<TabsList>
								<TabsTrigger value="windows">{t('tabWindows')}</TabsTrigger>
								<TabsTrigger value="mac">{t('tabMac')}</TabsTrigger>
							</TabsList>
						</Tabs>
						<Button onClick={handleDownload} disabled={!recalboxId || downloading}>
							{downloading ? t('downloading') : t('download')}
						</Button>
						{downloadError && <p className="text-sm text-destructive">{downloadError}</p>}
						<ol className="list-decimal pl-5 space-y-2 text-sm">
							<li>{t('stepOpen')}</li>
							<li>{os === 'mac' ? t('stepShareMac') : t('stepShareWindows')}</li>
							<li>{t('stepDrag')}</li>
							<li>{t('stepReboot')}</li>
						</ol>
						<Button onClick={() => setScreen('wait')}>{t('next')}</Button>
					</CardContent>
				</Card>
			)}

			{screen === 'wait' && (
				<Card>
					<CardContent className="space-y-4 pt-4">
						{seen ? (
							<div className="space-y-4 text-center">
								<CardTitle>{t('connected')}</CardTitle>
								<a href={`/${locale}`} className={cn(buttonVariants())}>
									{t('goToDashboard')}
								</a>
							</div>
						) : (
							<>
								<div className="space-y-2 text-center">
									<CardTitle>{t('waitTitle')}</CardTitle>
									<p className="text-sm text-muted-foreground">{t('waitBody')}</p>
								</div>
								{trouble && (
									<div className="rounded-lg border p-4 space-y-2">
										<p className="font-medium text-sm">{t('troubleTitle')}</p>
										<ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
											<li>{t('troubleReboot')}</li>
											<li>{t('troubleRoot')}</li>
											<li>{t('troubleNet')}</li>
										</ul>
										<Button
											variant="outline"
											onClick={handleDownload}
											disabled={!recalboxId || downloading}
										>
											{t('troubleRetry')}
										</Button>
										{downloadError && <p className="text-sm text-destructive">{downloadError}</p>}
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
