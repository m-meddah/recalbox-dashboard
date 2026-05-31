import { db } from '@/lib/db'
import {
	type WeightedItem,
	gameInheritedStats,
	gameRatings,
	games,
	sessions,
	userProfile,
} from '@/lib/db/schema'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'

const HALF_LIFE_DAYS = 90

type ClassificationKey = 'noise' | 'bounce' | 'taste' | 'meaningful' | 'marathon'
type RatingKey = 'love' | 'like' | 'dislike' | 'unknown'

const CLASSIFICATION_WEIGHTS: Record<ClassificationKey, number> = {
	noise: 0,
	bounce: -0.5,
	taste: 0.3,
	meaningful: 1.0,
	marathon: 2.0,
}

const RATING_WEIGHTS: Record<RatingKey, number> = {
	love: 2.0,
	like: 1.3,
	unknown: 1.0,
	dislike: -1.5,
}

const INHERITED_PENALTY = 0.7
const COMFORT_GAMES_TOP_N = 10
const BOUNCER_GAMES_TOP_N = 20
const TOP_ITEMS_PER_DIMENSION = 15
const MIN_RAW_SCORE_THRESHOLD = 0.05
const MATURITY_TARGET_SESSIONS = 50

type GameAttributes = {
	gameId: number
	system: string
	genres: string[]
	decade: string | null
	developer: string | null
}

/**
 * Recalcule entièrement le profil de goûts et le persiste.
 * Idempotent : peut être appelé autant de fois que voulu.
 *
 * Parcourt toutes les sessions scrobblées + données héritées, pondère chaque
 * contribution (decay temporel × classification × rating), distribue sur les
 * attributs des jeux, normalise par le max, et identifie comfort/bouncer games.
 */
export async function computeUserProfile(): Promise<void> {
	const start = Date.now()

	const [allSessions, allGames, allRatings, allInherited] = await Promise.all([
		db
			.select({
				gameId: sessions.gameId,
				startedAt: sessions.startedAt,
				classification: sessions.classification,
			})
			.from(sessions)
			.where(and(eq(sessions.source, 'scrobbler'), isNotNull(sessions.classification)))
			.all(),
		db
			.select({
				id: games.id,
				system: games.system,
				genre: games.genre,
				releaseDate: games.releaseDate,
				developer: games.developer,
			})
			.from(games)
			.all(),
		db.select().from(gameRatings).all(),
		db.select().from(gameInheritedStats).all(),
	])
	const ratingsMap = new Map(allRatings.map((r) => [r.gameId, r.rating]))

	const attrsMap = new Map<number, GameAttributes>()
	for (const g of allGames) {
		const year = g.releaseDate ? g.releaseDate.getFullYear() : null
		attrsMap.set(g.id, {
			gameId: g.id,
			system: g.system,
			genres: parseGenres(g.genre),
			decade: extractDecade(year),
			developer: g.developer ?? null,
		})
	}

	const systemsAcc = new Map<string, number>()
	const genresAcc = new Map<string, number>()
	const decadesAcc = new Map<string, number>()
	const developersAcc = new Map<string, number>()
	const perGameEngagement = new Map<number, number>()
	const perGameBounceScore = new Map<number, number>()

	const now = Date.now()
	let signalSessionsCount = 0

	for (const sess of allSessions) {
		if (sess.gameId == null) continue
		const classWeight = CLASSIFICATION_WEIGHTS[sess.classification!] ?? 0
		if (classWeight === 0) continue

		const daysSince = (now - sess.startedAt.getTime()) / (1000 * 60 * 60 * 24)
		const decay = Math.pow(0.5, daysSince / HALF_LIFE_DAYS)

		const rating = ratingsMap.get(sess.gameId)
		const ratingWeight = rating ? (RATING_WEIGHTS[rating] ?? 1.0) : 1.0

		const contribution = decay * classWeight * ratingWeight

		const attrs = attrsMap.get(sess.gameId)
		if (!attrs) continue

		addTo(systemsAcc, attrs.system, contribution)
		for (const g of attrs.genres) addTo(genresAcc, g, contribution)
		if (attrs.decade) addTo(decadesAcc, attrs.decade, contribution)
		if (attrs.developer) addTo(developersAcc, attrs.developer, contribution)

		if (contribution > 0) {
			addTo(perGameEngagement, sess.gameId, contribution)
			signalSessionsCount++
		} else if (contribution < 0) {
			addTo(perGameBounceScore, sess.gameId, Math.abs(contribution))
		}
	}

	for (const inh of allInherited) {
		if (!inh.lastPlayedAt || inh.playCount === 0) continue
		if (perGameEngagement.has(inh.gameId)) continue

		const daysSince = (now - inh.lastPlayedAt.getTime()) / (1000 * 60 * 60 * 24)
		const decay = Math.pow(0.5, daysSince / HALF_LIFE_DAYS)

		let classWeight: number
		if (inh.playCount >= 10) classWeight = CLASSIFICATION_WEIGHTS.marathon
		else if (inh.playCount >= 5) classWeight = CLASSIFICATION_WEIGHTS.meaningful
		else if (inh.playCount >= 2) classWeight = CLASSIFICATION_WEIGHTS.taste
		else continue

		const rating = ratingsMap.get(inh.gameId)
		const ratingWeight = rating ? (RATING_WEIGHTS[rating] ?? 1.0) : 1.0

		const contribution = decay * classWeight * ratingWeight * INHERITED_PENALTY
		if (contribution <= 0) continue

		const attrs = attrsMap.get(inh.gameId)
		if (!attrs) continue

		addTo(systemsAcc, attrs.system, contribution)
		for (const g of attrs.genres) addTo(genresAcc, g, contribution)
		if (attrs.decade) addTo(decadesAcc, attrs.decade, contribution)
		if (attrs.developer) addTo(developersAcc, attrs.developer, contribution)
		addTo(perGameEngagement, inh.gameId, contribution)
	}

	const systemsWeights = normalizeAndTop(systemsAcc)
	const genresWeights = normalizeAndTop(genresAcc)
	const decadesWeights = normalizeAndTop(decadesAcc)
	const developersWeights = normalizeAndTop(developersAcc)

	const comfortGames = sortMapDesc(perGameEngagement)
		.slice(0, COMFORT_GAMES_TOP_N)
		.map(([gameId]) => gameId)

	const bouncerGames: number[] = []
	for (const [gameId, bounceScore] of sortMapDesc(perGameBounceScore)) {
		if (bouncerGames.length >= BOUNCER_GAMES_TOP_N) break
		const engagementScore = perGameEngagement.get(gameId) ?? 0
		if (bounceScore > engagementScore * 1.5) {
			bouncerGames.push(gameId)
		}
	}

	const profileMaturity = Math.min(1, signalSessionsCount / MATURITY_TARGET_SESSIONS)

	await db
		.update(userProfile)
		.set({
			systemsWeights,
			genresWeights,
			decadesWeights,
			developersWeights,
			comfortGames,
			bouncerGames,
			totalSignalSessions: signalSessionsCount,
			profileMaturity,
			computedAt: new Date(),
			computeDurationMs: Date.now() - start,
		})
		.where(eq(userProfile.id, 1))
}

function addTo<K>(map: Map<K, number>, key: K, value: number): void {
	if (key === null || key === undefined || key === '') return
	map.set(key, (map.get(key) ?? 0) + value)
}

function parseGenres(raw: string | null): string[] {
	if (!raw) return []
	return raw.split(',').flatMap((s) => {
		const t = s.trim()
		return t ? [t] : []
	})
}

function extractDecade(year: number | null): string | null {
	if (year == null || isNaN(year) || year < 1970 || year > 2030) return null
	const decadeStart = Math.floor(year / 10) * 10
	return `${decadeStart}s`
}

function sortMapDesc<K>(map: Map<K, number>): [K, number][] {
	return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
}

function normalizeAndTop(map: Map<string, number>): WeightedItem[] {
	const entries = Array.from(map.entries()).filter(([_, score]) => score >= MIN_RAW_SCORE_THRESHOLD)

	if (entries.length === 0) return []

	const maxScore = Math.max(...entries.map(([_, s]) => s))
	if (maxScore <= 0) return []

	return entries
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_ITEMS_PER_DIMENSION)
		.map(([key, rawScore]) => ({
			key,
			rawScore,
			weight: Number((rawScore / maxScore).toFixed(3)),
		}))
}
