import type { WrappedSlide, Wrapped } from '@/lib/wrapped/types'
import { SLIDE_ACCENTS } from './accents'

type Props = {
	slide: WrappedSlide
	wrapped: Wrapped
	width: number
	height: number
}

function SlideContent({ slide }: { slide: WrappedSlide }) {
	switch (slide.type) {
		case 'intro':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
					<div style={{ fontSize: 48, fontWeight: 900, color: '#ffffff' }}>🕹️</div>
					<div style={{ fontSize: 36, fontWeight: 700, color: '#ffffff', textAlign: 'center' }}>Recalbox Wrapped</div>
				</div>
			)
		case 'total-time':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80', fontWeight: 500 }}>Total gaming time</div>
					<div style={{ fontSize: 96, fontWeight: 900, color: '#ffffff', lineHeight: 1 }}>{slide.totalHours}h</div>
					<div style={{ fontSize: 16, color: '#ffffff60' }}>{slide.totalSessions} sessions</div>
				</div>
			)
		case 'most-played-game':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>Most played</div>
					<div style={{ fontSize: 40, fontWeight: 900, color: '#ffffff', textAlign: 'center' }}>{slide.gameName}</div>
					<div style={{ fontSize: 20, color: '#ffffff80' }}>{slide.playtimeHours}h · {slide.sessionCount} sessions</div>
				</div>
			)
		case 'top-games-list':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
					<div style={{ fontSize: 20, color: '#ffffff80', marginBottom: 8 }}>Top games</div>
					{slide.games.map((g) => (
						<div key={g.gameName} style={{ display: 'flex', justifyContent: 'space-between', color: '#ffffff' }}>
							<span style={{ fontWeight: 700 }}>#{g.rank} {g.gameName}</span>
							<span style={{ color: '#ffffff80' }}>{g.playtimeHours}h</span>
						</div>
					))}
				</div>
			)
		case 'longest-session':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>Longest session</div>
					<div style={{ fontSize: 48, fontWeight: 900, color: '#ffffff' }}>{slide.durationHours}h {slide.durationMinutes}min</div>
					<div style={{ fontSize: 20, color: '#ffffff' }}>{slide.gameName}</div>
				</div>
			)
		case 'busiest-day':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>Most active day</div>
					<div style={{ fontSize: 32, fontWeight: 900, color: '#ffffff' }}>{slide.dateStr}</div>
					<div style={{ fontSize: 24, color: '#ffffff80' }}>{slide.totalHours}h in {slide.sessionCount} sessions</div>
				</div>
			)
		case 'streak':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>Streak record</div>
					<div style={{ fontSize: 80, fontWeight: 900, color: '#ffffff' }}>{slide.longestStreak}</div>
					<div style={{ fontSize: 24, color: '#ffffff80' }}>days in a row</div>
				</div>
			)
		case 'top-system':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>Top system</div>
					<div style={{ fontSize: 48, fontWeight: 900, color: '#ffffff' }}>{slide.system.toUpperCase()}</div>
					<div style={{ fontSize: 24, color: '#ffffff80' }}>{slide.percentage}% of your time</div>
				</div>
			)
		case 'achievements-summary':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>RetroAchievements</div>
					<div style={{ fontSize: 72, fontWeight: 900, color: '#ffffff' }}>{slide.totalUnlocked}</div>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>achievements · {slide.totalPoints} pts</div>
				</div>
			)
		case 'unlocks':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
					<div style={{ fontSize: 20, color: '#ffffff80', marginBottom: 8 }}>Secret badges</div>
					{slide.unlocks.slice(0, 4).map((u) => (
						<div key={u.id} style={{ display: 'flex', flexDirection: 'column', color: '#ffffff' }}>
							<span style={{ fontWeight: 700 }}>{u.title}</span>
							<span style={{ fontSize: 13, color: '#ffffff60' }}>{u.rarity}</span>
						</div>
					))}
				</div>
			)
		case 'comparison-vs-others':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
					<div style={{ fontSize: 18, color: '#ffffff80' }}>vs. other players</div>
					<div style={{ fontSize: 60, fontWeight: 900, color: '#ffffff' }}>Top {slide.percentile}%</div>
					<div style={{ fontSize: 18, color: '#ffffff60' }}>You: {slide.totalHours}h · Avg: {slide.averageHours}h</div>
				</div>
			)
		case 'outro':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
					<div style={{ fontSize: 48 }}>🎮</div>
					<div style={{ fontSize: 36, fontWeight: 900, color: '#ffffff', textAlign: 'center' }}>See you next year!</div>
					<div style={{ fontSize: 20, color: '#ffffff80' }}>{slide.year} · {slide.totalHours}h played</div>
				</div>
			)
		default:
			return null
	}
}

export function SlideImage({ slide, width, height }: Props) {
	const accent = SLIDE_ACCENTS[slide.type]

	return (
		<div
			style={{
				width,
				height,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: '#0a0a0a',
				position: 'relative',
				fontFamily: 'Inter',
			}}
		>
			{/* Glow */}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: `radial-gradient(ellipse 80% 60% at 50% 35%, ${accent}40, transparent 70%)`,
				}}
			/>
			{/* Glass card */}
			<div
				style={{
					position: 'relative',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					width: Math.min(width * 0.85, 800),
					padding: 40,
					borderRadius: 32,
					border: '1px solid rgba(255,255,255,0.1)',
					backgroundColor: 'rgba(255,255,255,0.05)',
				}}
			>
				<SlideContent slide={slide} />
			</div>
			{/* Watermark */}
			<div
				style={{
					position: 'absolute',
					bottom: 20,
					right: 20,
					fontSize: 12,
					color: 'rgba(255,255,255,0.25)',
					fontFamily: 'Inter',
				}}
			>
				github.com/m-meddah/recalbox-dashboard
			</div>
		</div>
	)
}
