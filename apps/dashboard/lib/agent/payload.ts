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
 * personne ne relance un build. Lire la source en premier élimine ce piège en
 * dev comme sur un serveur classique où `agent/` reste présent à côté de
 * `apps/dashboard/` au runtime.
 *
 * L'image Docker n'est PAS ce cas : `Dockerfile` fait `COPY agent/ ./agent/`
 * dans le stage builder (pour que `prebuild` puisse générer `agent-payload/`
 * pendant `pnpm build`), mais le stage runner qui tourne réellement ne copie
 * jamais `agent/` — seul `.next/standalone` en sort. Au runtime Docker,
 * `sourceAgentDir()` est donc toujours absent et chaque lecture retombe sur
 * `payloadAgentDir()` ; sa fraîcheur vient de `prebuild` qui régénère cette
 * copie à chaque build d'image, pas d'une lecture de la source en direct.
 * Bind-monter ou éditer `agent/` dans un conteneur en cours d'exécution n'a
 * donc aucun effet.
 */
export function sourceAgentDir(): string {
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
export function payloadAgentDir(): string {
	return path.resolve(process.cwd(), 'agent-payload')
}

/**
 * Dossiers à utiliser pour une lecture — les résolveurs réels par défaut.
 * Injectable pour les tests : voir `__tests__/payload.test.ts`, qui pointe
 * ces deux entrées vers des répertoires temporaires plutôt que de manipuler
 * `agent/` (suivi par git) ou `agent-payload/` réels.
 */
export type AgentPayloadDirs = {
	sourceDir: string
	payloadDir: string
}

function defaultDirs(): AgentPayloadDirs {
	return { sourceDir: sourceAgentDir(), payloadDir: payloadAgentDir() }
}

// Un seul warning par process, pas un par requête : le repli lui-même est
// normal et attendu (c'est le chemin de prod sur Vercel) — ce qui doit rester
// visible, c'est QUEL dossier a servi les fichiers, pour repérer d'un coup
// d'œil dans les logs un déploiement qui tournerait sur une copie figée.
let loggedFallback = false

async function readAgentFile(filename: string, dirs: AgentPayloadDirs): Promise<string> {
	try {
		return await readFile(path.join(dirs.sourceDir, filename), 'utf-8')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw err
		}
		if (!loggedFallback) {
			loggedFallback = true
			logger.warn(
				`[agent-payload] ${dirs.sourceDir} absent, repli sur ${dirs.payloadDir} (copie figée au dernier build)`,
			)
		}
		return readFile(path.join(dirs.payloadDir, filename), 'utf-8')
	}
}

export async function readAgentPayload(
	dirs: AgentPayloadDirs = defaultDirs(),
): Promise<AgentPayload> {
	const [agentPy, scanRomsPy, launchPy, launcherSh, version] = await Promise.all([
		readAgentFile('agent.py', dirs),
		readAgentFile('scan_roms.py', dirs),
		readAgentFile('launch.py', dirs),
		readAgentFile('sr-agent[systembrowsing].sh', dirs),
		readAgentFile('VERSION', dirs),
	])
	return { agentPy, scanRomsPy, launchPy, launcherSh, version: version.trim() }
}
