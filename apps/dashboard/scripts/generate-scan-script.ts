#!/usr/bin/env tsx

/**
 * Embeds `agent/scan_roms.py` into a TypeScript module.
 *
 * Reading the .py at runtime works under tsx and Vitest but not once the Next.js
 * bundler takes over: a .py is not a known asset and the relative path does not
 * outlive the build. Generating a .ts removes the filesystem from the runtime
 * path entirely.
 *
 * The source is carried base64-encoded rather than as a template literal, so no
 * backtick, backslash or `${` in the Python source can ever break the generated
 * module.
 *
 * `scan-script.test.ts` fails if the generated file drifts from the .py, so a
 * forgotten regeneration is caught by the test suite rather than in production.
 *
 * Usage: pnpm --filter @recalbox/dashboard gen:scan-script
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SOURCE = path.resolve(__dirname, '../../../agent/scan_roms.py')
const TARGET = path.resolve(__dirname, '../lib/rom-audit/scan-script.generated.ts')

function main() {
	const python = readFileSync(SOURCE, 'utf-8')
	const encoded = Buffer.from(python, 'utf-8').toString('base64')

	const lines = [
		'// GENERATED FILE — do not edit by hand.',
		'// Source: agent/scan_roms.py',
		'// Regenerate: pnpm --filter @recalbox/dashboard gen:scan-script',
		'//',
		'// Base64 so nothing in the Python source can break this module, and so the',
		'// scan script needs no filesystem access at runtime.',
		'',
		`export const SCAN_SCRIPT_BASE64 = '${encoded}'`,
		'',
	]

	writeFileSync(TARGET, lines.join('\n'), 'utf-8')
	console.log(`wrote ${path.relative(process.cwd(), TARGET)} (${python.length} bytes of python)`)
}

main()
