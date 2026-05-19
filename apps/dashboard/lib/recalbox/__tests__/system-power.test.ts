import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { SshClientLike } from '@/lib/recalbox/ssh-client'
import { executeSystemPower } from '@/lib/recalbox/system-power'

function makeMockSsh(): SshClientLike & { exec: ReturnType<typeof vi.fn> } {
	return { exec: vi.fn() }
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('executeSystemPower', () => {
	it('runs poweroff for shutdown action', async () => {
		const ssh = makeMockSsh()
		ssh.exec.mockResolvedValue('')

		await executeSystemPower('shutdown', ssh)

		expect(ssh.exec).toHaveBeenCalledWith('poweroff', 2000)
	})

	it('runs reboot for reboot action', async () => {
		const ssh = makeMockSsh()
		ssh.exec.mockResolvedValue('')

		await executeSystemPower('reboot', ssh)

		expect(ssh.exec).toHaveBeenCalledWith('reboot', 2000)
	})

	it('does not throw when SSH disconnects (expected for poweroff/reboot)', async () => {
		const ssh = makeMockSsh()
		ssh.exec.mockRejectedValue(new Error('ECONNRESET'))

		await expect(executeSystemPower('shutdown', ssh)).resolves.toBeUndefined()
	})

	it('re-throws unexpected SSH errors', async () => {
		const ssh = makeMockSsh()
		ssh.exec.mockRejectedValue(new Error('Authentication failed'))

		await expect(executeSystemPower('reboot', ssh)).rejects.toThrow('Authentication failed')
	})
})
