import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readRecalboxConfValue } from '@/lib/recalbox/conf-reader'
import { getPatronStatus } from '@/lib/recalbox/patron-status'
import type { SshClientLike } from '@/lib/recalbox/ssh-client'

/** Captures the command that would run on the box, and replays canned output. */
function recordingSsh(output = '') {
	const commands: string[] = []
	const ssh: SshClientLike = {
		exec: vi.fn(async (cmd: string) => {
			commands.push(cmd)
			return output
		}),
	}
	return { ssh, commands }
}

describe('readRecalboxConfValue: the caller-supplied key never reaches the shell', () => {
	// GET /api/recalbox/conf?key=… hands this straight through, so the key is
	// attacker-controlled input and the whitelist is the only thing in front of it.
	// Keeping it out of the command line entirely removes the class of bug rather
	// than relying on escaping it correctly.
	const ALLOWED = [
		'global.retroachievements',
		'global.retroachievements.username',
		'global.retroachievements.hardcore',
	]

	it.each(ALLOWED)('does not interpolate %s into the command', async (key) => {
		const { ssh, commands } = recordingSsh('')
		await readRecalboxConfValue(key, ssh)

		expect(commands).toHaveLength(1)
		expect(commands[0]).not.toContain(key)
	})

	it('issues the same command whatever the key, so no key can shape it', async () => {
		const seen = new Set<string>()
		for (const key of ALLOWED) {
			const { ssh, commands } = recordingSsh('')
			await readRecalboxConfValue(key, ssh)
			seen.add(commands[0] ?? '')
		}
		expect(seen.size).toBe(1)
	})

	it('still returns the value for a whitelisted key', async () => {
		const { ssh } = recordingSsh('global.retroachievements=1\nother.key=2\n')
		expect(await readRecalboxConfValue('global.retroachievements', ssh)).toBe('1')
	})

	it('still refuses a key outside the whitelist', async () => {
		const { ssh, commands } = recordingSsh('')
		await expect(readRecalboxConfValue('a;id;b', ssh)).rejects.toThrow(/whitelist/)
		expect(commands).toHaveLength(0)
	})
})

describe('generated commands are well-formed shell', () => {
	let dir: string
	let conf: string

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'conf-quoting-'))
		conf = join(dir, 'recalbox.conf')
		writeFileSync(
			conf,
			['# comment', 'patron.privatekey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'other=1', ''].join('\n'),
		)
	})
	afterAll(() => rmSync(dir, { recursive: true, force: true }))

	/**
	 * Runs a captured command against the temp conf, with a real shell. Substitutes
	 * the path text only, leaving whatever quoting the command used intact — the
	 * quoting is precisely what is under test.
	 */
	function runInShell(cmd: string): string {
		return execFileSync(
			'sh',
			['-c', cmd.replaceAll('/recalbox/share/system/recalbox.conf', conf)],
			{ encoding: 'utf8' },
		)
	}

	it('patron-status greps without a shell syntax error and finds the key', async () => {
		const { ssh, commands } = recordingSsh('')
		await getPatronStatus(ssh)

		// A shell, not a string assertion, is the only thing that can confirm quoting.
		const out = runInShell(commands[0] ?? '')
		expect(out).toContain('patron.privatekey=')
	})

	it('patron-status passes the pattern as one quoted argument', async () => {
		const { ssh, commands } = recordingSsh('')
		await getPatronStatus(ssh)
		const cmd = commands[0] ?? ''

		// The broken form was `grep -E '^\s*'patron.privatekey'\s*='`, where the inner
		// quotes cancel the outer ones and leave the key unquoted. Guard against its
		// return: the key must never sit outside a quoted region.
		expect(cmd).not.toMatch(/'\S*'patron\.privatekey'/)
		expect(cmd).toContain("'^\\s*patron\\.privatekey\\s*='")
	})

	it('conf-reader reads the file without a shell syntax error', async () => {
		const { ssh, commands } = recordingSsh('')
		await readRecalboxConfValue('global.retroachievements', ssh)

		const out = runInShell(commands[0] ?? '')
		expect(out).toContain('other=1')
	})
})
