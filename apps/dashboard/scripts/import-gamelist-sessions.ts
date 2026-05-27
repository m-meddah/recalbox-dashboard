#!/usr/bin/env tsx
/**
 * Populate game_inherited_stats from the games table.
 *
 * Reads playCount / lastPlayed already stored in `games` (synced from
 * gamelist-userdata.ini during collection sync) and upserts them into the
 * dedicated `game_inherited_stats` table so the recommendation algorithm
 * can work with them separately from real scrobbler sessions.
 *
 * Usage:
 *   pnpm gamelist:import          # upsert inherited stats for all games
 *   pnpm gamelist:import --dry-run  # preview without writing
 *   pnpm gamelist:clear             # remove all inherited stats rows
 */
import { isNotNull, or, sql } from 'drizzle-orm'
import { db } from '../lib/db/index'
import { gameInheritedStats, games } from '../lib/db/schema'
import { syncInheritedStats } from '../lib/recalbox/sync-inherited-stats'

const isDryRun = process.argv.includes('--dry-run')
const isClear = process.argv.includes('--clear')

async function clear() {
	const result = await db.delete(gameInheritedStats)
	console.log(`Cleared ${result.changes} inherited stat row(s).`)
}

async function importInheritedStats() {
	const candidates = await db
		.select({
			id: games.id,
			name: games.name,
			system: games.system,
			playCount: games.playCount,
			lastPlayed: games.lastPlayed,
		})
		.from(games)
		.where(or(sql`${games.playCount} > 0`, isNotNull(games.lastPlayed)))

	if (candidates.length === 0) {
		console.log('No games with playCount or lastPlayed found. Run a collection sync first.')
		return
	}

	const systemCounts = candidates.reduce<Record<string, number>>((acc, g) => {
		acc[g.system] = (acc[g.system] ?? 0) + 1
		return acc
	}, {})

	console.log(`\nGames with inherited play data: ${candidates.length}`)
	console.log('\nBy system:')
	for (const [system, count] of Object.entries(systemCounts).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${system.padEnd(14)} ${count}`)
	}

	if (isDryRun) {
		console.log('\n[dry-run] No rows written.')
		return
	}

	const entries = candidates.map((g) => ({
		gameId: g.id,
		playCount: g.playCount ?? 0,
		lastPlayedAt: g.lastPlayed ?? null,
	}))

	const { imported } = await syncInheritedStats(db, entries)

	console.log(`\nUpserted ${imported} inherited stat row(s).`)
	console.log('Run `pnpm gamelist:clear` to undo.')
}

async function main() {
	if (isClear) {
		await clear()
		return
	}
	await importInheritedStats()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
