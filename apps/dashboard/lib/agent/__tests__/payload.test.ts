import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readAgentPayload } from '@/lib/agent/payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

	describe('quand agent/ (source) et agent-payload/ (copie) existent tous les deux et diffèrent', () => {
		// Le bug corrigé ici : `agent-payload/` n'est rafraîchi QUE par `prebuild`, donc
		// sous `next dev` il peut contenir une copie arbitrairement ancienne pendant que
		// `agent/` — la source, à la racine du monorepo — a continué d'évoluer. La
		// priorité DOIT aller à la source : ce test place un contenu distinguable dans
		// `agent-payload/agent.py` et vérifie que `readAgentPayload()` renvoie quand même
		// le contenu de `agent/agent.py`, pas celui de la copie. Si la priorité est
		// inversée en arrière (copie avant source), ce test échoue.
		const payloadDir = path.resolve(process.cwd(), 'agent-payload')
		const agentPyPath = path.join(payloadDir, 'agent.py')
		const backupPath = path.join(payloadDir, 'agent.py.test-backup')
		let createdDir = false
		let backedUpFile = false

		beforeEach(async () => {
			createdDir = !existsSync(payloadDir)
			await mkdir(payloadDir, { recursive: true })
			backedUpFile = existsSync(agentPyPath)
			if (backedUpFile) {
				await rename(agentPyPath, backupPath)
			}
			await writeFile(agentPyPath, '# STALE PAYLOAD MARKER — ne doit jamais être lu\n', 'utf-8')
		})

		afterEach(async () => {
			if (backedUpFile) {
				await rename(backupPath, agentPyPath)
			} else {
				await rm(agentPyPath, { force: true })
			}
			if (createdDir) {
				await rm(payloadDir, { recursive: true, force: true })
			}
		})

		it('la source (agent/) gagne, pas la copie (agent-payload/)', async () => {
			const payload = await readAgentPayload()
			expect(payload.agentPy).not.toContain('STALE PAYLOAD MARKER')
			expect(payload.agentPy).toContain('CONFIG_PATH')
		})
	})

	describe('quand agent/ (source) est absent — build standalone Vercel', () => {
		// `agent/` n'est jamais présent dans le bundle standalone (Turbopack ne trace
		// pas en dehors de `apps/dashboard/`) : c'est le chemin de prod sur Vercel. Ce
		// test simule l'absence de la source en déplaçant temporairement `agent/` pour
		// forcer le code applicatif à emprunter le repli ENOENT vers `agent-payload/` —
		// sans ce repli, `readAgentPayload()` rejette et le test échoue. C'est le chemin
		// de production et il ne doit pas régresser.
		const sourceDir = path.resolve(process.cwd(), '..', '..', 'agent')
		const movedAsideDir = path.resolve(process.cwd(), '..', '..', 'agent.test-backup')
		let movedAside = false

		beforeEach(async () => {
			movedAside = existsSync(sourceDir)
			if (movedAside) {
				await rename(sourceDir, movedAsideDir)
			}
		})

		afterEach(async () => {
			if (movedAside) {
				await rename(movedAsideDir, sourceDir)
			}
		})

		it('retombe sur agent-payload/', async () => {
			expect(existsSync(sourceDir)).toBe(false)
			const payload = await readAgentPayload()
			expect(payload.agentPy).toContain('CONFIG_PATH')
			expect(payload.scanRomsPy.length).toBeGreaterThan(1000)
			expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/)
		})
	})
})
