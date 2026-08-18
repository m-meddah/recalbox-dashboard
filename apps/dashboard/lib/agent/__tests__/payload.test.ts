import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
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

	describe('quand apps/dashboard/agent-payload/ est absent (dev/test sans prebuild)', () => {
		// `prebuild` (voir package.json) ne s'exécute que pour `pnpm run build` : ni pour
		// `pnpm dev` ni pour `pnpm exec vitest ...` (les hooks pre/post de pnpm ne se
		// déclenchent pas pour `pnpm exec`). Sur un clone frais, `agent-payload/` n'existe
		// donc pas tant que `pnpm build` n'a pas tourné une fois. Ce test le simule en
		// déplaçant temporairement le dossier (s'il existe) pour forcer le code applicatif
		// à emprunter le repli ENOENT vers `agent/` à la racine du monorepo — sans ce
		// repli, `readAgentPayload()` rejette et le test échoue.
		const primaryDir = path.resolve(process.cwd(), 'agent-payload')
		const movedAsideDir = path.resolve(process.cwd(), 'agent-payload.test-backup')
		let movedAside = false

		beforeEach(async () => {
			movedAside = existsSync(primaryDir)
			if (movedAside) {
				await rename(primaryDir, movedAsideDir)
			}
		})

		afterEach(async () => {
			if (movedAside) {
				await rename(movedAsideDir, primaryDir)
			}
		})

		it('retombe sur agent/ à la racine du monorepo', async () => {
			expect(existsSync(primaryDir)).toBe(false)
			const payload = await readAgentPayload()
			expect(payload.agentPy).toContain('CONFIG_PATH')
			expect(payload.scanRomsPy.length).toBeGreaterThan(1000)
			expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/)
		})
	})
})
