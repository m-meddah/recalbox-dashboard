#!/usr/bin/env tsx
import { sql } from 'drizzle-orm'
import { db } from '../lib/db/index'
import { sessions } from '../lib/db/schema'

const SYSTEMS = ['snes', 'nes', 'gba', 'psx', 'megadrive', 'n64', 'arcade', 'gb', 'gbc', 'nds']

const GAMES: Record<string, string[]> = {
	snes: ['Super Mario World', 'Zelda: A Link to the Past', 'Donkey Kong Country', 'Super Metroid'],
	nes: ['Super Mario Bros', 'Contra', 'Mega Man 2', 'Castlevania'],
	gba: ['Pokemon FireRed', 'Metroid Fusion', 'Kirby & The Amazing Mirror', 'Mother 3'],
	psx: ['Final Fantasy VII', 'Metal Gear Solid', 'Crash Bandicoot', 'Tekken 3'],
	megadrive: ['Sonic The Hedgehog', 'Streets of Rage', 'Phantasy Star IV', 'Gunstar Heroes'],
	n64: ['Super Mario 64', 'Ocarina of Time', 'GoldenEye 007', 'Paper Mario'],
	arcade: ['Street Fighter II', 'Pac-Man', 'Galaga', 'CPS1 game'],
	gb: ['Tetris', 'Pokemon Red', 'Kirby Dream Land'],
	gbc: ['Pokemon Crystal', 'Dragon Warrior Monsters'],
	nds: ['Pokemon Diamond', 'New Super Mario Bros', 'Castlevania Order of Ecclesia'],
}

function rand(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
	const idx = Math.floor(Math.random() * arr.length)
	const item = arr[idx]
	if (item === undefined) throw new Error('pick called on empty array')
	return item
}

const isClear = process.argv.includes('--clear')

async function main() {
	if (isClear) {
		await db.delete(sessions).where(sql`${sessions.romPath} LIKE 'seed/%'`)
		console.log('Cleared seed sessions.')
		return
	}

	const now = Date.now()
	const rows = []

	for (let i = 0; i < 200; i++) {
		const system = pick(SYSTEMS)
		const gameList = GAMES[system] ?? ['Unknown Game']
		const gameName = pick(gameList)
		const romPath = `seed/${system}/${gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.rom`

		// Random start in last 90 days, with gaps (not every day has sessions)
		const daysAgo = rand(0, 89)
		// Bias toward recent days
		const biasedDaysAgo = Math.floor((daysAgo * daysAgo) / 89)
		const startOffset = biasedDaysAgo * 86400 + rand(0, 86400)
		const startedAt = new Date(now - startOffset * 1000)

		// Duration: 5 minutes to 3 hours, weighted toward shorter sessions
		const baseDuration = rand(300, 10800)
		const durationSeconds = Math.floor(baseDuration * (0.3 + Math.random() * 0.7))

		const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000)

		rows.push({
			gameId: null,
			startedAt,
			endedAt,
			durationSeconds,
			system,
			romPath,
			autoClosed: false,
			closedReason: null,
		})
	}

	// Sort by startedAt for cleaner DB ordering
	rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())

	await db.insert(sessions).values(rows)
	console.log(`Seeded ${rows.length} fake sessions across ${SYSTEMS.length} systems.`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
