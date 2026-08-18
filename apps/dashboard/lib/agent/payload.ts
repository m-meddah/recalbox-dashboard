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
function agentDir(): string {
	return path.resolve(process.cwd(), 'agent-payload')
}

export async function readAgentPayload(): Promise<AgentPayload> {
	const [agentPy, scanRomsPy, version] = await Promise.all([
		readFile(path.join(agentDir(), 'agent.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'scan_roms.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'VERSION'), 'utf-8'),
	])
	return { agentPy, scanRomsPy, version: version.trim() }
}
