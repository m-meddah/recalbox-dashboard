import { listUncheckedGames, updateGameSrInfo } from '@/lib/db/queries'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { srClient } from '@/lib/super-retrogamers/client'
import { gameToSlugVariants } from '@/lib/super-retrogamers/slug'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type EnrichEvent =
	| { type: 'start'; total: number }
	| { type: 'progress'; done: number; total: number }
	| { type: 'complete'; matched: number; total: number }
	| { type: 'error'; message: string }

function ndjson(e: EnrichEvent): string {
	return `${JSON.stringify(e)}\n`
}

const BATCH = 100

export async function POST() {
	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			const write = (e: EnrichEvent) => controller.enqueue(encoder.encode(ndjson(e)))
			try {
				const recalboxId = await getActiveRecalboxId()
				if (!recalboxId) {
					write({ type: 'error', message: 'No Recalbox configured' })
					return
				}
				const allUnchecked = listUncheckedGames(10_000, recalboxId)
				write({ type: 'start', total: allUnchecked.length })
				let done = 0
				let matched = 0

				for (let i = 0; i < allUnchecked.length; i += BATCH) {
					const batch = allUnchecked.slice(i, i + BATCH)
					const slugEntries: Array<{ romPath: string; slug: string }> = []

					for (const game of batch) {
						const variants = gameToSlugVariants(game.name, game.system)
						if (variants[0]) {
							slugEntries.push({ romPath: game.romPath, slug: variants[0] })
						}
					}

					const slugs = slugEntries.map((e) => e.slug)
					const results = await srClient.bulkLookup(slugs)

					for (const entry of slugEntries) {
						const result = results[entry.slug] ?? { exists: false }
						updateGameSrInfo(
							recalboxId,
							entry.romPath,
							entry.slug,
							result.exists,
							result.url ?? null,
						)
						if (result.exists) matched++
					}

					done += batch.length
					write({ type: 'progress', done, total: allUnchecked.length })
				}

				write({ type: 'complete', matched, total: allUnchecked.length })
			} catch (err) {
				write({ type: 'error', message: err instanceof Error ? err.message : String(err) })
			} finally {
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
