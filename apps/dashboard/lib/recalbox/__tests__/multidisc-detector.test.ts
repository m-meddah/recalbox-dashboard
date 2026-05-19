import { describe, expect, it } from 'vitest'
import { detectDiscInfo } from '../multidisc-detector'

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
