import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '@/lib/logger'

export type AgentPayload = {
	agentPy: string
	scanRomsPy: string
	launchPy: string
	launcherSh: string
	version: string
}

/**
 * `agent/` à la racine du monorepo — la SOURCE, toujours à jour. Priorité n°1 :
 * un clone frais et `next dev` l'ont en permanence, contrairement à
 * `payloadAgentDir()` qui est une simple copie figée au dernier `pnpm build`.
 *
 * Sous `next dev`, `prebuild` ne tourne jamais (seul `pnpm run build`/`pnpm
 * build` le déclenche), donc `agent-payload/` peut dater d'un build précédent
 * — potentiellement très ancien — et rester silencieusement obsolète tant que
 * personne ne relance un build. Lire la source en premier élimine ce piège :
 * en dev comme sur un serveur classique où `agent/` est présent aux côtés de
 * `apps/dashboard/` (ex. l'image Docker, qui fait `COPY agent/ ./agent/`),
 * chaque lecture reflète le fichier réellement sur le disque.
 */
function sourceAgentDir(): string {
	return path.resolve(process.cwd(), '..', '..', 'agent')
}

/**
 * Dossier contenant une copie des fichiers de l'agent, à l'intérieur de
 * `apps/dashboard` (le cwd du serveur Next) — PAS `agent/` à la racine du
 * monorepo directement. Repli, utilisé seulement quand `sourceAgentDir()`
 * n'existe pas.
 *
 * `outputFileTracingIncludes` avec un glob `../../agent/*` (en dehors de
 * `apps/dashboard`) ne fonctionne pas sous Turbopack, le bundler par défaut de
 * `next build` en Next 16 : vérifié empiriquement, voir le commentaire dans
 * next.config.ts. Le build standalone (déploiement Vercel) ne contient donc
 * PAS `agent/` — seul ce dossier existe alors. Le script
 * `scripts/copy-agent-payload.mjs`, lancé en `prebuild`, copie donc
 * `agent/{agent.py,scan_roms.py,VERSION,...}` ici avant que `next build` ne
 * s'exécute, pour que le build embarque une copie fraîche au moment du build.
 * Les trois listes de fichiers (ici, le script, et `next.config.ts`) doivent
 * rester synchronisées.
 *
 * Le nom du dossier ne doit PAS commencer par un point : le traceur de
 * Turbopack ignore silencieusement les dossiers cachés (`.agent-payload`, testé,
 * ne trace jamais rien à l'intérieur) même avec `outputFileTracingRoot` élargi.
 */
function payloadAgentDir(): string {
	return path.resolve(process.cwd(), 'agent-payload')
}

// Un seul warning par process, pas un par requête : le repli lui-même est
// normal et attendu (c'est le chemin de prod sur Vercel) — ce qui doit rester
// visible, c'est QUEL dossier a servi les fichiers, pour repérer d'un coup
// d'œil dans les logs un déploiement qui tournerait sur une copie figée.
let loggedFallback = false

async function readAgentFile(filename: string): Promise<string> {
	try {
		return await readFile(path.join(sourceAgentDir(), filename), 'utf-8')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw err
		}
		if (!loggedFallback) {
			loggedFallback = true
			logger.warn(
				`[agent-payload] ${sourceAgentDir()} absent, repli sur ${payloadAgentDir()} (copie figée au dernier build)`,
			)
		}
		return readFile(path.join(payloadAgentDir(), filename), 'utf-8')
	}
}

export async function readAgentPayload(): Promise<AgentPayload> {
	const [agentPy, scanRomsPy, launchPy, launcherSh, version] = await Promise.all([
		readAgentFile('agent.py'),
		readAgentFile('scan_roms.py'),
		readAgentFile('launch.py'),
		readAgentFile('sr-agent[systembrowsing].sh'),
		readAgentFile('VERSION'),
	])
	return { agentPy, scanRomsPy, launchPy, launcherSh, version: version.trim() }
}
