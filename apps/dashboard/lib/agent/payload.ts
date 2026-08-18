import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type AgentPayload = {
	agentPy: string
	scanRomsPy: string
	version: string
}

/**
 * Dossier contenant une copie des fichiers de l'agent, à l'intérieur de
 * `apps/dashboard` (le cwd du serveur Next) — PAS `agent/` à la racine du
 * monorepo directement.
 *
 * `outputFileTracingIncludes` avec un glob `../../agent/*` (en dehors de
 * `apps/dashboard`) ne fonctionne pas sous Turbopack, le bundler par défaut de
 * `next build` en Next 16 : vérifié empiriquement, voir le commentaire dans
 * next.config.ts. Le script `scripts/copy-agent-payload.mjs`, lancé en
 * `prebuild`, copie donc `agent/{agent.py,scan_roms.py,VERSION}` ici avant que
 * `next build` ne s'exécute. Toucher l'un de ces trois éléments (script,
 * `outputFileTracingIncludes`, ce chemin) sans les autres casse la production
 * sans casser le local.
 *
 * Le nom du dossier ne doit PAS commencer par un point : le traceur de
 * Turbopack ignore silencieusement les dossiers cachés (`.agent-payload`, testé,
 * ne trace jamais rien à l'intérieur) même avec `outputFileTracingRoot` élargi.
 */
function primaryAgentDir(): string {
	return path.resolve(process.cwd(), 'agent-payload')
}

/**
 * `agent/` à la racine du monorepo — la source, pas une copie. Toujours
 * présent sur un clone frais, contrairement à `primaryAgentDir()` qui dépend
 * du script `prebuild`.
 *
 * `prebuild` ne se déclenche que pour `pnpm run build` (ou l'alias `pnpm
 * build`) : ni `pnpm dev` (le flux de premier démarrage documenté dans
 * CLAUDE.md est `pnpm install` → `pnpm dev`, sans build), ni `pnpm exec
 * vitest ...` (les hooks de cycle de vie pre/post de pnpm ne se déclenchent
 * que pour `pnpm run <script>`, jamais pour `pnpm exec <bin>` — la commande
 * que CLAUDE.md documente pour lancer un seul fichier de test). Sans ce
 * repli, un clone frais suivant exactement le flux documenté échoue avec
 * ENOENT avant même d'avoir touché à la route de téléchargement — soit
 * exactement le piège que cette tâche existe pour éviter, déplacé du build
 * de prod vers le dev/test.
 */
function fallbackAgentDir(): string {
	return path.resolve(process.cwd(), '..', '..', 'agent')
}

async function readAgentFile(filename: string): Promise<string> {
	try {
		return await readFile(path.join(primaryAgentDir(), filename), 'utf-8')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw err
		}
		return readFile(path.join(fallbackAgentDir(), filename), 'utf-8')
	}
}

export async function readAgentPayload(): Promise<AgentPayload> {
	const [agentPy, scanRomsPy, version] = await Promise.all([
		readAgentFile('agent.py'),
		readAgentFile('scan_roms.py'),
		readAgentFile('VERSION'),
	])
	return { agentPy, scanRomsPy, version: version.trim() }
}
