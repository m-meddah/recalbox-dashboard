#!/usr/bin/env node

/**
 * Copies the on-box agent's source files into `apps/dashboard/agent-payload/`
 * before `next build` runs (wired as the `prebuild` script).
 *
 * Why this exists: `agent/` lives at the monorepo root, outside the directory
 * tree Next.js traces for its `standalone` output. Declaring those files via
 * `outputFileTracingIncludes` with a `../../agent/*` glob does NOT work under
 * Turbopack (the default `next build` bundler in Next 16) — verified
 * empirically: a marker file placed inside `apps/dashboard/` was copied into
 * `.next/standalone`, an equivalent file reached only via `../../` from
 * `apps/dashboard/` never was, regardless of `outputFileTracingRoot`.
 *
 * Copying the files into `apps/dashboard/agent-payload/` first puts them
 * INSIDE the traced tree, where `outputFileTracingIncludes` does work — but
 * only for a target directory name that does NOT start with a dot: a
 * `.agent-payload/` directory (also tested) was silently never traced by
 * Turbopack even with the exact same include globs, `outputFileTracingRoot`,
 * and `dot: true` semantics elsewhere in the tracer. See the comment above
 * `outputFileTracingIncludes` in `next.config.ts` and `lib/agent/payload.ts`'s
 * `agentDir()` — all three must move together.
 *
 * Plain dependency-free Node (not tsx) so it runs unmodified as an npm
 * lifecycle script in CI/Docker without pulling in the dev toolchain.
 */

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentDir = path.resolve(here, '..', '..', '..', 'agent')
const targetDir = path.resolve(here, '..', 'agent-payload')

const FILES = [
	'agent.py',
	'scan_roms.py',
	'launch.py',
	'updater.py',
	'sr-agent[systembrowsing].sh',
	'VERSION',
]

async function main() {
	await mkdir(targetDir, { recursive: true })
	await Promise.all(
		FILES.map((file) => copyFile(path.join(agentDir, file), path.join(targetDir, file))),
	)
	// Le seul moyen de repérer un payload devenu figé, c'est de savoir CE QUI a
	// été copié à CE build : taille par fichier (un octet-count qui ne bouge
	// jamais d'un build à l'autre malgré des commits sur `agent/` est le signal
	// d'une source qui ne pointe plus au bon endroit) et la VERSION elle-même,
	// puisqu'un payload figé fige aussi le numéro de version affiché aux users.
	const sizes = await Promise.all(
		FILES.map(async (file) => {
			const { size } = await stat(path.join(targetDir, file))
			return `${file} (${size}o)`
		}),
	)
	const version = (await readFile(path.join(targetDir, 'VERSION'), 'utf-8')).trim()
	console.log(
		`copy-agent-payload: copied ${FILES.length} files to ${path.relative(process.cwd(), targetDir)} — version ${version} — ${sizes.join(', ')}`,
	)
}

main().catch((err) => {
	console.error('copy-agent-payload: failed to copy the agent payload', err)
	process.exit(1)
})
