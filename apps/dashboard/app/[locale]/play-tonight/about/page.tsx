'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
	ArrowRight,
	BarChart3,
	Compass,
	Database,
	MessageSquareHeart,
	Network,
	Sparkles,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type ProfileData = {
	profileMaturity: number
	totalSignalSessions: number
}

type IgdbStatus = {
	enabled: boolean
}

export default function PlayTonightAboutPage() {
	const t = useTranslations('playTonight.about')
	const [profile, setProfile] = useState<ProfileData | null>(null)
	const [igdb, setIgdb] = useState<IgdbStatus | null>(null)

	useEffect(() => {
		fetch('/api/profile')
			.then((r) => r.json())
			.then(setProfile)
		fetch('/api/igdb/status')
			.then((r) => (r.ok ? r.json() : null))
			.then(setIgdb)
			.catch(() => setIgdb(null))
	}, [])

	if (!profile)
		return <div className="container mx-auto px-4 py-8 text-muted-foreground">{t('loading')}</div>

	const maturity = Math.round((profile.profileMaturity ?? 0) * 100)
	const igdbEnabled = igdb?.enabled ?? false

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
			<header className="space-y-1">
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground">{t('subtitle')}</p>
			</header>

			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Sparkles className="size-4" /> {t('algoStatus.title')}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span>{t('algoStatus.maturityLabel')}</span>
							<span className="font-medium">{maturity}%</span>
						</div>
						<Progress value={maturity} />
						<p className="text-xs text-muted-foreground">
							{t('algoStatus.maturityHint', { count: profile.totalSignalSessions ?? 0 })}
						</p>
					</div>
					<div className="flex items-center gap-2 text-sm">
						{igdbEnabled ? (
							<>
								<div className="size-2 rounded-full bg-green-500" />
								<span>{t('algoStatus.igdbEnabled')}</span>
							</>
						) : (
							<>
								<div className="size-2 rounded-full bg-muted-foreground/40" />
								<span>
									{t('algoStatus.igdbDisabled')}{' '}
									<Link href="/settings" className="text-primary underline">
										{t('algoStatus.igdbActivateLink')}
									</Link>
								</span>
							</>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">{t('sources.title')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4 text-sm">
					<Source
						icon={Database}
						title={t('sources.sessions.title')}
						desc={t('sources.sessions.desc')}
					/>
					<Source
						icon={BarChart3}
						title={t('sources.comfortGames.title')}
						desc={t('sources.comfortGames.desc')}
					/>
					<Source
						icon={MessageSquareHeart}
						title={t('sources.feedback.title')}
						desc={t('sources.feedback.desc')}
					/>
					{igdbEnabled && (
						<Source
							icon={Network}
							title={t('sources.igdb.title')}
							desc={t('sources.igdb.desc')}
							highlighted
						/>
					)}
					<Source icon={Compass} title={t('sources.mood.title')} desc={t('sources.mood.desc')} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">{t('confidence.title')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<Conf level={t('confidence.high.level')} color="green" desc={t('confidence.high.desc')} />
					<Conf
						level={t('confidence.medium.level')}
						color="blue"
						desc={t('confidence.medium.desc')}
					/>
					<Conf
						level={t('confidence.exploration.level')}
						color="purple"
						desc={t('confidence.exploration.desc')}
					/>
				</CardContent>
			</Card>

			<Card className="bg-primary/5 border-primary/30">
				<CardHeader>
					<CardTitle className="text-base">{t('tips.title')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<Tip>{t('tips.play')}</Tip>
					<Tip>{t('tips.feedback')}</Tip>
					<Tip>{t('tips.skip')}</Tip>
					{!igdbEnabled && (
						<Tip emphasis>
							{t.rich('tips.igdb', {
								link: (chunks) => (
									<Link href="/settings" className="underline">
										{chunks}
									</Link>
								),
							})}
						</Tip>
					)}
				</CardContent>
			</Card>

			<div className="flex justify-between pt-2">
				<Link
					href="/profile"
					className="text-sm text-primary inline-flex items-center hover:underline"
				>
					{t('links.profile')} <ArrowRight className="size-4 ml-1" />
				</Link>
				<Link
					href="/play-tonight"
					className="text-sm text-primary inline-flex items-center hover:underline"
				>
					{t('links.backToRecs')} <ArrowRight className="size-4 ml-1" />
				</Link>
			</div>
		</div>
	)
}

function Source({
	icon: Icon,
	title,
	desc,
	highlighted = false,
}: {
	icon: React.ComponentType<{ className?: string }>
	title: string
	desc: string
	highlighted?: boolean
}) {
	return (
		<div
			className={`flex gap-3 ${highlighted ? 'p-3 rounded-md bg-primary/5 border border-primary/20' : ''}`}
		>
			<Icon className="size-5 mt-0.5 text-primary shrink-0" />
			<div>
				<p className="font-medium">{title}</p>
				<p className="text-muted-foreground">{desc}</p>
			</div>
		</div>
	)
}

function Conf({
	level,
	color,
	desc,
}: { level: string; color: 'green' | 'blue' | 'purple'; desc: string }) {
	const cls = {
		green: 'bg-green-500/10 text-green-700 dark:text-green-400',
		blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
		purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
	}[color]
	return (
		<div className="flex gap-3 items-start">
			<span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${cls}`}>{level}</span>
			<span className="text-muted-foreground">{desc}</span>
		</div>
	)
}

function Tip({ children, emphasis = false }: { children: React.ReactNode; emphasis?: boolean }) {
	return (
		<div className="flex gap-2">
			<span className={emphasis ? 'text-primary' : 'text-muted-foreground'}>•</span>
			<span>{children}</span>
		</div>
	)
}
