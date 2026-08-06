import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectDiscInfo, detectMultiDiscGames, scanM3u } from '../multidisc-detector'
import type { SshClientLike } from '../ssh-client'

describe('detectDiscInfo', () => {
	// ─── Standard Redump patterns ──────────────────────────────────────────────

	it('detects (Disc 1)', () => {
		expect(detectDiscInfo('Final Fantasy VII (USA) (Disc 1).chd')).toEqual({
			baseName: 'Final Fantasy VII (USA)',
			discNumber: 1,
		})
	})

	it('detects (Disc 2)', () => {
		expect(detectDiscInfo('Final Fantasy VII (USA) (Disc 2).chd')).toEqual({
			baseName: 'Final Fantasy VII (USA)',
			discNumber: 2,
		})
	})

	it('detects (Disc 1 of 3)', () => {
		expect(detectDiscInfo('Game (USA) (Disc 1 of 3).chd')).toEqual({
			baseName: 'Game (USA)',
			discNumber: 1,
		})
	})

	it('detects (Disk 1) — alternate spelling', () => {
		expect(detectDiscInfo('Game (USA) (Disk 1).chd')).toEqual({
			baseName: 'Game (USA)',
			discNumber: 1,
		})
	})

	it('detects (CD 1)', () => {
		expect(detectDiscInfo('Game (CD 1).chd')).toEqual({
			baseName: 'Game',
			discNumber: 1,
		})
	})

	it('detects (CD1) — no space', () => {
		expect(detectDiscInfo('Game (CD1).chd')).toEqual({
			baseName: 'Game',
			discNumber: 1,
		})
	})

	it('detects [Disc 2] — square brackets', () => {
		expect(detectDiscInfo('Game [Disc 2].chd')).toEqual({
			baseName: 'Game',
			discNumber: 2,
		})
	})

	it('detects bare "Disc 1" without brackets', () => {
		expect(detectDiscInfo('Game Disc 1.chd')).toEqual({
			baseName: 'Game',
			discNumber: 1,
		})
	})

	// ─── Disc-specific qualifier after disc tag (real collection) ──────────────

	it('strips disc-specific qualifier after (Disc N) — Leon-hen', () => {
		expect(detectDiscInfo('Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd')).toEqual({
			baseName: 'Biohazard 2 (Japan)',
			discNumber: 1,
		})
	})

	it('strips disc-specific qualifier after (Disc N) — Arcade', () => {
		expect(detectDiscInfo('Beat Mania (Japan) (Disc 1) (Arcade).chd')).toEqual({
			baseName: 'Beat Mania (Japan)',
			discNumber: 1,
		})
	})

	// ─── GameCube (.rvz, Dolphin) ─────────────────────────────────────────────

	it('detects (Disc 1) on a .rvz GameCube ROM', () => {
		expect(detectDiscInfo('Resident Evil 4 (USA) (Disc 1).rvz')).toEqual({
			baseName: 'Resident Evil 4 (USA)',
			discNumber: 1,
		})
	})

	it('strips (Rev N) after the disc tag — Killer7', () => {
		expect(detectDiscInfo('Killer7 (USA) (Disc 2) (Rev 1).rvz')).toEqual({
			baseName: 'Killer7 (USA)',
			discNumber: 2,
		})
	})

	it('handles 4 discs', () => {
		expect(detectDiscInfo("70's Robot Anime - Geppy-X (Japan) (Disc 4).chd")).toEqual({
			baseName: "70's Robot Anime - Geppy-X (Japan)",
			discNumber: 4,
		})
	})

	// ─── Negative cases — must NOT match ──────────────────────────────────────

	it('returns null for single-disc ROM without disc tag', () => {
		expect(detectDiscInfo('Super Mario World.sfc')).toBeNull()
	})

	it('returns null for 007 — number in title, not disc tag', () => {
		expect(detectDiscInfo('007 - GoldenEye (USA).z64')).toBeNull()
	})

	it('returns null when title contains "Disc" but no number', () => {
		expect(detectDiscInfo('Disc Jockey Simulator.chd')).toBeNull()
	})

	it('returns null for series numbers at end — 16 Tales 1', () => {
		expect(detectDiscInfo('16 Tales 1 (USA).chd')).toBeNull()
	})

	it('returns null when disc number is 0', () => {
		expect(detectDiscInfo('Game (Disc 0).chd')).toBeNull()
	})

	it('returns null when disc number exceeds 10', () => {
		expect(detectDiscInfo('Game (Disc 11).chd')).toBeNull()
	})

	it('returns null when baseName would be empty', () => {
		expect(detectDiscInfo('(Disc 1).chd')).toBeNull()
	})
})

// ─── DB mock ─────────────────────────────────────────────────────────────────

type GameRow = { system: string; romPath: string }

const mockState = vi.hoisted(() => {
	let rows: GameRow[] = []
	return {
		setRows: (r: GameRow[]) => {
			rows = r
		},
		getRows: () => rows,
	}
})

vi.mock('@/lib/db/index', () => {
	const fakeDb: Record<string, () => unknown> = {}
	fakeDb.select = () => fakeDb
	fakeDb.from = () => fakeDb
	fakeDb.where = () => fakeDb
	fakeDb.all = () => mockState.getRows()
	return { db: fakeDb }
})

vi.mock('@/lib/db/schema', () => ({
	games: { system: 'system', romPath: 'romPath', recalboxId: 'recalbox_id' },
}))

// ─── SSH mock ─────────────────────────────────────────────────────────────────

function makeMockSsh(lsOutput = ''): SshClientLike {
	return { exec: vi.fn().mockResolvedValue(lsOutput) }
}

/**
 * SSH mock that answers both calls detectMultiDiscGames can make: the `find` for
 * existing .m3u files, and the batched base64 dump used to inspect their bytes.
 */
function makeMockSshWithFiles(lsOutput: string, files: Record<string, string>): SshClientLike {
	return {
		exec: vi.fn(async (cmd: string) => {
			if (!cmd.includes('@@M3U@@')) return lsOutput
			return Object.entries(files)
				.map(([path, content]) => `@@M3U@@${path}\n${Buffer.from(content).toString('base64')}`)
				.join('\n')
		}),
	}
}

beforeEach(() => {
	mockState.setRows([])
	vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectMultiDiscGames', () => {
	it('groups two-disc game correctly', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 2).chd' },
		])
		const ssh = makeMockSsh('')
		const result = await detectMultiDiscGames(ssh, 'rb1')

		expect(result).toHaveLength(1)
		expect(result[0]?.baseName).toBe('Final Fantasy VII (USA)')
		expect(result[0]?.system).toBe('psx')
		expect(result[0]?.discs).toHaveLength(2)
		expect(result[0]?.discs[0]?.discNumber).toBe(1)
		expect(result[0]?.discs[1]?.discNumber).toBe(2)
	})

	it('sorts discs in ascending order', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result[0]?.discs.map((d) => d.discNumber)).toEqual([1, 2, 3])
	})

	it('discards single-disc groups', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Vagrant Story (USA).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result).toHaveLength(0)
	})

	it('detects hasGap when disc 2 is missing', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result[0]?.hasGap).toBe(true)
	})

	it('sets hasGap: false for consecutive discs', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result[0]?.hasGap).toBe(false)
	})

	it('sets m3uAlreadyExists when .m3u present in SSH ls output', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 2).chd' },
		])
		const ssh = makeMockSsh('/roms/psx/Final Fantasy VII (USA).m3u\n')
		const result = await detectMultiDiscGames(ssh, 'rb1')
		expect(result[0]?.m3uAlreadyExists).toBe(true)
	})

	it('sets m3uAlreadyExists: false when .m3u absent', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Metal Gear Solid (USA) (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Metal Gear Solid (USA) (Disc 2).chd' },
		])
		const ssh = makeMockSsh('')
		const result = await detectMultiDiscGames(ssh, 'rb1')
		expect(result[0]?.m3uAlreadyExists).toBe(false)
	})

	it('groups games from different systems separately', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
			{ system: 'saturn', romPath: '/roms/saturn/Game (Disc 1).chd' },
			{ system: 'saturn', romPath: '/roms/saturn/Game (Disc 2).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result).toHaveLength(2)
		expect(result.map((r) => r.system).sort()).toEqual(['psx', 'saturn'])
	})

	it('filters to specific system when provided', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
			{ system: 'saturn', romPath: '/roms/saturn/Other (Disc 1).chd' },
			{ system: 'saturn', romPath: '/roms/saturn/Other (Disc 2).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'psx')
		expect(result).toHaveLength(1)
		expect(result[0]?.system).toBe('psx')
	})

	it('returns [] for non-disc-capable system', async () => {
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'snes')
		expect(result).toEqual([])
	})

	it('handles disc-specific qualifier — baseName is prefix before disc tag', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd' },
			{ system: 'psx', romPath: '/roms/psx/Biohazard 2 (Japan) (Disc 2) (Claire-hen).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1')
		expect(result).toHaveLength(1)
		expect(result[0]?.baseName).toBe('Biohazard 2 (Japan)')
	})

	it('groups discs whose language tag differs, naming the m3u after the common part', async () => {
		// Disc 1 carries "(Fr,Nl)", disc 2 does not — a real No-Intro GameCube case.
		mockState.setRows([
			{
				system: 'gamecube',
				romPath: '/roms/gamecube/2 Games in 1 (France) (Fr,Nl) (Disc 1) (Bob).rvz',
			},
			{ system: 'gamecube', romPath: '/roms/gamecube/2 Games in 1 (France) (Disc 2) (Tak 2).rvz' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'gamecube')
		expect(result).toHaveLength(1)
		expect(result[0]?.baseName).toBe('2 Games in 1 (France)')
		expect(result[0]?.m3uFileName).toBe('2 Games in 1 (France).m3u')
	})

	it('keeps the language tag when every disc carries it', async () => {
		mockState.setRows([
			{
				system: 'gamecube',
				romPath: '/roms/gamecube/Baten Kaitos (Europe) (En,Fr,De) (Disc 1).rvz',
			},
			{
				system: 'gamecube',
				romPath: '/roms/gamecube/Baten Kaitos (Europe) (En,Fr,De) (Disc 2).rvz',
			},
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'gamecube')
		expect(result[0]?.m3uFileName).toBe('Baten Kaitos (Europe) (En,Fr,De).m3u')
	})

	it('does not mistake a region tag for a language tag', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (Europe) (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (Europe) (Disc 2).chd' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'psx')
		expect(result[0]?.baseName).toBe('Game (Europe)')
	})

	it('flags an existing gamecube m3u with CRLF as needing repair', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 1).rvz' },
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 2).rvz' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/RE4 (USA).m3u', {
			'/roms/gamecube/RE4 (USA).m3u': 'RE4 (USA) (Disc 1).rvz\r\nRE4 (USA) (Disc 2).rvz\r\n',
		})
		const result = await detectMultiDiscGames(ssh, 'rb1', 'gamecube')
		expect(result[0]?.m3uAlreadyExists).toBe(true)
		expect(result[0]?.m3uNeedsRepair).toBe(true)
	})

	it('flags an existing gamecube m3u with a \uFEFF as needing repair', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 1).rvz' },
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 2).rvz' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/RE4 (USA).m3u', {
			'/roms/gamecube/RE4 (USA).m3u': '\uFEFFRE4 (USA) (Disc 1).rvz\nRE4 (USA) (Disc 2).rvz\n',
		})
		const result = await detectMultiDiscGames(ssh, 'rb1', 'gamecube')
		expect(result[0]?.m3uNeedsRepair).toBe(true)
	})

	it('leaves a well-formed gamecube m3u alone', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 1).rvz' },
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 2).rvz' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/RE4 (USA).m3u', {
			'/roms/gamecube/RE4 (USA).m3u': 'RE4 (USA) (Disc 1).rvz\nRE4 (USA) (Disc 2).rvz\n',
		})
		const result = await detectMultiDiscGames(ssh, 'rb1', 'gamecube')
		expect(result[0]?.m3uAlreadyExists).toBe(true)
		expect(result[0]?.m3uNeedsRepair).toBe(false)
	})

	it('does not inspect file contents for non-Dolphin systems', async () => {
		mockState.setRows([
			{ system: 'psx', romPath: '/roms/psx/Game (USA) (Disc 1).chd' },
			{ system: 'psx', romPath: '/roms/psx/Game (USA) (Disc 2).chd' },
		])
		const ssh = makeMockSshWithFiles('/roms/psx/Game (USA).m3u', {})
		const result = await detectMultiDiscGames(ssh, 'rb1', 'psx')
		expect(result[0]?.m3uNeedsRepair).toBe(false)
		expect(ssh.exec).toHaveBeenCalledTimes(1)
	})

	it('detects gamecube — Dolphin reads m3u too', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/Resident Evil 4 (USA) (Disc 1).rvz' },
			{ system: 'gamecube', romPath: '/roms/gamecube/Resident Evil 4 (USA) (Disc 2).rvz' },
		])
		const result = await detectMultiDiscGames(makeMockSsh(), 'rb1', 'gamecube')
		expect(result).toHaveLength(1)
		expect(result[0]?.m3uFileName).toBe('Resident Evil 4 (USA).m3u')
	})
})

describe('scanM3u — malformed .m3u without a disc group', () => {
	it('reports a malformed m3u whose discs are absent from the gamelist', async () => {
		// EmulationStation hides the individual discs once an .m3u exists, so the
		// gamelist holds only the .m3u itself — nothing left to group on.
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/Baten Kaitos Origins (USA).m3u' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/Baten Kaitos Origins (USA).m3u', {
			'/roms/gamecube/Baten Kaitos Origins (USA).m3u': 'Disc 1.rvz\r\nDisc 2.rvz\r\n',
		})
		const { candidates, malformed } = await scanM3u(ssh, 'rb1', 'gamecube')

		expect(candidates).toHaveLength(0)
		expect(malformed).toEqual([
			{
				system: 'gamecube',
				romsDir: '/roms/gamecube',
				m3uFileName: 'Baten Kaitos Origins (USA).m3u',
			},
		])
	})

	it('does not report a well-formed m3u without a disc group', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/Baten Kaitos Origins (USA).m3u' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/Baten Kaitos Origins (USA).m3u', {
			'/roms/gamecube/Baten Kaitos Origins (USA).m3u': 'Disc 1.rvz\nDisc 2.rvz\n',
		})
		const { malformed } = await scanM3u(ssh, 'rb1', 'gamecube')
		expect(malformed).toEqual([])
	})

	it('attributes a malformed m3u to its candidate rather than listing it twice', async () => {
		mockState.setRows([
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 1).rvz' },
			{ system: 'gamecube', romPath: '/roms/gamecube/RE4 (USA) (Disc 2).rvz' },
		])
		const ssh = makeMockSshWithFiles('/roms/gamecube/RE4 (USA).m3u', {
			'/roms/gamecube/RE4 (USA).m3u': 'RE4 (USA) (Disc 1).rvz\r\nRE4 (USA) (Disc 2).rvz\r\n',
		})
		const { candidates, malformed } = await scanM3u(ssh, 'rb1', 'gamecube')

		expect(candidates[0]?.m3uNeedsRepair).toBe(true)
		expect(malformed).toEqual([])
	})

	it('ignores non-Dolphin systems entirely', async () => {
		mockState.setRows([{ system: 'psx', romPath: '/roms/psx/Game (USA).m3u' }])
		const ssh = makeMockSshWithFiles('/roms/psx/Game (USA).m3u', {
			'/roms/psx/Game (USA).m3u': 'Game (Disc 1).chd\r\n',
		})
		const { malformed } = await scanM3u(ssh, 'rb1', 'psx')
		expect(malformed).toEqual([])
	})
})
