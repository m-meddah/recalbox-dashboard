import { describe, expect, it } from 'vitest'
import { commandSchema, toQueuePayload } from '../commands'

describe('commandSchema', () => {
	it('accepts a power command with an allowed action', () => {
		const r = commandSchema.safeParse({ type: 'power', action: 'reboot' })
		expect(r.success).toBe(true)
	})

	it('rejects an unknown power action', () => {
		expect(commandSchema.safeParse({ type: 'power', action: 'selfdestruct' }).success).toBe(false)
	})

	it('accepts a conf command with a dotted key', () => {
		const r = commandSchema.safeParse({ type: 'conf', key: 'audio.volume', value: '90' })
		expect(r.success).toBe(true)
	})

	it('rejects conf keys with shell/INI metacharacters', () => {
		for (const key of ['audio volume', 'a=b', 'a;rm -rf', 'a\nb', "a'b"]) {
			expect(commandSchema.safeParse({ type: 'conf', key, value: 'x' }).success).toBe(false)
		}
	})

	it('rejects conf values containing a newline', () => {
		expect(commandSchema.safeParse({ type: 'conf', key: 'a.b', value: 'x\ny=evil' }).success).toBe(
			false,
		)
	})

	it('accepts a launch command', () => {
		const r = commandSchema.safeParse({
			type: 'launch',
			romPath: '/recalbox/share/roms/snes/x.sfc',
			system: 'snes',
		})
		expect(r.success).toBe(true)
	})

	it('rejects an unknown command type', () => {
		expect(commandSchema.safeParse({ type: 'exec', cmd: 'rm -rf /' }).success).toBe(false)
	})
})

describe('toQueuePayload', () => {
	it('splits the discriminant from its params', () => {
		expect(toQueuePayload({ type: 'power', action: 'shutdown' })).toEqual({
			type: 'power',
			payload: { action: 'shutdown' },
		})
		expect(toQueuePayload({ type: 'conf', key: 'a.b', value: '1' })).toEqual({
			type: 'conf',
			payload: { key: 'a.b', value: '1' },
		})
	})
})

describe('scan command', () => {
	it('accepts a scan for the whole box', () => {
		const r = commandSchema.safeParse({ type: 'scan', scanId: 's1' })
		expect(r.success).toBe(true)
	})

	it('accepts a scan restricted to named systems', () => {
		const r = commandSchema.safeParse({ type: 'scan', scanId: 's1', systems: ['snes', 'psx'] })
		expect(r.success).toBe(true)
	})

	// The command must never be able to name a path: the box discovers its own.
	it('rejects a system id shaped like a path', () => {
		for (const system of ['../etc', 'a/b', 'a\\b']) {
			expect(
				commandSchema.safeParse({ type: 'scan', scanId: 's1', systems: [system] }).success,
			).toBe(false)
		}
	})

	it('rejects a scan with no scan id', () => {
		expect(commandSchema.safeParse({ type: 'scan' }).success).toBe(false)
	})

	it('splits into type and payload like any other command', () => {
		const parsed = commandSchema.parse({ type: 'scan', scanId: 's1', systems: ['snes'] })
		expect(toQueuePayload(parsed)).toEqual({
			type: 'scan',
			payload: { scanId: 's1', systems: ['snes'] },
		})
	})
})
