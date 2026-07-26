#!/usr/bin/env tsx

/**
 * Audite une collection de ROMs contre le catalogue de référence d'un système.
 *
 * Deux modes, exclusifs :
 *
 *   --scan       scanne une vraie Recalbox par SSH et audite ce qu'il trouve
 *   --manifest   audite un manifeste JSON déjà produit, sans toucher à la box
 *
 * Usage:
 *   tsx scripts/rom-audit.ts --scan --system=snes
 *   tsx scripts/rom-audit.ts --scan --system=psx --json=/tmp/scan-psx.json
 *   tsx scripts/rom-audit.ts --system=snes --manifest=/tmp/manifest.json
 *   tsx scripts/rom-audit.ts --system=snes --manifest=/tmp/manifest.json --missing --region=Europe
 *
 * Les paramètres de connexion viennent de .env.local (RECALBOX_HOST,
 * RECALBOX_SSH_USER, RECALBOX_SSH_PASSWORD), surchargeables par --host,
 * --user et --password. Ce script délibérément **ne passe pas** par le
 * configStore de l'application : celui-ci lit la base, et cet outil doit
 * rester utilisable quand la base est indisponible.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { loadDatForSystem } from '@/lib/rom-audit/catalog'
import { type ManifestEntry, parseManifest } from '@/lib/rom-audit/manifest'
import { auditSystem, filterMissingGames } from '@/lib/rom-audit/match'
import { runScan } from '@/lib/rom-audit/scan-runner'
import { type ScanTarget, buildScanTargets, romsRootFor } from '@/lib/rom-audit/scan-targets'
import { NodeSSH } from 'node-ssh'
import { ZodError } from 'zod'

function arg(name: string): string | undefined {
	return process.argv
		.find((a) => a.startsWith(`--${name}=`))
		?.split('=')
		.slice(1)
		.join('=')
}

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

/** Progress goes to stderr so stdout stays pipeable. */
function progress(message: string): void {
	console.error(message)
}

/** .env.local is not auto-loaded outside Next.js, and this script runs under tsx. */
function loadEnvLocal(): Record<string, string> {
	const file = path.resolve(__dirname, '../.env.local')
	if (!existsSync(file)) return {}
	const env: Record<string, string> = {}
	for (const line of readFileSync(file, 'utf-8').split('\n')) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
		if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^"|"$/g, '')
	}
	return env
}

async function connect() {
	const env = loadEnvLocal()
	const host = arg('host') ?? env.RECALBOX_HOST
	const username = arg('user') ?? env.RECALBOX_SSH_USER
	const password = arg('password') ?? env.RECALBOX_SSH_PASSWORD
	if (!host || !username || !password) {
		fail(
			'Connexion incomplète. Renseigne RECALBOX_HOST, RECALBOX_SSH_USER et\n' +
				'RECALBOX_SSH_PASSWORD dans .env.local, ou passe --host, --user et --password.',
		)
	}

	const ssh = new NodeSSH()
	try {
		await ssh.connect({ host, username, password, readyTimeout: 10000 })
	} catch (err) {
		fail(`Recalbox injoignable sur "${host}" : ${String(err)}`)
	}
	progress(`connecté à ${host}`)

	// Le script de scan voyage sur le stdin de l'exec : une ligne de commande de
	// 21 Ko fait échouer l'exec SSH, et une de 32 Ko coupe la connexion.
	const client = {
		exec: async (
			cmd: string,
			options?: { stdin?: string; timeoutMs?: number },
		): Promise<string> => {
			const res = await ssh.execCommand(cmd, {
				stdin: options?.stdin,
				execOptions: { timeout: options?.timeoutMs },
			})
			if (res.code !== 0 && !res.stdout) {
				throw new Error(res.stderr.trim() || `exit ${res.code}`)
			}
			return res.stdout
		},
	}
	return { ssh, client, host }
}

/** Lists the system directories of every share, then keeps the ones asked for. */
async function discoverTargets(
	client: {
		exec: (cmd: string, options?: { stdin?: string; timeoutMs?: number }) => Promise<string>
	},
	host: string,
	system: string,
): Promise<ScanTarget[]> {
	const mounts = await fetchStorageInfo(host)
	if (mounts.length === 0) {
		fail(`Aucun support partagé remonté par le Web Manager de "${host}".`)
	}
	progress(`supports : ${mounts.map((m) => m.mount).join(', ')}`)

	const dirsByRoot: Record<string, string[]> = {}
	for (const { mount } of mounts) {
		const root = romsRootFor(mount)
		const out = await client.exec(`ls -1 ${JSON.stringify(root)} 2>/dev/null || true`)
		dirsByRoot[root] = out
			.split('\n')
			.map((d) => d.trim())
			.filter(Boolean)
	}

	const all = buildScanTargets(mounts, dirsByRoot)
	const targets = all.filter((t) => t.system === system)
	if (targets.length === 0) {
		const available = [...new Set(all.map((t) => t.system))].sort()
		fail(
			`Le système "${system}" n'existe sur aucun support.\n` +
				`Systèmes trouvés (${available.length}) : ${available.join(', ')}`,
		)
	}
	progress(`cibles pour "${system}" : ${targets.map((t) => t.romsPath).join(', ')}`)
	return targets
}

async function scanMode(system: string): Promise<ManifestEntry[]> {
	const { ssh, client, host } = await connect()
	try {
		const targets = await discoverTargets(client, host, system)
		progress('scan en cours, cela peut prendre plusieurs minutes...')
		const started = Date.now()
		const outcome = await runScan(client, targets)
		if (outcome.status === 'failed') fail(`Scan en échec : ${outcome.reason}`)

		const seconds = ((Date.now() - started) / 1000).toFixed(1)
		progress(`scan terminé en ${seconds} s — ${outcome.entries.length} entrées`)
		const counters = Object.entries(outcome.stats)
			.map(([k, v]) => `${k}=${v}`)
			.join(' ')
		if (counters) progress(`compteurs : ${counters}`)
		return outcome.entries
	} finally {
		ssh.dispose()
	}
}

function manifestMode(manifestPath: string): ManifestEntry[] {
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
	} catch (err) {
		const reason = err instanceof SyntaxError ? `JSON invalide — ${err.message}` : String(err)
		fail(`Manifeste illisible (${manifestPath}) : ${reason}`)
	}

	try {
		return parseManifest(raw)
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
}

async function main() {
	const system = arg('system')
	const manifestPath = arg('manifest')
	const wantScan = process.argv.includes('--scan')

	if (!system || (!manifestPath && !wantScan)) {
		fail(
			'Usage:\n' +
				'  tsx scripts/rom-audit.ts --scan --system=<id> [--json=<path>]\n' +
				'  tsx scripts/rom-audit.ts --system=<id> --manifest=<path.json>\n' +
				'Options : --missing --region=<region> --host= --user= --password=',
		)
	}
	if (manifestPath && wantScan) {
		fail(
			'--scan et --manifest sont exclusifs : choisis de scanner la box, ou de relire un manifeste.',
		)
	}

	const catalog = await loadDatForSystem(system)
	if (catalog.status === 'no-catalog') {
		fail(`Aucun catalogue de référence pour le système "${system}".`)
	}
	if (catalog.status === 'unavailable') {
		fail(
			`Catalogue de référence indisponible pour "${system}" : téléchargement impossible et rien en cache.`,
		)
	}
	const dat = catalog.dat

	const manifest = wantScan ? await scanMode(system) : manifestMode(manifestPath as string)

	const jsonOut = arg('json')
	if (jsonOut) {
		writeFileSync(jsonOut, JSON.stringify(manifest, null, '\t'), 'utf-8')
		progress(`manifeste écrit dans ${jsonOut}`)
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
