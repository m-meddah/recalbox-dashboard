#!/usr/bin/env tsx
// Read-only smoke test of the recommendation engine: runs every mood × duration
// against the real collection and prints the 3 finalists for each, WITHOUT writing
// to recommendation_log or triggering lazy matching (persist: false).
//
// Stays fully local — point it at the libSQL replica file and do NOT load .env.local,
// so the IGDB similarity boost uses only what is already cached (no network):
//
//   DATABASE_PATH=./recalbox-replica.db pnpm --filter @recalbox/dashboard exec \
//     tsx scripts/test-recommendations.ts
import { computeRecommendations } from '../lib/recommendations/recommend'
import type { AvailableTime, Mood, ScoredGame } from '../lib/recommendations/types'

const MOODS: Mood[] = ['surprise', 'chill', 'challenge', 'nostalgia', 'discovery', 'finish']
const DURATIONS: AvailableTime[] = [30, 60, 120, 240]

function fmtReasons(g: ScoredGame): string {
	return g.reasons
		.map((r) => {
			if ('params' in r && r.params) return `${r.key}(${Object.values(r.params).join(',')})`
			return r.key
		})
		.join(', ')
}

function line(g: ScoredGame): string {
	const name = g.name.length > 42 ? `${g.name.slice(0, 41)}…` : g.name
	const igdb = g.igdbBoosted ? ' ⚡IGDB' : ''
	// favoriteBoost is only set when the game is an EmulationStation favorite that
	// isn't already rated love/like — i.e. the favorite is what gave it the +15.
	const fav = g.scoreBreakdown?.favoriteBoost ? ' ⭐fav' : ''
	return `    • ${name.padEnd(42)} [${g.system.padEnd(10)}] ${String(Math.round(g.score)).padStart(4)}pts  ${g.confidence.padEnd(11)} ${fmtReasons(g)}${igdb}${fav}`
}

async function main() {
	for (const mood of MOODS) {
		console.log(`\n══════════ MOOD: ${mood.toUpperCase()} ══════════`)
		for (const availableMinutes of DURATIONS) {
			const finalists = await computeRecommendations({ mood, availableMinutes }, { persist: false })
			console.log(`\n  ${availableMinutes} min →`)
			if (finalists.length === 0) {
				console.log('    (aucun candidat)')
				continue
			}
			for (const g of finalists) console.log(line(g))
		}
	}
	console.log('\n')
	process.exit(0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
