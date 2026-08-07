export type Mood = 'chill' | 'challenge' | 'nostalgia' | 'discovery' | 'finish' | 'surprise'
export type AvailableTime = 30 | 60 | 120 | 240

export type RecommendationContext = {
	availableMinutes: AvailableTime
	mood: Mood
	excludedGameIds: number[]
}

export type Confidence = 'high' | 'medium' | 'exploration'

export type ReasonKey =
	| { key: 'inProgress' }
	| { key: 'finishableTonight'; params: { duration: string } }
	| { key: 'oneTwoSessions'; params: { duration: string } }
	| { key: 'favoriteConsole' }
	| { key: 'favoriteGenre'; params: { genre: string } }
	| { key: 'favoriteStudio'; params: { studio: string } }
	| { key: 'similarToFavorite' }
	| { key: 'lovedGame' }
	| { key: 'comfortGame' }
	| { key: 'idealFor30min' }
	| { key: 'longSession' }
	| { key: 'neverLaunched' }
	| { key: 'notPlayedInAWhile' }

export type ScoredGame = {
	gameId: number
	name: string
	system: string
	imagePath: string | null
	videoPath: string | null
	/**
	 * Object-storage URLs for the two paths above, resolved when the agent has
	 * already mirrored them (null otherwise, and always null self-hosted). Set on
	 * finalists only — scoring never needs them.
	 */
	imageUrl?: string | null
	videoUrl?: string | null
	genres: string[]
	releaseYear: number | null
	developer: string | null

	score: number
	confidence: Confidence
	reasons: ReasonKey[]

	lastPlayedAt: Date | null
	meaningfulSessionsCount: number

	scoreBreakdown?: Record<string, number>
	igdbBoosted?: boolean
}
