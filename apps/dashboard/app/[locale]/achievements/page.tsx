'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { RaAchievement, RaGameProgress, RaProfile } from '@/lib/retroachievements/service'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

const RECENT_DISPLAY_COUNT = 20

type State =
	| { kind: 'loading' }
	| { kind: 'disabled' }
	| { kind: 'error'; message: string }
	| { kind: 'ok'; profile: RaProfile; allAchievements: RaAchievement[]; progress: RaGameProgress[] }

function AchievementHeatmap({ achievements }: { achievements: RaAchievement[] }) {
	const t = useTranslations('achievements.heatmap')

	const countByDay = new Map<string, number>()
	for (const a of achievements) {
		const d = a.unlockedAt.slice(0, 10)
		countByDay.set(d, (countByDay.get(d) ?? 0) + 1)
	}

	const today = new Date()
	const days: Array<{ date: string; count: number }> = []
	for (let i = 364; i >= 0; i--) {
		const d = new Date(today)
		d.setDate(d.getDate() - i)
		const key = d.toISOString().slice(0, 10)
		days.push({ date: key, count: countByDay.get(key) ?? 0 })
	}

	const maxCount = Math.max(...days.map((d) => d.count), 1)

	function cellColor(count: number): string {
		if (count === 0) return 'bg-muted'
		const intensity = Math.ceil((count / maxCount) * 4)
		return ['', 'bg-yellow-200', 'bg-yellow-400', 'bg-yellow-600', 'bg-yellow-800'][intensity] ?? 'bg-yellow-800'
	}

	const weeks: Array<typeof days> = []
	for (let i = 0; i < days.length; i += 7) {
		weeks.push(days.slice(i, i + 7))
	}

	return (
		<div>
			<p className="text-xs text-muted-foreground mb-2">{t('label')}</p>
			<div className="flex gap-0.5 overflow-x-auto pb-2">
				{weeks.map((week, wi) => (
					<div key={wi} className="flex flex-col gap-0.5">
						{week.map((day) => (
							<div
								key={day.date}
								className={`w-3 h-3 rounded-sm ${cellColor(day.count)}`}
								title={`${day.date}: ${day.count}`}
							/>
						))}
					</div>
				))}
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
			<div className="container max-w-3xl mx-auto p-6 space-y-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-32 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		)
	}

	if (state.kind === 'disabled') {
		return (
			<div className="container max-w-3xl mx-auto p-6">
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
			<div className="container max-w-3xl mx-auto p-6">
				<h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-destructive mb-4">{t('error')}: {state.message}</p>
						<Button onClick={load} variant="outline">{t('retry')}</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { profile, allAchievements, progress } = state
	const sortedAchievements = [...allAchievements].sort(
		(a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime(),
	)
	const recent = sortedAchievements.slice(0, RECENT_DISPLAY_COUNT)
	const topGames = [...progress]
		.sort((a, b) => b.numAwarded - a.numAwarded)
		.slice(0, 10)

	return (
		<div className="container max-w-3xl mx-auto p-6 space-y-6">
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
						<Avatar className="h-16 w-16">
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
										<span className="font-semibold">{profile.totalSoftcorePoints.toLocaleString()}</span>{' '}
										{t('softcorePoints')}
									</span>
								)}
								{profile.totalTruePoints > 0 && (
									<span>
										<span className="font-semibold">{profile.totalTruePoints.toLocaleString()}</span>{' '}
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
									<img
										src={a.badgeUrl}
										alt={a.title}
										width={40}
										height={40}
										className="rounded shrink-0"
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
						<ul className="space-y-4">
							{topGames.map((g) => (
								<li key={g.gameId}>
									<div className="flex items-center justify-between text-sm mb-1">
										<span className="font-medium truncate flex-1">{g.title}</span>
										<span className="text-muted-foreground shrink-0 ml-2">
											{g.numAwarded}/{g.numAchievements}
										</span>
									</div>
									<Progress value={g.completionPct} className="h-2" />
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
