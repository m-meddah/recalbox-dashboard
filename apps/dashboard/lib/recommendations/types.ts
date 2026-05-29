export type Mood = 'chill' | 'challenge' | 'nostalgia' | 'discovery' | 'finish' | 'surprise'
export type AvailableTime = 30 | 60 | 120 | 240

export type RecommendationContext = {
	availableMinutes: AvailableTime
	mood: Mood
	excludedGameIds: number[]
}

export type Confidence = 'high' | 'medium' | 'exploration'

export type ScoredGame = {
	gameId: number
	name: string
	system: string
	imageUrl: string | null
	videoUrl: string | null
	genres: string[]
	releaseYear: number | null
	developer: string | null

	score: number
	confidence: Confidence
	reasons: string[]

	lastPlayedAt: Date | null
	meaningfulSessionsCount: number

	scoreBreakdown?: Record<string, number>
	igdbBoosted?: boolean
}
