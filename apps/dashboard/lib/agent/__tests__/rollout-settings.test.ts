import { afterEach, describe, expect, it, vi } from 'vitest'

const getAllSettings = vi.fn()
const upsertSetting = vi.fn()

vi.mock('@/lib/db/queries', () => ({
	getAllSettings: () => getAllSettings(),
	upsertSetting: (...a: unknown[]) => upsertSetting(...a),
}))
vi.mock('@/lib/agent/payload', () => ({ readAgentVersion: async () => '1.1.0' }))

import { readRolloutSettings, writeRolloutSettings } from '@/lib/agent/rollout-settings'

afterEach(() => {
	getAllSettings.mockReset()
	upsertSetting.mockReset()
})

describe('readRolloutSettings', () => {
	it('falls back to the deployed version and a closed rollout', async () => {
		getAllSettings.mockResolvedValue({})
		expect(await readRolloutSettings()).toEqual({ targetVersion: '1.1.0', rolloutPercent: 0 })
	})

	it('reads the stored values', async () => {
		getAllSettings.mockResolvedValue({
			'agent.targetVersion': '1.0.0',
			'agent.rolloutPercent': '25',
		})
		expect(await readRolloutSettings()).toEqual({ targetVersion: '1.0.0', rolloutPercent: 25 })
	})

	it('clamps a nonsense percentage rather than deploying to a negative fleet', async () => {
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': '512' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(100)
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': '-4' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(0)
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': 'beaucoup' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(0)
	})
})

describe('writeRolloutSettings', () => {
	it('writes only the keys it was given', async () => {
		await writeRolloutSettings({ rolloutPercent: 50 })
		expect(upsertSetting).toHaveBeenCalledTimes(1)
		expect(upsertSetting).toHaveBeenCalledWith('agent.rolloutPercent', '50')
	})

	it('writes both when both are given', async () => {
		await writeRolloutSettings({ targetVersion: '1.0.0', rolloutPercent: 100 })
		expect(upsertSetting).toHaveBeenCalledWith('agent.targetVersion', '1.0.0')
		expect(upsertSetting).toHaveBeenCalledWith('agent.rolloutPercent', '100')
	})

	it('clamps out-of-range values on write', async () => {
		await writeRolloutSettings({ rolloutPercent: 500 })
		expect(upsertSetting).toHaveBeenCalledWith('agent.rolloutPercent', '100')
	})
})
