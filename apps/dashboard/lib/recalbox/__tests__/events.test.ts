import { describe, expect, it } from 'vitest'
import { parseRecalboxMessage } from '../events'

const ES_TOPIC = 'Recalbox/WebAPI/EmulationStation/Event'

function buf(json: unknown): Buffer {
	return Buffer.from(JSON.stringify(json), 'utf-8')
}

const baseSystem = {
	name: 'neogeo',
	fullname: 'Neo-Geo AES',
	defaultEmulator: 'libretro',
	defaultCore: 'fbneo',
}

const baseGame = {
	romPath: '/recalbox/share/roms/neogeo/2020bb.zip',
	name: '2020 Super Baseball',
}

const baseMedia = {
	image: '/recalbox/share/roms/neogeo/media/images/2020bb.png',
	thumbnail: '',
	video: '',
}

// --- Nominal cases ---

describe('rungame', () => {
	it('maps to game:start with all fields', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({
				event: 'rungame',
				param: baseGame.romPath,
				system: baseSystem,
				game: baseGame,
				media: baseMedia,
			}),
		)
		expect(result?.type).toBe('game:start')
		if (result?.type !== 'game:start') return
		expect(result.system).toBe('neogeo')
		expect(result.systemFullName).toBe('Neo-Geo AES')
		expect(result.gameName).toBe('2020 Super Baseball')
		expect(result.romPath).toBe(baseGame.romPath)
		expect(result.imagePath).toBe(baseMedia.image)
		expect(result.emulator).toBe('libretro')
		expect(result.startedAt).toBeInstanceOf(Date)
	})

	it('sets imagePath to undefined when media.image is empty', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({
				event: 'rungame',
				param: '',
				system: baseSystem,
				game: baseGame,
				media: { ...baseMedia, image: '' },
			}),
		)
		expect(result?.type).toBe('game:start')
		if (result?.type !== 'game:start') return
		expect(result.imagePath).toBeUndefined()
	})
})

describe('endgame', () => {
	it('maps to game:stop', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({
				event: 'endgame',
				param: baseGame.romPath,
				system: baseSystem,
				game: baseGame,
				media: baseMedia,
			}),
		)
		expect(result?.type).toBe('game:stop')
		if (result?.type !== 'game:stop') return
		expect(result.gameName).toBe('2020 Super Baseball')
		expect(result.romPath).toBe(baseGame.romPath)
		expect(result.stoppedAt).toBeInstanceOf(Date)
	})
})

describe('gamebrowsing', () => {
	it('maps to system:change with system and game info', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({
				event: 'gamebrowsing',
				param: '',
				system: baseSystem,
				game: baseGame,
				media: baseMedia,
			}),
		)
		expect(result?.type).toBe('system:change')
		if (result?.type !== 'system:change') return
		expect(result.system).toBe('neogeo')
		expect(result.systemFullName).toBe('Neo-Geo AES')
		expect(result.gameName).toBe('2020 Super Baseball')
		expect(result.imagePath).toBe(baseMedia.image)
	})

	it('sets gameName and imagePath to undefined when empty', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({
				event: 'gamebrowsing',
				param: '',
				system: baseSystem,
				game: { ...baseGame, name: '' },
				media: { ...baseMedia, image: '' },
			}),
		)
		expect(result?.type).toBe('system:change')
		if (result?.type !== 'system:change') return
		expect(result.gameName).toBeUndefined()
		expect(result.imagePath).toBeUndefined()
	})
})

describe('sleep / wakeup', () => {
	it('sleep maps to screensaver:start', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({ event: 'sleep', param: '', system: baseSystem, game: baseGame, media: baseMedia }),
		)
		expect(result?.type).toBe('screensaver:start')
	})

	it('wakeup maps to screensaver:stop', () => {
		const result = parseRecalboxMessage(
			ES_TOPIC,
			buf({ event: 'wakeup', param: '', system: baseSystem, game: baseGame, media: baseMedia }),
		)
		expect(result?.type).toBe('screensaver:stop')
	})
})

// --- Unknown event type ---

it('returns null for unknown event string', () => {
	const result = parseRecalboxMessage(
		ES_TOPIC,
		buf({ event: 'unknownevent', param: '', system: baseSystem, game: baseGame, media: baseMedia }),
	)
	expect(result).toBeNull()
})

// --- Wrong topic ---

it('returns null for unrelated topic', () => {
	const result = parseRecalboxMessage(
		'Recalbox/WebAPI/SystemInfo',
		buf({ event: 'rungame', param: '', system: baseSystem, game: baseGame, media: baseMedia }),
	)
	expect(result).toBeNull()
})

it('returns null for the legacy plain-text topic', () => {
	const result = parseRecalboxMessage('Recalbox/EmulationStation/Event', Buffer.from('rungame'))
	expect(result).toBeNull()
})

// --- Degenerate payloads ---

it('returns null for empty payload', () => {
	expect(parseRecalboxMessage(ES_TOPIC, Buffer.from(''))).toBeNull()
})

it('returns null for invalid JSON', () => {
	expect(parseRecalboxMessage(ES_TOPIC, Buffer.from('{not json}'))).toBeNull()
})

it('returns null for JSON that is not an object', () => {
	expect(parseRecalboxMessage(ES_TOPIC, buf(42))).toBeNull()
	expect(parseRecalboxMessage(ES_TOPIC, buf(null))).toBeNull()
	expect(parseRecalboxMessage(ES_TOPIC, buf([]))).toBeNull()
})

// --- EmulationStation double-publish quirk ---

it('parses the first JSON when payload contains two concatenated JSON objects (ES double-publish bug)', () => {
	const single = JSON.stringify({
		event: 'rungame',
		param: baseGame.romPath,
		system: baseSystem,
		game: baseGame,
		media: baseMedia,
	})
	const double = Buffer.from(single + single, 'utf-8')
	const result = parseRecalboxMessage(ES_TOPIC, double)
	expect(result?.type).toBe('game:start')
	if (result?.type !== 'game:start') return
	expect(result.gameName).toBe('2020 Super Baseball')
})

// --- Missing fields ---

it('returns null when required fields are missing', () => {
	// Missing game field
	expect(
		parseRecalboxMessage(ES_TOPIC, buf({ event: 'rungame', system: baseSystem, media: baseMedia })),
	).toBeNull()
	// Missing system field
	expect(
		parseRecalboxMessage(ES_TOPIC, buf({ event: 'rungame', game: baseGame, media: baseMedia })),
	).toBeNull()
})
