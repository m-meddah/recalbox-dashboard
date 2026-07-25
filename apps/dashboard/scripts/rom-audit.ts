#!/usr/bin/env tsx

/**
 * Audite un manifeste de scan contre le catalogue de référence d'un système.
 *
 * Le manifeste est un tableau JSON d'entrées conformes à lib/rom-audit/manifest.ts.
 * Le scan on-box qui le produit arrive au plan 2 ; en attendant, on le fabrique
 * à la main pour valider le noyau sur des données réelles.
 *
 * Usage:
 *   tsx scripts/rom-audit.ts --system=snes --manifest=./manifest.json
 *   tsx scripts/rom-audit.ts --system=snes --manifest=./manifest.json --missing --region=Europe
 */

import { readFileSync } from 'node:fs'
import { loadDatForSystem } from '@/lib/rom-audit/catalog'
import { parseManifest } from '@/lib/rom-audit/manifest'
import { auditSystem, filterMissingGames } from '@/lib/rom-audit/match'
import { ZodError } from 'zod'

function arg(name: string): string | undefined {
	return process.argv
		.find((a) => a.startsWith(`--${name}=`))
		?.split('=')
		.slice(1)
		.join('=')
}

async function main() {
	const system = arg('system')
	const manifestPath = arg('manifest')
	if (!system || !manifestPath) {
		console.error('Usage: tsx scripts/rom-audit.ts --system=<id> --manifest=<path.json>')
		process.exit(1)
	}

	const dat = await loadDatForSystem(system)
	if (!dat) {
		console.error(`Aucun catalogue de référence pour le système "${system}".`)
		process.exit(1)
	}

	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
	} catch (err) {
		const reason = err instanceof SyntaxError ? `JSON invalide — ${err.message}` : String(err)
		console.error(`Manifeste illisible (${manifestPath}) : ${reason}`)
		process.exit(1)
	}

	let manifest: ReturnType<typeof parseManifest>
	try {
		manifest = parseManifest(raw)
	} catch (err) {
		console.error(`Manifeste rejeté par la validation (${manifestPath}) :`)
		if (err instanceof ZodError) {
			for (const issue of err.issues) {
				console.error(`  [${issue.path.join('.') || '<racine>'}] ${issue.message}`)
			}
		} else {
			console.error(`  ${String(err)}`)
		}
		process.exit(1)
	}

	const result = auditSystem(system, manifest, dat)

	const pct = result.totalRomEntries
		? ((result.matchedRomEntries / result.totalRomEntries) * 100).toFixed(2)
		: '0.00'

	console.log(`${result.datName} — dat ${result.datVersion}`)
	console.log(`ROMs scannées   : ${result.files.length}`)
	console.log(`Entrées DAT     : ${result.totalRomEntries}`)
	console.log(`Entrées matchées: ${result.matchedRomEntries} (${pct} %)`)

	const byLevel = new Map<string, number>()
	for (const f of result.files) byLevel.set(f.matchLevel, (byLevel.get(f.matchLevel) ?? 0) + 1)
	for (const [level, count] of byLevel) console.log(`  ${level.padEnd(9)} ${count}`)

	console.log(`Jeux au catalogue: ${result.games.length}`)
	console.log(`Jeux manquants   : ${result.missingGames.length}`)

	if (process.argv.includes('--missing')) {
		const region = arg('region')
		const missing = filterMissingGames(result.missingGames, {
			regions: region ? [region] : undefined,
		})
		console.log(`\n--- ${missing.length} jeux manquants ---`)
		for (const game of missing) console.log(game.title)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
