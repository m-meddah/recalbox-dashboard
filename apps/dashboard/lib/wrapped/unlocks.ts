import type { WrappedRawData, WrappedUnlock } from './types'

const UNLOCK_DEFS: Record<
	string,
	{ title: string; description: string; rarity: WrappedUnlock['rarity'] }
> = {
	'night-owl':          { title: 'Insomniaque',       description: 'Plus de 10% du temps de jeu entre minuit et 4h du matin.', rarity: 'uncommon' },
	speedrunner:          { title: 'Speedrunner',        description: 'Plus de 30 sessions de moins de 15 minutes.', rarity: 'rare' },
	'marathon-man':       { title: 'Marathon Man',       description: 'Au moins une session de plus de 5 heures.', rarity: 'rare' },
	diversified:          { title: 'Diversifié',         description: "Plus de 15 systèmes différents joués dans l'année.", rarity: 'uncommon' },
	monogame:             { title: 'Monogame',           description: 'Plus de 50% du temps de jeu sur un seul jeu.', rarity: 'legendary' },
	completionist:        { title: 'Touche-à-tout',      description: "Plus de 100 jeux différents joués dans l'année.", rarity: 'uncommon' },
	'early-bird':         { title: 'Lève-tôt',           description: 'Plus de 30% du temps de jeu entre 5h et 9h du matin.', rarity: 'uncommon' },
	'weekend-warrior':    { title: 'Weekend Warrior',    description: 'Plus de 70% du temps de jeu le samedi et dimanche.', rarity: 'common' },
	throwback:            { title: 'Throwback Thursday', description: 'Plus de 20% du temps sur des jeux sortis il y a plus de 20 ans.', rarity: 'uncommon' },
	'achievement-hunter': { title: 'Achievement Hunter', description: "Plus de 100 succès RetroAchievements débloqués dans l'année.", rarity: 'rare' },
	hardcore:             { title: 'Hardcore',           description: 'Plus de 80% des succès RA débloqués en mode hardcore.', rarity: 'legendary' },
}

function make(id: string): WrappedUnlock {
	const def = UNLOCK_DEFS[id]!
	return { id, ...def }
}

export function computeUnlocks(data: WrappedRawData): WrappedUnlock[] {
	if (data.totalDurationSec === 0) return []

	const unlocks: WrappedUnlock[] = []
	const total = data.totalDurationSec

	if (data.nightPlaySec / total > 0.10) unlocks.push(make('night-owl'))
	if (data.shortSessionCount > 30) unlocks.push(make('speedrunner'))
	if (data.longestSession && data.longestSession.durationSec > 5 * 3600) unlocks.push(make('marathon-man'))
	if (data.uniqueSystemsCount > 15) unlocks.push(make('diversified'))
	if (data.topGames[0] && data.topGames[0].playtimeSec / total > 0.50) unlocks.push(make('monogame'))
	if (data.uniqueGamesCount > 100) unlocks.push(make('completionist'))
	if (data.earlyBirdSec / total > 0.30) unlocks.push(make('early-bird'))
	if (data.weekendSec / total > 0.70) unlocks.push(make('weekend-warrior'))
	if (data.throwbackGameSec / total > 0.20) unlocks.push(make('throwback'))

	if (data.raAchievements !== null) {
		if (data.raAchievements.length > 100) unlocks.push(make('achievement-hunter'))
		if (
			data.raAchievements.length > 0 &&
			data.raAchievements.filter((a) => a.isHardcore).length / data.raAchievements.length > 0.80
		) {
			unlocks.push(make('hardcore'))
		}
	}

	return unlocks
}
