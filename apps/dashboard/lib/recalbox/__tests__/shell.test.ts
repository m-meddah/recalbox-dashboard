import { describe, expect, it } from 'vitest'
import { MAX_SSH_COMMAND_LENGTH, chunkShellCommands, shellQuote } from '../shell'

describe('chunkShellCommands', () => {
	it('keeps everything in one chunk when it fits', () => {
		expect(chunkShellCommands(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']])
	})

	it('returns no chunk for an empty list', () => {
		expect(chunkShellCommands([])).toEqual([])
	})

	it('splits once the joined length would exceed the limit', () => {
		// 'aaaa;bbbb' is 9 chars and fits; adding 'cccc' would not.
		const chunks = chunkShellCommands(['aaaa', 'bbbb', 'cccc'], 10)
		expect(chunks).toEqual([['aaaa', 'bbbb'], ['cccc']])
	})

	it('packs as many commands as fit per chunk', () => {
		const chunks = chunkShellCommands(['aa', 'bb', 'cc', 'dd'], 6)
		expect(chunks).toEqual([
			['aa', 'bb'],
			['cc', 'dd'],
		])
	})

	it('never drops a command longer than the limit', () => {
		const long = 'x'.repeat(50)
		const chunks = chunkShellCommands(['a', long, 'b'], 10)
		expect(chunks.flat()).toEqual(['a', long, 'b'])
	})

	it('keeps every joined chunk under the default limit', () => {
		// 59 base64 writes is the real GameCube case that silently failed before.
		const commands = Array.from({ length: 59 }, (_, i) => `write ${'x'.repeat(200)} ${i}`)
		for (const chunk of chunkShellCommands(commands)) {
			expect(chunk.join(';').length).toBeLessThanOrEqual(MAX_SSH_COMMAND_LENGTH)
		}
		expect(chunkShellCommands(commands).flat()).toHaveLength(59)
	})
})

describe('shellQuote', () => {
	it('wraps in single quotes', () => {
		expect(shellQuote('Resident Evil 4 (USA).m3u')).toBe("'Resident Evil 4 (USA).m3u'")
	})

	it('escapes embedded single quotes', () => {
		expect(shellQuote("Tom Clancy's.m3u")).toBe("'Tom Clancy'\\''s.m3u'")
	})
})
