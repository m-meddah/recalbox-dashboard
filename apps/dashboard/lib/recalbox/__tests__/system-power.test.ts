import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/recalbox/ssh-client', () => ({
	sshClient: {
		exec: vi.fn(),
	},
}))

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sshClient } from '@/lib/recalbox/ssh-client'
import { executeSystemPower } from '@/lib/recalbox/system-power'

const mockExec = vi.mocked(sshClient.exec)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('executeSystemPower', () => {
	it('runs poweroff for shutdown action', async () => {
		mockExec.mockResolvedValue('')

		await executeSystemPower('shutdown')

		expect(mockExec).toHaveBeenCalledWith('poweroff', 2000)
	})

	it('runs reboot for reboot action', async () => {
		mockExec.mockResolvedValue('')

		await executeSystemPower('reboot')

		expect(mockExec).toHaveBeenCalledWith('reboot', 2000)
	})

	it('does not throw when SSH disconnects (expected for poweroff/reboot)', async () => {
		mockExec.mockRejectedValue(new Error('ECONNRESET'))

		await expect(executeSystemPower('shutdown')).resolves.toBeUndefined()
	})

	it('re-throws unexpected SSH errors', async () => {
		mockExec.mockRejectedValue(new Error('Authentication failed'))

		await expect(executeSystemPower('reboot')).rejects.toThrow('Authentication failed')
	})
})
