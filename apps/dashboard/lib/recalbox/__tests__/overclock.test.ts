import { describe, expect, it } from 'vitest'
import { boardFromModel, parseProfileList, parseThrottle, profileBasename } from '../overclock'

describe('boardFromModel', () => {
	it('maps Raspberry Pi models to board ids', () => {
		expect(boardFromModel('Raspberry Pi 5 Model B Rev 1.1')).toBe('rpi5')
		expect(boardFromModel('Raspberry Pi 4 Model B')).toBe('rpi4')
		expect(boardFromModel('Raspberry Pi 3 Model B Plus')).toBe('rpi3')
	})

	it('returns null for non-Pi or unknown boards', () => {
		expect(boardFromModel('Hardkernel ODROID-XU4')).toBeNull()
		expect(boardFromModel(null)).toBeNull()
		expect(boardFromModel('Raspberry Pi Zero')).toBeNull()
	})
})

describe('parseThrottle', () => {
	it('decodes a healthy status', () => {
		expect(parseThrottle('throttled=0x0')).toEqual({
			raw: '0x0',
			underVoltageNow: false,
			throttledNow: false,
			underVoltageOccurred: false,
			throttledOccurred: false,
		})
	})

	it('decodes active throttling and past events', () => {
		// 0x4 = throttled now, 0x40000 = throttling occurred, 0x1 = under-voltage now
		const s = parseThrottle('throttled=0x40005')
		expect(s).not.toBeNull()
		expect(s?.throttledNow).toBe(true)
		expect(s?.underVoltageNow).toBe(true)
		expect(s?.throttledOccurred).toBe(true)
		expect(s?.underVoltageOccurred).toBe(false)
	})

	it('returns null for unparseable input', () => {
		expect(parseThrottle('')).toBeNull()
		expect(parseThrottle(null)).toBeNull()
		expect(parseThrottle('nope')).toBeNull()
	})
})

describe('profileBasename', () => {
	it('strips directory and .txt suffix', () => {
		expect(profileBasename('/recalbox/system/configs/overclocking/rpi5/high.txt')).toBe('high')
		expect(profileBasename('medium.txt')).toBe('medium')
		expect(profileBasename(null)).toBeNull()
	})
})

describe('parseProfileList', () => {
	it('extracts sorted basenames from ls output', () => {
		const raw =
			'/recalbox/system/configs/overclocking/rpi5/medium.txt\n' +
			'/recalbox/system/configs/overclocking/rpi5/high.txt\n'
		expect(parseProfileList(raw)).toEqual(['high', 'medium'])
	})

	it('returns [] for empty output', () => {
		expect(parseProfileList('')).toEqual([])
	})
})
