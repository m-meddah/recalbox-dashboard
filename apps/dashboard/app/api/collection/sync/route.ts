import { upsertGames } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { parseGamelist } from '@/lib/recalbox/gamelist-parser'
import { readGamelist, readUserdataIni } from '@/lib/recalbox/gamelist-reader'
import { invalidateSystemsCache, listSystems } from '@/lib/recalbox/systems'
import { parseUserdataIni } from '@/lib/recalbox/userdata-parser'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SyncEvent =
	| { type: 'start'; totalSystems: number }
	| {
			type: 'system'
			system: string
			status: 'reading' | 'parsing' | 'done' | 'skipped'
			count?: number
	  }
	| { type: 'done'; totalGames: number; durationMs: number }
	| { type: 'error'; message: string }

function ndjson(event: SyncEvent): string {
	return JSON.stringify(event) + '\n'
}

/**
 * POST /api/collection/sync
 * Streams NDJSON progress events while importing gamelist.xml files via SSH.
 * Query param: ?system=snes to sync only one system.
 */
export async function POST(req: NextRequest) {
	const targetSystem = req.nextUrl.searchParams.get('system') ?? undefined

	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			const write = (event: SyncEvent) => controller.enqueue(encoder.encode(ndjson(event)))

			const t0 = Date.now()
			let totalGames = 0

			try {
				invalidateSystemsCache()
				const allSystems = await listSystems()
				const systems = targetSystem ? allSystems.filter((s) => s.id === targetSystem) : allSystems

				write({ type: 'start', totalSystems: systems.length })

				for (const system of systems) {
					write({ type: 'system', system: system.id, status: 'reading' })

					const xml = await readGamelist(system.gamelistPath)
					if (!xml) {
						write({ type: 'system', system: system.id, status: 'skipped' })
						continue
					}

					write({ type: 'system', system: system.id, status: 'parsing' })
					const parsed = parseGamelist(xml, system.romsBasePath)

					// Merge userdata.ini: real favorite / hidden / play stats override XML values
					const userdataRaw = await readUserdataIni(system.romsBasePath)
					if (userdataRaw) {
						const userdata = parseUserdataIni(userdataRaw)
						for (const game of parsed) {
							const ud = userdata.get(game.relativeRomPath)
							if (!ud) continue
							if (ud.favorite !== undefined) game.favorite = ud.favorite
							if (ud.hidden !== undefined) game.hidden = ud.hidden
							if (ud.playCount !== undefined) game.playCount = ud.playCount
							if (ud.lastPlayed !== undefined) game.lastPlayed = ud.lastPlayed
						}
					}

					const inserted = await upsertGames(parsed, system.id, system.diskSource)
					totalGames += inserted

					write({ type: 'system', system: system.id, status: 'done', count: inserted })
					logger.info(`sync: ${system.id} → ${inserted} games`)
				}

				write({ type: 'done', totalGames, durationMs: Date.now() - t0 })
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				logger.error('sync: fatal error', err)
				write({ type: 'error', message })
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
