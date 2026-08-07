import { inflateSync } from 'node:zlib'
import type { RomFileRow } from '@/lib/db/rom-audit-queries'
import { describe, expect, it } from 'vitest'
import {
	MAX_CACHE_BYTES,
	type ScanCache,
	buildScanCache,
	encodeScanCache,
	withScanCache,
} from '../scan-cache'

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function row(over: Partial<RomFileRow> = {}): RomFileRow {
	const path = over.path ?? '/recalbox/share/roms/snes/Game.sfc'
	return {
		recalboxId: 'rb1',
		entryKey: path,
		system: 'snes',
		mount: '/recalbox/share',
		path,
		innerName: null,
		size: 1048576,
		mtime: 1721900000,
		kind: 'raw',
		crc32: 'e95a3dd7',
		sha1: null,
		serial: null,
		matchLevel: 'verified',
		datEntryName: 'Game (Europe).sfc',
		canonicalTitle: 'Game',
		scannedAt: SCANNED_AT,
		...over,
	}
}

function decode(payload: string): ScanCache {
	return JSON.parse(inflateSync(Buffer.from(payload, 'base64')).toString('utf-8'))
}

describe('buildScanCache', () => {
	it('indexes a cacheable file by its path', () => {
		const cache = buildScanCache([row()])
		expect(cache['/recalbox/share/roms/snes/Game.sfc']).toEqual({
			size: 1048576,
			mtime: 1721900000,
			crc32: 'e95a3dd7',
			kind: 'raw',
		})
	})

	it('keeps an arcade container', () => {
		const cache = buildScanCache([row({ path: '/m/roms/mame/005.zip', kind: 'container' })])
		expect(cache['/m/roms/mame/005.zip']?.kind).toBe('container')
	})

	// The cheap strategies gain nothing from a cache — and worse, `rom_files`
	// stores neither rawSha1 nor the disc fields, so rebuilding a CHD or RVZ
	// entry from it would silently drop what the serial matching needs.
	it('ignores the kinds whose fields the database does not keep', () => {
		const cache = buildScanCache([
			row({ path: '/a.chd', kind: 'chd' }),
			row({ path: '/b.rvz', kind: 'rvz' }),
			row({ path: '/c.zip', kind: 'zip-entry', innerName: 'c.sfc' }),
			row({ path: '/d.7z', kind: 'sevenzip-entry', innerName: 'd.nes' }),
		])
		expect(cache).toEqual({})
	})

	// Without a hash there is nothing to reuse; re-reading is the only option.
	it('ignores a row that carries no crc32', () => {
		expect(buildScanCache([row({ crc32: null })])).toEqual({})
	})

	it('carries nothing the audit deduced, only what identifies the file', () => {
		const entry = buildScanCache([row()])['/recalbox/share/roms/snes/Game.sfc']
		expect(entry).not.toHaveProperty('matchLevel')
		expect(entry).not.toHaveProperty('datEntryName')
		expect(entry).not.toHaveProperty('canonicalTitle')
	})

	it('is empty for a system never scanned', () => {
		expect(buildScanCache([])).toEqual({})
	})
})

describe('encodeScanCache', () => {
	it('round-trips through deflate and base64', () => {
		const cache = buildScanCache([row(), row({ path: '/b.sfc' })])
		const encoded = encodeScanCache(cache)
		if (encoded.status !== 'ok') throw new Error('expected ok')
		expect(decode(encoded.payload)).toEqual(cache)
	})

	// It travels inside a Python string literal: anything outside the base64
	// alphabet would need escaping, and a stray quote would break the program.
	it('produces a python-safe literal', () => {
		const encoded = encodeScanCache(buildScanCache([row()]))
		if (encoded.status !== 'ok') throw new Error('expected ok')
		expect(encoded.payload).toMatch(/^[A-Za-z0-9+/=]+$/)
	})

	it('shrinks a realistic cache by an order of magnitude', () => {
		const rows = Array.from({ length: 8000 }, (_, i) =>
			row({
				path: `/recalbox/share/externals/usb1/recalbox/roms/fbneo/game${i}.zip`,
				kind: 'container',
			}),
		)
		const cache = buildScanCache(rows)
		const raw = JSON.stringify(cache).length
		const encoded = encodeScanCache(cache)
		if (encoded.status !== 'ok') throw new Error('expected ok')
		expect(Object.keys(cache)).toHaveLength(8000)
		expect(encoded.payload.length).toBeLessThan(raw / 5)
	})

	// Measured on the box: 2,3 MB of stdin went through intact. The guard is a
	// safety net against a degenerate payload, not a transport limit.
	//
	// Explicit timeout: building 400k incompressible entries and deflating them takes
	// ~2.6s on an idle machine, under vitest's 5s default. That margin is too thin —
	// the test flaked whenever the suite competed for CPU. The cost is inherent (the
	// payload must exceed MAX_CACHE_BYTES *after* deflate, so the entropy is the
	// point), so widen the budget rather than shrink the fixture.
	it('refuses a cache beyond the guard rather than sending it', () => {
		const cache: ScanCache = {}
		for (let i = 0; i < 400_000; i++) {
			// Random-ish paths so deflate cannot compress the payload away.
			cache[`/${Math.random().toString(36)}/${i}/${Math.random().toString(36)}.zip`] = {
				size: i,
				mtime: i,
				crc32: (i % 0xffffffff).toString(16).padStart(8, '0'),
				kind: 'container',
			}
		}
		const encoded = encodeScanCache(cache)
		expect(encoded.status).toBe('too-large')
		if (encoded.status !== 'too-large') throw new Error('expected too-large')
		expect(encoded.bytes).toBeGreaterThan(MAX_CACHE_BYTES)
	}, 30_000)

	it('encodes an empty cache without complaining', () => {
		const encoded = encodeScanCache({})
		if (encoded.status !== 'ok') throw new Error('expected ok')
		expect(decode(encoded.payload)).toEqual({})
	})
})

describe('withScanCache', () => {
	it('puts the assignment before the script so it wins', () => {
		const program = withScanCache('#!/usr/bin/env python3\nprint(1)\n', 'QUJD')
		expect(program.startsWith("CACHE_B64 = 'QUJD'\n")).toBe(true)
		expect(program).toContain('#!/usr/bin/env python3')
	})
})
