import { mkdtemp, type readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAgentPayload } from '@/lib/agent/payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Module-level counter for tracking VERSION file reads in the memoisation test
let versionReadCountForMemoisationTest = 0
let memoisationTestActive = false

type ReadFileParams = Parameters<typeof readFile>

vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
	return {
		...actual,
		readFile: vi.fn(async (filePath: ReadFileParams[0], encoding?: ReadFileParams[1]) => {
			// Only apply special mock behavior when the memoisation test is active
			if (memoisationTestActive && typeof filePath === 'string' && filePath.endsWith('VERSION')) {
				versionReadCountForMemoisationTest++
				// Return 1.0.0 on first read, 9.9.9 on second (to prove second call doesn't read)
				if (versionReadCountForMemoisationTest === 1) return '1.0.0\n'
				return '9.9.9\n'
			}
			// For all other cases, use actual implementation
			return actual.readFile(filePath, encoding)
		}),
	}
})

describe('readAgentPayload', () => {
	it('lit les deux fichiers Python de l agent', async () => {
		const payload = await readAgentPayload()
		// Marqueurs stables : présents dans agent.py et scan_roms.py depuis leur création.
		expect(payload.agentPy).toContain('CONFIG_PATH')
		expect(payload.scanRomsPy.length).toBeGreaterThan(1000)
	})

	it('lit la version et la débarrasse des espaces', async () => {
		const payload = await readAgentPayload()
		expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/)
	})
})

describe('readAgentVersion', () => {
	const requiredFiles = ['scan_roms.py', 'launch.py', 'sr-agent[systembrowsing].sh', 'VERSION']

	afterEach(() => {
		versionReadCountForMemoisationTest = 0
		memoisationTestActive = false
	})

	async function makeAgentDir(prefix: string): Promise<string> {
		const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
		for (const filename of requiredFiles) {
			await writeFile(path.join(dir, filename), `# ${filename} placeholder\n`, 'utf-8')
		}
		return dir
	}

	it('injected dirs bypass cache and return their own values', async () => {
		const dirsA = await makeAgentDir('agent-version-a-')
		const dirsB = await makeAgentDir('agent-version-b-')
		try {
			await writeFile(path.join(dirsA, 'VERSION'), '1.0.0\n', 'utf-8')
			await writeFile(path.join(dirsB, 'VERSION'), '2.0.0\n', 'utf-8')

			// Import freshly to avoid cache
			const { readAgentVersion } = await import('@/lib/agent/payload')

			const versionA = await readAgentVersion({ sourceDir: dirsA, payloadDir: dirsA })
			const versionB = await readAgentVersion({ sourceDir: dirsB, payloadDir: dirsB })

			expect(versionA).toBe('1.0.0')
			expect(versionB).toBe('2.0.0')
		} finally {
			await rm(dirsA, { recursive: true, force: true })
			await rm(dirsB, { recursive: true, force: true })
		}
	})

	it('no-argument calls memoise and cache the version', async () => {
		// Reset modules to get a fresh cache for this test
		vi.resetModules()
		versionReadCountForMemoisationTest = 0
		memoisationTestActive = true

		// Import the mocked fs/promises and the fresh payload module
		await import('node:fs/promises')
		const { readAgentVersion: freshReadAgentVersion } = await import('@/lib/agent/payload')

		// First call with no arguments: should read and cache 1.0.0
		const version1 = await freshReadAgentVersion()
		expect(version1).toBe('1.0.0')
		expect(versionReadCountForMemoisationTest).toBe(1)

		// Second call with no arguments: should return cached 1.0.0, not read again
		const version2 = await freshReadAgentVersion()
		expect(version2).toBe('1.0.0')
		// If memoisation works, versionReadCount should still be 1 (readFile was not called)
		expect(versionReadCountForMemoisationTest).toBe(1)
	})
})

describe('readAgentPayload (legacy tests)', () => {
	describe('résolution source vs copie (répertoires injectés, jamais les vrais agent/ ou agent-payload/)', () => {
		// Les deux tests ci-dessous pointent `readAgentPayload()` vers des
		// répertoires temporaires qu'ils créent et détruisent eux-mêmes, plutôt
		// que de renommer `agent/` (suivi par git) ou `agent-payload/` réels. Si
		// le process de test est tué entre les deux étapes d'un rename (Ctrl-C,
		// abort de l'IDE, OOM kill — réaliste sur une machine où `pnpm dev` et
		// `vitest` tournent en parallèle), l'ancienne version laissait `agent/`
		// disparu de l'arbre de travail avec une `agent.test-backup/` à côté.
		// Cette version ne touche plus aucun chemin suivi par git.

		const requiredFiles = [
			'scan_roms.py',
			'launch.py',
			'updater.py',
			'sr-agent[systembrowsing].sh',
			'VERSION',
		]

		async function makeAgentDir(prefix: string, agentPyContent: string) {
			const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
			await writeFile(path.join(dir, 'agent.py'), agentPyContent, 'utf-8')
			for (const filename of requiredFiles) {
				await writeFile(path.join(dir, filename), `# ${filename} placeholder\n`, 'utf-8')
			}
			// La version doit matcher /^\d+\.\d+\.\d+$/ une fois trim()ée.
			await writeFile(path.join(dir, 'VERSION'), '9.9.9\n', 'utf-8')
			return dir
		}

		describe('quand la source et la copie existent toutes les deux et diffèrent', () => {
			// Le bug corrigé ici : `agent-payload/` n'est rafraîchi QUE par `prebuild`, donc
			// sous `next dev` il peut contenir une copie arbitrairement ancienne pendant que
			// `agent/` — la source, à la racine du monorepo — a continué d'évoluer. La
			// priorité DOIT aller à la source : ce test place un contenu distinguable dans
			// le répertoire "copie" et vérifie que `readAgentPayload()` renvoie quand même
			// le contenu du répertoire "source". Si la priorité est inversée en arrière
			// (copie avant source), ce test échoue.
			let sourceDir: string
			let payloadDir: string

			beforeEach(async () => {
				sourceDir = await makeAgentDir('agent-source-', '# SOURCE MARKER\nCONFIG_PATH = "/tmp"\n')
				payloadDir = await makeAgentDir(
					'agent-payload-',
					'# STALE PAYLOAD MARKER — ne doit jamais être lu\n',
				)
			})

			afterEach(async () => {
				await rm(sourceDir, { recursive: true, force: true })
				await rm(payloadDir, { recursive: true, force: true })
			})

			it('la source gagne, pas la copie', async () => {
				const payload = await readAgentPayload({ sourceDir, payloadDir })
				expect(payload.agentPy).not.toContain('STALE PAYLOAD MARKER')
				expect(payload.agentPy).toContain('SOURCE MARKER')
			})
		})

		describe('quand la source est absente — build standalone Vercel / runtime Docker', () => {
			// `agent/` n'est jamais présent au runtime standalone (Turbopack ne trace pas en
			// dehors de `apps/dashboard/`, et le stage runner du Dockerfile ne copie jamais
			// `agent/`) : c'est le chemin de prod. Ce test pointe `sourceDir` vers un chemin
			// qui n'existe pas, pour forcer le code applicatif à emprunter le repli ENOENT
			// vers le répertoire "copie" — sans ce repli, `readAgentPayload()` rejette et le
			// test échoue. C'est le chemin de production et il ne doit pas régresser.
			let sourceDir: string
			let payloadDir: string

			beforeEach(async () => {
				// Un chemin plausible mais jamais créé : garantit l'ENOENT sans toucher
				// à un répertoire réel.
				sourceDir = path.join(os.tmpdir(), `agent-source-absent-${process.pid}-${Date.now()}`)
				payloadDir = await makeAgentDir(
					'agent-payload-',
					'# PAYLOAD MARKER\nCONFIG_PATH = "/tmp"\n',
				)
			})

			afterEach(async () => {
				await rm(payloadDir, { recursive: true, force: true })
			})

			it('retombe sur le répertoire copie', async () => {
				const payload = await readAgentPayload({ sourceDir, payloadDir })
				expect(payload.agentPy).toContain('PAYLOAD MARKER')
				expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/)
			})
		})
	})
})
