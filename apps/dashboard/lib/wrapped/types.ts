export type WrappedUnlock = {
	id: string
	title: string
	description: string
	rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
}

export type IntroSlide = { type: 'intro' }

export type TotalTimeSlide = {
	type: 'total-time'
	totalHours: number
	totalSessions: number
	comparisonMovies: number
}

export type MostPlayedGameSlide = {
	type: 'most-played-game'
	gameName: string
	system: string
	playtimeHours: number
	sessionCount: number
	imagePath: string | null
}

export type TopSystemSlide = {
	type: 'top-system'
	system: string
	percentage: number
	breakdown: Array<{ system: string; percentage: number; playtimeSec: number }>
}

export type TopGamesListSlide = {
	type: 'top-games-list'
	games: Array<{ gameName: string; system: string; playtimeHours: number; rank: number }>
}

export type LongestSessionSlide = {
	type: 'longest-session'
	gameName: string
	durationHours: number
	durationMinutes: number
	dateStr: string
}

export type BusiestDaySlide = {
	type: 'busiest-day'
	dateStr: string
	totalHours: number
	sessionCount: number
}

export type StreakSlide = {
	type: 'streak'
	longestStreak: number
	activeDays: string[]
}

export type AchievementsSummarySlide = {
	type: 'achievements-summary'
	totalUnlocked: number
	totalPoints: number
	rarestAchievement: { title: string; points: number; imageUrl: string } | null
}

export type UnlocksSlide = {
	type: 'unlocks'
	unlocks: WrappedUnlock[]
}

export type ComparisonSlide = {
	type: 'comparison-vs-others'
	percentile: number
	totalHours: number
	averageHours: number
}

export type OutroSlide = {
	type: 'outro'
	year: number
	totalHours: number
}

export type WrappedSlide =
	| IntroSlide
	| TotalTimeSlide
	| MostPlayedGameSlide
	| TopSystemSlide
	| TopGamesListSlide
	| LongestSessionSlide
	| BusiestDaySlide
	| StreakSlide
	| AchievementsSummarySlide
	| UnlocksSlide
	| ComparisonSlide
	| OutroSlide

export type Wrapped = {
	year: number
	generatedAt: Date
	user: { pseudo?: string }
	slides: WrappedSlide[]
	unlocks: WrappedUnlock[]
}

export type WrappedRawData = {
	year: number
	totalSessions: number
	totalDurationSec: number
	uniqueGamesCount: number
	uniqueSystemsCount: number
	topGames: Array<{
		gameName: string
		system: string
		playtimeSec: number
		sessionCount: number
		imagePath: string | null
	}>
	bySystem: Array<{ system: string; playtimeSec: number }>
	longestSession: { gameName: string; durationSec: number; startedAt: Date } | null
	busiestDay: { dateStr: string; totalSec: number; sessionCount: number } | null
	activeDays: string[]
	shortSessionCount: number
	nightPlaySec: number
	earlyBirdSec: number
	weekendSec: number
	throwbackGameSec: number
	raAchievements: Array<{ title: string; points: number; imageUrl: string; isHardcore: boolean }> | null
	userPseudo: string | undefined
}
