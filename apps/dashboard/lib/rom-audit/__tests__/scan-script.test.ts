import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCAN_SCRIPT } from '../scan-script'

const PYTHON_SOURCE = path.resolve(__dirname, '../../../../../agent/scan_roms.py')

describe('SCAN_SCRIPT', () => {
	// The generated module is the only copy shipped to the box. If someone edits
	// the .py and forgets to regenerate, the box would silently run the old
	// script — this test is what catches that.
	it('matches agent/scan_roms.py byte for byte', () => {
		expect(SCAN_SCRIPT).toBe(readFileSync(PYTHON_SOURCE, 'utf-8'))
	})

	it('carries a runnable python script', () => {
		expect(SCAN_SCRIPT.startsWith('#!/usr/bin/env python3')).toBe(true)
		expect(SCAN_SCRIPT).toContain('--target')
	})

	// The whole point of generating a .ts: no filesystem access at runtime, so
	// the module survives the Next.js bundler in plan 2B.
	it('is embedded, not read from disk at runtime', () => {
		const module = readFileSync(path.resolve(__dirname, '../scan-script.ts'), 'utf-8')
		expect(module).not.toContain('readFileSync')
	})
})
