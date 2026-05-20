import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { SshClientLike } from '@/lib/recalbox/ssh-client'
import { _parsePresence, getPatronStatus } from '@/lib/recalbox/patron-status'

function makeSsh(output: string): SshClientLike {
	return { exec: vi.fn().mockResolvedValue(output) }
}

beforeEach(() => vi.clearAllMocks())

describe('_parsePresence (unit)', () => {
	it('returns present=true when key has a value', () => {
		const r = _parsePresence('patron.privatekey=SomeLongBase64Key1234567890ABCDEF')
		expect(r.present).toBe(true)
		expect(r.looksValid).toBe(true)
	})

	it('returns present=false when key is absent', () => {
		const r = _parsePresence('global.retroachievements=1\n')
		expect(r.present).toBe(false)
		expect(r.looksValid).toBe(false)
	})

	it('returns present=false for empty value', () => {
		const r = _parsePresence('patron.privatekey=')
		expect(r.present).toBe(false)
		expect(r.looksValid).toBe(false)
	})

	it('skips comment lines', () => {
		const r = _parsePresence('# patron.privatekey=SomeKey\npatron.privatekey=')
		expect(r.present).toBe(false)
	})

	it('looksValid=false for short key (< 16 chars)', () => {
		const r = _parsePresence('patron.privatekey=short')
		expect(r.present).toBe(true)
		expect(r.looksValid).toBe(false)
	})
})

describe('getPatronStatus', () => {
	it('key present and valid → isPatron=true, keyPresent=true, keyLooksValid=true', async () => {
		const ssh = makeSsh('patron.privatekey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
		const status = await getPatronStatus(ssh)
		expect(status.isPatron).toBe(true)
		expect(status.keyPresent).toBe(true)
		expect(status.keyLooksValid).toBe(true)
	})

	it('key absent → all false', async () => {
		const ssh = makeSsh('updates.type=stable\n')
		const status = await getPatronStatus(ssh)
		expect(status.isPatron).toBe(false)
		expect(status.keyPresent).toBe(false)
		expect(status.keyLooksValid).toBe(false)
	})

	it('key present but empty → keyPresent=false', async () => {
		const ssh = makeSsh('patron.privatekey=')
		const status = await getPatronStatus(ssh)
		expect(status.keyPresent).toBe(false)
		expect(status.isPatron).toBe(false)
	})

	it('SSH failure → returns all-false without throwing', async () => {
		const ssh: SshClientLike = { exec: vi.fn().mockRejectedValue(new Error('SSH error')) }
		const status = await getPatronStatus(ssh)
		expect(status.isPatron).toBe(false)
		expect(status.keyPresent).toBe(false)
		expect(status.keyLooksValid).toBe(false)
	})

	it('output object never contains the key value', async () => {
		const secretValue = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
		const ssh = makeSsh(`patron.privatekey=${secretValue}`)
		const status = await getPatronStatus(ssh)
		const serialized = JSON.stringify(status)
		expect(serialized).not.toContain(secretValue)
		// Only boolean fields
		expect(Object.keys(status)).toEqual(['isPatron', 'keyPresent', 'keyLooksValid'])
	})
})
