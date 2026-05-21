#!/usr/bin/env tsx
/**
 * Bootstrap real sessions from gamelist.xml data already in the `games` table.
 *
 * Only `lastPlayed` is a trustworthy timestamp — we create one session per game
 * anchored to that date. playCount > 1 means more sessions happened, but we have
 * no reliable timestamps for them, so we don't fabricate history.
 *
 * Usage:
 *   pnpm gamelist:import                    # import with 30-min default duration
 *   pnpm gamelist:import --duration 3600    # assume 1-hour sessions
 *   pnpm gamelist:import --dry-run          # preview without writing
 *   pnpm gamelist:clear                     # remove all gamelist-import sessions
 */
import { and, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../lib/db/index'
import { games, sessions } from '../lib/db/schema'

const CLOSED_REASON = 'gamelist-import'

const isDryRun = process.argv.includes('--dry-run')
const isClear = process.argv.includes('--clear')

const durationArg = process.argv.indexOf('--duration')
const DEFAULT_DURATION_SECONDS = 30 * 60
const durationSeconds =
	durationArg !== -1 ? Number(process.argv[durationArg + 1]) || DEFAULT_DURATION_SECONDS : DEFAULT_DURATION_SECONDS

async function clear() {
	const result = await db.delete(sessions).where(sql`${sessions.closedReason} = ${CLOSED_REASON}`)
	console.log(`Cleared ${result.changes} gamelist-import session(s).`)
}

async function importSessions() {
	const candidates = await db
		.select({
			id: games.id,
			recalboxId: games.recalboxId,
			name: games.name,
			system: games.system,
			romPath: games.romPath,
			lastPlayed: games.lastPlayed,
			playCount: games.playCount,
		})
		.from(games)
		.where(isNotNull(games.lastPlayed))

	if (candidates.length === 0) {
		console.log('No games with lastPlayed found. Run a collection sync first.')
		return
	}

	const alreadyImported = await db
		.select({ romPath: sessions.romPath })
		.from(sessions)
		.where(sql`${sessions.closedReason} = ${CLOSED_REASON}`)

	const alreadyImportedPaths = new Set(alreadyImported.map((s) => s.romPath))

	const rows = candidates
		.filter((g) => !alreadyImportedPaths.has(g.romPath))
		.map((g) => {
			const endedAt = g.lastPlayed as Date
			const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000)
			return {
				recalboxId: g.recalboxId,
				gameId: g.id,
				startedAt,
				endedAt,
				durationSeconds,
				system: g.system,
				romPath: g.romPath,
				autoClosed: true,
				closedReason: CLOSED_REASON,
			}
		})

	const skipped = candidates.length - rows.length

	if (rows.length === 0) {
		console.log(`Nothing to import — all ${candidates.length} game(s) already imported.`)
		return
	}

	const systemCounts = rows.reduce<Record<string, number>>((acc, r) => {
		acc[r.system] = (acc[r.system] ?? 0) + 1
		return acc
	}, {})

	console.log(`\nGames with lastPlayed: ${candidates.length}`)
	console.log(`Already imported:      ${skipped}`)
	console.log(`To import:             ${rows.length}`)
	console.log(`Assumed duration:      ${durationSeconds}s (${Math.round(durationSeconds / 60)} min/session)`)
	console.log(`\nBy system:`)
	for (const [system, count] of Object.entries(systemCounts).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${system.padEnd(14)} ${count}`)
	}

	if (isDryRun) {
		console.log('\n[dry-run] No sessions written.')
		return
	}

	await db.insert(sessions).values(rows)
	console.log(`\nImported ${rows.length} session(s).`)
	console.log(`Note: playCount > 1 sessions have no reliable timestamps and were not fabricated.`)
	console.log(`Run \`pnpm gamelist:clear\` to undo.`)
}

async function main() {
	if (isClear) {
		await clear()
		return
	}
	await importSessions()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
