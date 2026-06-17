import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeNodeSSH, connectMock, disposeMock, isConnectedMock, execCommandMock, getErrorHandler } =
	vi.hoisted(() => {
		let errorHandler: ((err: unknown) => void) | undefined
		const connect = vi.fn()
		const dispose = vi.fn()
		const isConnected = vi.fn()
		const execCommand = vi.fn()
		class FakeNodeSSH {
			connection = {
				on: vi.fn((event: string, cb: (err: unknown) => void) => {
					if (event === 'error') errorHandler = cb
				}),
			}
			connect = connect
			dispose = dispose
			isConnected = isConnected
			execCommand = execCommand
		}
		return {
			FakeNodeSSH,
			connectMock: connect,
			disposeMock: dispose,
			isConnectedMock: isConnected,
			execCommandMock: execCommand,
			getErrorHandler: () => errorHandler,
		}
	})

vi.mock('node-ssh', () => ({ NodeSSH: FakeNodeSSH }))

vi.mock('@/lib/config-store', () => ({
	configStore: {
		getForRecalbox: () => ({
			recalbox: { host: 'r.local', sshUser: 'root', sshPassword: 'x', sshPort: 22 },
		}),
		getDefaultRecalbox: () => ({ id: 'rb-default' }),
		on: vi.fn(),
	},
}))

import { getSshClient } from '@/lib/recalbox/ssh-client'

let idCounter = 0
function freshClient() {
	// Unique id per test so the module-level pool hands back a fresh connection.
	return getSshClient(`rb-${idCounter++}`, 'media')
}

beforeEach(() => {
	connectMock.mockClear().mockResolvedValue(undefined)
	disposeMock.mockClear()
	execCommandMock.mockClear()
	isConnectedMock.mockClear().mockReturnValue(true)
})

afterEach(() => vi.restoreAllMocks())

describe('SshClient command timeout handling', () => {
	it('does not tear down the shared connection when a single command times out', async () => {
		const ssh = freshClient()

		// First command establishes the connection.
		execCommandMock.mockResolvedValueOnce({ stdout: 'BASE64DATA', stderr: '' })
		expect(await ssh.exec('echo ok')).toBe('BASE64DATA')

		// The initial connect() disposes the placeholder client once — ignore that.
		disposeMock.mockClear()
		connectMock.mockClear()

		// A slow command that never returns: it should hit the per-command timeout.
		execCommandMock.mockReturnValueOnce(new Promise(() => {}))
		await expect(ssh.exec('slow base64', 30)).rejects.toThrow(/timed out/)

		// Connection stays up: a command timeout is not a connection failure, so the
		// shared connection (and any sibling commands riding on it) must be preserved.
		expect(disposeMock).not.toHaveBeenCalled()
		expect(connectMock).not.toHaveBeenCalled()

		// A subsequent command reuses the same live connection, no reconnect.
		execCommandMock.mockResolvedValueOnce({ stdout: 'AGAIN', stderr: '' })
		expect(await ssh.exec('echo again')).toBe('AGAIN')
		expect(connectMock).not.toHaveBeenCalled()
	})

	it('reconnects when the connection actually drops', async () => {
		const ssh = freshClient()

		execCommandMock.mockResolvedValueOnce({ stdout: 'OK', stderr: '' })
		expect(await ssh.exec('echo ok')).toBe('OK')

		connectMock.mockClear()

		// Simulate a genuine connection reset reported by the transport.
		getErrorHandler()?.(new Error('connection reset'))

		// Next command must re-establish the connection.
		execCommandMock.mockResolvedValueOnce({ stdout: 'RECOVERED', stderr: '' })
		expect(await ssh.exec('echo again')).toBe('RECOVERED')
		expect(connectMock).toHaveBeenCalledTimes(1)
	})
})
