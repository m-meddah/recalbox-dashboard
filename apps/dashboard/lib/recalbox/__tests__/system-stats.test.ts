import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/recalbox/ssh-client', () => ({
	sshClient: {
		exec: vi.fn(),
	},
}))

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sshClient } from '@/lib/recalbox/ssh-client'
import { getSystemStats } from '@/lib/recalbox/system-stats'

const mockExec = vi.mocked(sshClient.exec)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('getSystemStats', () => {
	it('parses CPU temperature from millidegrees', async () => {
		// Pi5 real output: 57123 → 57.123°C
		mockExec.mockImplementation((cmd: string) => {
			if (cmd.includes('thermal_zone0')) return Promise.resolve('57123')
			if (cmd.includes('proc/stat')) return Promise.resolve('cpu  1000 0 500 8000 0 0 0 0 0 0')
			if (cmd.includes('free')) return Promise.resolve('Mem:           3920        1024        2896           0           0        2000')
			if (cmd.includes('uptime')) return Promise.resolve('86400.12 123456.00')
			return Promise.resolve('')
		})

		const stats = await getSystemStats()

		expect(stats.cpuTemp).toBeCloseTo(57.123, 2)
	})

	it('parses RAM usage from free -m output', async () => {
		// Typical Pi5 free -m output line
		mockExec.mockImplementation((cmd: string) => {
			if (cmd.includes('thermal_zone0')) return Promise.resolve('50000')
			if (cmd.includes('proc/stat')) return Promise.resolve('cpu  1000 0 500 8000 0 0 0 0 0 0')
			if (cmd.includes('free')) return Promise.resolve('Mem:           7976        2048        5928           0           0        6000')
			if (cmd.includes('uptime')) return Promise.resolve('3661.0 7000.0')
			return Promise.resolve('')
		})

		const stats = await getSystemStats()

		expect(stats.ramTotalMb).toBe(7976)
		expect(stats.ramUsedMb).toBe(2048)
	})

	it('parses uptime from /proc/uptime', async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd.includes('thermal_zone0')) return Promise.resolve('45000')
			if (cmd.includes('proc/stat')) return Promise.resolve('cpu  1000 0 500 8000 0 0 0 0 0 0')
			if (cmd.includes('free')) return Promise.resolve('Mem:           3920        512        3408           0           0        2500')
			if (cmd.includes('uptime')) return Promise.resolve('172800.00 345600.00')
			return Promise.resolve('')
		})

		const stats = await getSystemStats()

		expect(stats.uptimeSec).toBe(172800)
	})

	it('returns null fields when SSH commands fail', async () => {
		mockExec.mockRejectedValue(new Error('SSH connection refused'))

		const stats = await getSystemStats()

		expect(stats.cpuTemp).toBeNull()
		expect(stats.ramUsedMb).toBeNull()
		expect(stats.ramTotalMb).toBeNull()
		expect(stats.uptimeSec).toBeNull()
		expect(stats.cpuUsage).toBeNull()
		expect(stats.takenAt).toBeInstanceOf(Date)
	})

	it('handles malformed /proc/stat gracefully', async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd.includes('thermal_zone0')) return Promise.resolve('42000')
			if (cmd.includes('proc/stat')) return Promise.resolve('cpu  not valid data here')
			if (cmd.includes('free')) return Promise.resolve('Mem:           3920        800        3120           0           0        2500')
			if (cmd.includes('uptime')) return Promise.resolve('1234.5 9999.0')
			return Promise.resolve('')
		})

		const stats = await getSystemStats()

		expect(stats.cpuUsage).toBeNull()
		expect(stats.cpuTemp).toBeCloseTo(42, 0)
	})
})
