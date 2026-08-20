'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useState } from 'react'

const POLL_MS = 5_000
const TROUBLE_AFTER_MS = 3 * 60 * 1000

type Screen = 'name' | 'install' | 'wait'
type Os = 'windows' | 'mac'

const SCREEN_INDEX: Record<Screen, number> = { name: 1, install: 2, wait: 3 }

function detectOs(): Os {
	if (typeof navigator === 'undefined') return 'windows'
	return navigator.userAgent.includes('Mac') ? 'mac' : 'windows'
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
				setCreateError(data.error ?? null)
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

	function handleDownload() {
		if (!recalboxId) return
		setDownloading(true)
		window.location.href = `/api/recalboxes/${recalboxId}/installer`
		window.setTimeout(() => setDownloading(false), 1500)
	}

	// Screen 3 — poll `agent-status` every POLL_MS and stop the moment `seen`
	// flips true (the fourth test asserts no further fetch calls after that).
	// A second, independent timer flips `trouble` after TROUBLE_AFTER_MS — it
	// never stops the poll, it only adds the troubleshooting panel alongside
	// the waiting state.
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
					clearInterval(intervalId)
				}
			} catch {
				// Network hiccup — the next tick will retry on its own.
			}
		}

		check()
		const intervalId = setInterval(check, POLL_MS)
		const troubleTimeout = setTimeout(() => {
			if (!cancelled) setTrouble(true)
		}, TROUBLE_AFTER_MS)

		return () => {
			cancelled = true
			clearInterval(intervalId)
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
										<Button variant="outline" onClick={handleDownload} disabled={!recalboxId}>
											{t('troubleRetry')}
										</Button>
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
