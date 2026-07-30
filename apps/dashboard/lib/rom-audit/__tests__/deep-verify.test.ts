import { describe, expect, it, vi } from 'vitest'
import type { Dat } from '../dat-parser'
import {
	type CommandResult,
	type RunCommand,
	detectTool,
	detectTools,
	verifyChd,
	verifyRvz,
} from '../deep-verify'

function runner(handler: (bin: string, args: string[]) => CommandResult | Error): RunCommand {
	return vi.fn(async (bin, args) => {
		const out = handler(bin, args)
		if (out instanceof Error) throw out
		return out
	})
}

const ok = (stdout: string, code = 0): CommandResult => ({ code, stdout, stderr: '' })
const enoent = () => new Error('spawn ENOENT')

// Real output, copied from the binaries installed on 2026-07-27.
const CHDMAN_OK = `chdman - MAME Compressed Hunks of Data (CHD) manager 0.285 (unknown)
Verifying, 0.0% complete... Raw SHA1 verification successful!
Overall SHA1 verification successful!`

// `chdman verify` prints NO hash — those come from `chdman info`, a separate
// command. An earlier fixture concatenated both outputs and tested a run that
// never happens. The scan already stores the header hashes in `rom_files`, so
// the verdict does not need them.
const CHDMAN_INFO = `File Version: 5
SHA1:         3ff28fe25b8d83a6f72eae741e6a7ebd5d10ab9a
Data SHA1:    3a9c250770d369739c20a20f8f753897c761a6db`

const CHDMAN_CORRUPT = `chdman - MAME Compressed Hunks of Data (CHD) manager 0.285 (unknown)
Verifying, 0.0% complete... Error reading CHD file (/tmp/x.chd): Decompression error
Fatal error occurred: 1`

const DOLPHIN_OK = `CRC32: 97f48212
MD5 not computed
SHA1: f1ff4fa75bd02ad2809d59b27c22dac38c455a5a
Problems Found: No`

// The same file with one byte flipped: exit code 0 and "Problems Found: No"
// again — only the hashes moved. This fixture is the whole point of the module.
const DOLPHIN_CORRUPT = `CRC32: 49cb28f7
MD5 not computed
SHA1: 1307265367f27438db29a970194bf4140b360363
Problems Found: No`

const GAMECUBE_DAT: Dat = {
	name: 'Nintendo - GameCube',
	version: '2026.05.02',
	games: [
		{
			name: 'Tower of Druaga, The (Japan)',
			region: 'Japan',
			serial: 'DL-DOL-PKBJ-JPN',
			roms: [
				{
					name: 'Tower of Druaga, The (Japan).iso',
					size: 1459978240,
					crc: '97f48212',
					sha1: 'f1ff4fa75bd02ad2809d59b27c22dac38c455a5a',
				},
			],
		},
	],
}

describe('detectTool', () => {
	it('reports a tool as available with its version', async () => {
		const run = runner(() => ok('chdman - MAME Compressed Hunks of Data (CHD) manager 0.285'))
		const res = await detectTool('chdman', run)
		expect(res).toEqual({ tool: 'chdman', available: true, version: '0.285' })
	})

	// dolphin-tool lives in /usr/games, which many non-interactive PATHs omit —
	// looking it up by name alone is what made an earlier survey call it missing.
	it('finds a tool that is not on the PATH but is at a known location', async () => {
		const run = runner((bin) => {
			if (bin === 'dolphin-tool') return enoent()
			if (bin === '/usr/games/dolphin-tool') return ok('usage: dolphin-tool COMMAND -h')
			return enoent()
		})
		expect((await detectTool('dolphin-tool', run)).available).toBe(true)
	})

	it('reports a missing binary without throwing', async () => {
		const res = await detectTool(
			'chdman',
			runner(() => enoent()),
		)
		expect(res).toEqual({ tool: 'chdman', available: false })
	})

	// A binary that runs but prints nothing is not usable evidence.
	it('does not count a silent binary as available', async () => {
		expect(
			(
				await detectTool(
					'chdman',
					runner(() => ok('')),
				)
			).available,
		).toBe(false)
	})

	it('detects both tools in one pass', async () => {
		const tools = await detectTools(runner(() => ok('0.285')))
		expect(tools.map((t) => t.tool)).toEqual(['chdman', 'dolphin-tool'])
	})
})

describe('verifyChd', () => {
	// Verified against the real binary: this is exactly what `chdman verify`
	// prints on a healthy file, hashes included — that is to say, none.
	it('reports an intact chd from the verify output alone', async () => {
		const res = await verifyChd(
			'/tmp/x.chd',
			runner(() => ok(CHDMAN_OK)),
		)
		expect(res.status).toBe('intact')
		if (res.status !== 'intact') throw new Error('expected intact')
		expect(res.sha1).toBeUndefined()
	})

	// Robustness only: should a future chdman print them, they are picked up.
	it('picks up the hashes when the output happens to carry them', async () => {
		const res = await verifyChd(
			'/tmp/x.chd',
			runner(() => ok(`${CHDMAN_OK}\n${CHDMAN_INFO}`)),
		)
		if (res.status !== 'intact') throw new Error('expected intact')
		expect(res.sha1).toBe('3ff28fe25b8d83a6f72eae741e6a7ebd5d10ab9a')
		expect(res.rawSha1).toBe('3a9c250770d369739c20a20f8f753897c761a6db')
	})

	// The value nothing else in the audit provides: a CHD can never match a
	// Redump entry by hash, but it can still be caught rotting.
	it('reports corruption when chdman fails its own check', async () => {
		const res = await verifyChd(
			'/tmp/x.chd',
			runner(() => ok(CHDMAN_CORRUPT, 1)),
		)
		expect(res.status).toBe('corrupt')
		if (res.status !== 'corrupt') throw new Error('expected corrupt')
		expect(res.detail).toContain('Decompression error')
	})

	// A missing file exits 1 too. Calling it corrupt would announce a damaged
	// collection where there is only a stale path.
	it('tells a missing file apart from a corrupt one', async () => {
		const res = await verifyChd(
			'/tmp/gone.chd',
			runner(() => ok('Error opening CHD file: No such file or directory', 1)),
		)
		expect(res.status).toBe('failed')
	})

	it('never throws when the binary cannot be spawned', async () => {
		const res = await verifyChd(
			'/tmp/x.chd',
			runner(() => enoent()),
		)
		expect(res.status).toBe('failed')
	})

	it('still reports intact when chdman prints no hash at all', async () => {
		const res = await verifyChd(
			'/tmp/x.chd',
			runner(() => ok('Overall SHA1 verification successful!')),
		)
		expect(res.status).toBe('intact')
	})
})

describe('verifyRvz', () => {
	it('verifies against the catalogue when the hash matches', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			GAMECUBE_DAT,
			runner(() => ok(DOLPHIN_OK)),
		)
		expect(res.status).toBe('verified')
		if (res.status !== 'verified') throw new Error('expected verified')
		expect(res.crc32).toBe('97f48212')
		expect(res.datEntryName).toBe('Tower of Druaga, The (Japan).iso')
	})

	// THE trap. dolphin-tool answers "Problems Found: No" with exit code 0 on a
	// file whose data was altered; only the hash moved. Believing the tool would
	// declare a rotten disc intact.
	it('never reports an rvz intact on the strength of "Problems Found: No"', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			GAMECUBE_DAT,
			runner(() => ok(DOLPHIN_CORRUPT)),
		)
		expect(res.status).not.toBe('intact')
		expect(res.status).not.toBe('verified')
		expect(res.status).toBe('mismatch')
	})

	// A mismatch is not proof of damage: Redump does not list every dump. The
	// wording must leave both doors open rather than accuse the file.
	it('reports a hash matching no entry as a mismatch, not as corruption', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			GAMECUBE_DAT,
			runner(() => ok(DOLPHIN_CORRUPT)),
		)
		expect(res.status).toBe('mismatch')
		if (res.status !== 'mismatch') throw new Error('expected mismatch')
		expect(res.sha1).toBe('1307265367f27438db29a970194bf4140b360363')
	})

	it('matches on sha1 even when the catalogue carries no crc', async () => {
		const dat: Dat = {
			...GAMECUBE_DAT,
			games: [
				{
					name: 'X',
					roms: [{ name: 'X.iso', size: 1, sha1: 'f1ff4fa75bd02ad2809d59b27c22dac38c455a5a' }],
				},
			],
		}
		expect(
			(
				await verifyRvz(
					'/tmp/x.rvz',
					dat,
					runner(() => ok(DOLPHIN_OK)),
				)
			).status,
		).toBe('verified')
	})

	it('reports no-catalog when the system has none', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			null,
			runner(() => ok(DOLPHIN_OK)),
		)
		expect(res.status).toBe('no-catalog')
		if (res.status !== 'no-catalog') throw new Error('expected no-catalog')
		expect(res.crc32).toBe('97f48212')
	})

	it('fails cleanly when dolphin-tool prints no hash', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			GAMECUBE_DAT,
			runner(() => ok('nothing useful')),
		)
		expect(res.status).toBe('failed')
	})

	it('never throws when the binary cannot be spawned', async () => {
		const res = await verifyRvz(
			'/tmp/x.rvz',
			GAMECUBE_DAT,
			runner(() => enoent()),
		)
		expect(res.status).toBe('failed')
	})
})
