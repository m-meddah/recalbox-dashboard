#!/usr/bin/env tsx
/**
 * Link orphan scrobbler sessions to their collection game.
 *
 * `SessionManager.insert` used to write sessions without a `gameId` (the agent
 * ingest path always set it). `getGamePlayStatsBatch` groups by `sessions.gameId`
 * and drops the null key, so every scrobbled session was invisible to the taste
 * profile and to the recommender — the "finish a game" mood in particular could
 * only ever see gamelist-inherited playtime.
 *
 * The insert is fixed going forward; this backfills the rows written before that.
 * Matching is the same one both write paths use: exact `(romPath, recalboxId)`.
 * A session whose ROM is no longer in the collection stays null — there is
 * nothing to point it at, and guessing by name would attach playtime to the
 * wrong regional dump.
 *
 * Idempotent: only ever touches rows where `gameId IS NULL`.
 *
 * Usage:
 *   pnpm sessions:backfill             # link what can be linked
 *   pnpm sessions:backfill --dry-run   # preview without writing
 */
import './load-env'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../lib/db/index'
import { games, sessions } from '../lib/db/schema'

const dryRun = process.argv.includes('--dry-run')

async function main() {
	const orphans = await db
		.select({
			id: sessions.id,
			recalboxId: sessions.recalboxId,
			romPath: sessions.romPath,
			system: sessions.system,
			source: sessions.source,
		})
		.from(sessions)
		.where(isNull(sessions.gameId))
		.all()

	if (orphans.length === 0) {
		console.log('No sessions without a gameId — nothing to do.')
		return
	}

	console.log(`${orphans.length} session(s) without a gameId.`)

	let linked = 0
	const unmatched: typeof orphans = []

	for (const session of orphans) {
		// `sessions.recalboxId` is nullable; without it there is no way to tell which
		// machine's collection the ROM path belongs to, so the row stays orphaned.
		const game = session.recalboxId
			? await db
					.select({ id: games.id, name: games.name })
					.from(games)
					.where(and(eq(games.romPath, session.romPath), eq(games.recalboxId, session.recalboxId)))
					.get()
			: undefined

		if (!game) {
			unmatched.push(session)
			continue
		}

		if (!dryRun) {
			await db.update(sessions).set({ gameId: game.id }).where(eq(sessions.id, session.id))
		}
		linked++
		console.log(`  ${dryRun ? 'would link' : 'linked'} session ${session.id} → ${game.name}`)
	}

	if (unmatched.length > 0) {
		console.log(`\n${unmatched.length} session(s) left unlinked (ROM absent from the collection):`)
		for (const s of unmatched) console.log(`  session ${s.id} [${s.system}] ${s.romPath}`)
	}

	console.log(
		`\n${dryRun ? 'Would link' : 'Linked'} ${linked}/${orphans.length} session(s).${
			dryRun ? ' Re-run without --dry-run to apply.' : ''
		}`,
	)
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
