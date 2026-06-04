'use client'

import Image from 'next/image'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { RaAchievement, RaGameProgress, RaProfile } from '@/lib/retroachievements/service'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

const RECENT_DISPLAY_COUNT = 20

type State =
	| { kind: 'loading' }
	| { kind: 'disabled' }
	| { kind: 'error'; message: string }
	| { kind: 'ok'; profile: RaProfile; allAchievements: RaAchievement[]; progress: RaGameProgress[] }

const INTENSITY_CLASS = {
	0: 'bg-muted',
	1: 'bg-emerald-900/30',
	2: 'bg-emerald-700/50',
	3: 'bg-emerald-500/70',
	4: 'bg-emerald-400',
} as const

function getMonthLabel(
	week: Array<{ date: Date; dateKey: string; count: number }>,
	locale: string,
): string | null {
	const firstDay = week[0]?.date
	if (!firstDay) return null
	if (firstDay.getDate() <= 7) {
		return firstDay.toLocaleString(locale, { month: 'short' })
	}
	return null
}

function AchievementHeatmap({ achievements }: { achievements: RaAchievement[] }) {
	const t = useTranslations('achievements.heatmap')
	const locale = useLocale()

	const countByDay = new Map<string, number>()
	for (const a of achievements) {
		const d = a.unlockedAt.slice(0, 10)
		countByDay.set(d, (countByDay.get(d) ?? 0) + 1)
	}

	const today = new Date()
	const days: Array<{ date: Date; dateKey: string; count: number }> = []
	for (let i = 364; i >= 0; i--) {
		const d = new Date(today)
		d.setDate(d.getDate() - i)
		const key = d.toISOString().slice(0, 10)
		days.push({ date: d, dateKey: key, count: countByDay.get(key) ?? 0 })
	}

	const maxCount = Math.max(...days.map((d) => d.count), 1)

	function cellIntensity(count: number): 0 | 1 | 2 | 3 | 4 {
		if (count === 0) return 0
		return (Math.ceil((count / maxCount) * 4) as 1 | 2 | 3 | 4) ?? 4
	}

	const weeks: Array<typeof days> = []
	for (let i = 0; i < days.length; i += 7) {
		weeks.push(days.slice(i, i + 7))
	}

	const dayLabels = ['', 'M', '', 'W', '', 'F', ''].map((d) =>
		d === 'M'
			? new Date(2024, 0, 1).toLocaleString(locale, { weekday: 'narrow' })
			: d === 'W'
				? new Date(2024, 0, 3).toLocaleString(locale, { weekday: 'narrow' })
				: d === 'F'
					? new Date(2024, 0, 5).toLocaleString(locale, { weekday: 'narrow' })
					: '',
	)

	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">{t('label')}</p>
			<div className="flex gap-1 overflow-x-auto pb-2">
				{/* Day labels column */}
				<div className="flex flex-col gap-0.75 pt-5 shrink-0">
					{dayLabels.map((label, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: positional day labels, never reorder
							key={i}
							className="h-2.5 w-3 text-[9px] text-muted-foreground leading-none flex items-center"
						>
							{label}
						</div>
					))}
				</div>

				{/* Grid */}
				<div className="flex gap-0.75">
					{weeks.map((week, wi) => {
						const monthLabel = getMonthLabel(week, locale)
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: positional week columns, never reorder
							<div key={wi} className="flex flex-col gap-0.75">
								{/* Month label */}
								<div className="h-4 text-[9px] text-muted-foreground leading-none whitespace-nowrap">
									{monthLabel ?? ''}
								</div>
								{/* Cells */}
								{week.map((day) => (
									<div
										key={day.dateKey}
										title={day.count > 0 ? `${day.dateKey}: ${day.count}` : day.dateKey}
										className={`size-2.5 rounded-xs ${INTENSITY_CLASS[cellIntensity(day.count)]} transition-colors`}
									/>
								))}
							</div>
						)
					})}
				</div>
			</div>

			{/* Legend */}
			<div className="flex items-center gap-1 text-[10px] text-muted-foreground justify-end">
				<span>{t('less')}</span>
				{([0, 1, 2, 3, 4] as const).map((i) => (
					<div key={i} className={`size-2.5 rounded-xs ${INTENSITY_CLASS[i]}`} />
				))}
				<span>{t('more')}</span>
			</div>
		</div>
	)
}

export default function AchievementsPage() {
	const t = useTranslations('achievements')
	const [state, setState] = useState<State>({ kind: 'loading' })
	const [syncing, setSyncing] = useState(false)

	const load = useCallback(async () => {
		setState({ kind: 'loading' })
		try {
			const [profileRes, recentRes, progressRes] = await Promise.all([
				fetch('/api/retroachievements/profile'),
				fetch('/api/retroachievements/recent?count=20'),
				fetch('/api/retroachievements/progress'),
			])

			if (profileRes.status === 503) {
				setState({ kind: 'disabled' })
				return
			}

			if (!profileRes.ok) {
				const err = await profileRes.json().catch(() => ({}))
				setState({ kind: 'error', message: err.error ?? 'Failed to load profile' })
				return
			}

			const [profile, allAchievements, progress] = await Promise.all([
				profileRes.json() as Promise<RaProfile>,
				recentRes.ok ? (recentRes.json() as Promise<RaAchievement[]>) : Promise.resolve([]),
				progressRes.ok ? (progressRes.json() as Promise<RaGameProgress[]>) : Promise.resolve([]),
			])

			setState({ kind: 'ok', profile, allAchievements, progress })
		} catch (err) {
			setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
		}
	}, [])

	useEffect(() => {
		load()
	}, [load])

	async function handleSync() {
		setSyncing(true)
		try {
			await fetch('/api/retroachievements/sync', { method: 'POST' })
			await load()
		} finally {
			setSyncing(false)
		}
	}

	if (state.kind === 'loading') {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-32 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		)
	}

	if (state.kind === 'disabled') {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
				<Card>
					<CardContent className="p-8 text-center text-muted-foreground">
						<p className="mb-4">{t('notConfigured')}</p>
						<a href="../settings" className="underline text-sm">
							{t('goToSettings')}
						</a>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (state.kind === 'error') {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-destructive mb-4">
							{t('error')}: {state.message}
						</p>
						<Button onClick={load} variant="outline">
							{t('retry')}
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { profile, allAchievements, progress } = state
	const sortedAchievements = allAchievements.toSorted(
		(a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime(),
	)
	const recent = sortedAchievements.slice(0, RECENT_DISPLAY_COUNT)
	const topGames = progress.toSorted((a, b) => b.numAwarded - a.numAwarded).slice(0, 10)

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
					{syncing ? t('syncing') : t('sync')}
				</Button>
			</div>

			{/* Profile header */}
			<Card>
				<CardContent className="p-6">
					<div className="flex items-center gap-4">
						<Avatar className="size-16">
							<AvatarImage
								src={`https://media.retroachievements.org${profile.userPic}`}
								alt={profile.user}
							/>
							<AvatarFallback>{profile.user.slice(0, 2).toUpperCase()}</AvatarFallback>
						</Avatar>
						<div className="flex-1 min-w-0">
							<p className="font-bold text-lg">{profile.user}</p>
							{profile.motto && (
								<p className="text-sm text-muted-foreground truncate">{profile.motto}</p>
							)}
							<div className="flex gap-3 mt-1 text-sm flex-wrap">
								{profile.totalPoints > 0 && (
									<span>
										<span className="font-semibold">{profile.totalPoints.toLocaleString()}</span>{' '}
										{t('points')}
									</span>
								)}
								{profile.totalSoftcorePoints > 0 && (
									<span>
										<span className="font-semibold">
											{profile.totalSoftcorePoints.toLocaleString()}
										</span>{' '}
										{t('softcorePoints')}
									</span>
								)}
								{profile.totalTruePoints > 0 && (
									<span>
										<span className="font-semibold">
											{profile.totalTruePoints.toLocaleString()}
										</span>{' '}
										{t('truePoints')}
									</span>
								)}
							</div>
						</div>
					</div>
					{profile.richPresenceMsg && (
						<p className="mt-3 text-xs text-muted-foreground italic">{profile.richPresenceMsg}</p>
					)}
				</CardContent>
			</Card>

			{/* Unlock heatmap */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">{t('activityHeatmap')}</CardTitle>
				</CardHeader>
				<CardContent>
					<AchievementHeatmap achievements={allAchievements} />
				</CardContent>
			</Card>

			{/* Recent unlocks */}
			{recent.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{t('recentUnlocks')}</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="space-y-3">
							{recent.map((a) => (
								<li key={a.achievementId} className="flex items-start gap-3">
									<Image
										src={a.badgeUrl}
										alt={a.title}
										width={40}
										height={40}
										className="rounded shrink-0"
										unoptimized
									/>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium text-sm truncate">{a.title}</span>
											{a.hardcoreMode && (
												<Badge variant="secondary" className="text-[10px] px-1 py-0">
													HC
												</Badge>
											)}
										</div>
										<p className="text-xs text-muted-foreground truncate">
											{a.gameTitle} · {a.consoleName}
										</p>
										<p className="text-xs text-muted-foreground">
											{a.points} {t('points')} · {a.unlockedAt}
										</p>
									</div>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}

			{/* Top games */}
			{topGames.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{t('topGames')}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-1">
							{topGames.map((g, i) => (
								<div
									key={g.gameId}
									className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50"
								>
									<span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
										{i + 1}
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex items-baseline justify-between gap-2">
											<p className="truncate text-sm font-medium">{g.title}</p>
											<span className="shrink-0 text-xs font-mono text-muted-foreground">
												{g.numAwarded}/{g.numAchievements}
											</span>
										</div>
										<div className="mt-1 h-1 flex-1 rounded-full bg-muted overflow-hidden">
											<div
												className="h-full rounded-full bg-emerald-500/70"
												style={{ width: `${g.completionPct}%` }}
											/>
										</div>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
