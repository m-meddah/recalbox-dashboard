import { readAgentPayload } from '@/lib/agent/payload'
import { describe, expect, it } from 'vitest'

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
