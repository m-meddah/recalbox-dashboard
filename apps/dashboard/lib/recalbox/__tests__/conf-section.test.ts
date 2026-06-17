import { afterEach, describe, expect, it, vi } from 'vitest'

const readConfKeys = vi.fn()
vi.mock('../conf-keys', () => ({
	readConfKeys: (...a: unknown[]) => readConfKeys(...a),
	writeConfKeys: vi.fn(),
}))

import {
	type FieldSpec,
	defaultConfValues,
	readConfSection,
	validateConfSection,
} from '../conf-section'

const SPECS: FieldSpec[] = [
	{ key: 'a.bool', type: 'boolean' },
	{ key: 'a.port', type: 'int', min: 1024, max: 65535 },
	{ key: 'a.set', type: 'enum', options: ['none', 'retro'] },
	{ key: 'a.name', type: 'string', pattern: /^[^\n\r]*$/, maxLen: 8 },
]

afterEach(() => readConfKeys.mockReset())

describe('validateConfSection', () => {
	it('encodes booleans as 0/1', () => {
		expect(validateConfSection(SPECS, { 'a.bool': true })).toEqual({ changes: { 'a.bool': '1' } })
		expect(validateConfSection(SPECS, { 'a.bool': false })).toEqual({ changes: { 'a.bool': '0' } })
	})

	it('rejects a non-boolean for a boolean field', () => {
		expect(validateConfSection(SPECS, { 'a.bool': 'yes' })).toEqual({ error: 'Invalid a.bool' })
	})

	it('validates int range', () => {
		expect(validateConfSection(SPECS, { 'a.port': 55435 })).toEqual({
			changes: { 'a.port': '55435' },
		})
		expect(validateConfSection(SPECS, { 'a.port': 80 })).toEqual({ error: 'Invalid a.port' })
		expect(validateConfSection(SPECS, { 'a.port': 1.5 })).toEqual({ error: 'Invalid a.port' })
	})

	it('enforces enum allow-list (anti arbitrary value)', () => {
		expect(validateConfSection(SPECS, { 'a.set': 'retro' })).toEqual({
			changes: { 'a.set': 'retro' },
		})
		expect(validateConfSection(SPECS, { 'a.set': 'evil; rm -rf /' })).toEqual({
			error: 'Invalid a.set',
		})
		expect(validateConfSection(SPECS, { 'a.set': null })).toEqual({ changes: { 'a.set': null } })
	})

	it('validates string pattern and length, empty clears the key', () => {
		expect(validateConfSection(SPECS, { 'a.name': ' Bob ' })).toEqual({
			changes: { 'a.name': 'Bob' },
		})
		expect(validateConfSection(SPECS, { 'a.name': 'toolongname' })).toEqual({
			error: 'Invalid a.name',
		})
		expect(validateConfSection(SPECS, { 'a.name': 'a\nb' })).toEqual({ error: 'Invalid a.name' })
		expect(validateConfSection(SPECS, { 'a.name': '' })).toEqual({ changes: { 'a.name': null } })
	})

	it('skips unprovided keys and rejects non-object input', () => {
		expect(validateConfSection(SPECS, { 'a.bool': true })).toEqual({ changes: { 'a.bool': '1' } })
		expect(validateConfSection(SPECS, null)).toEqual({ error: 'Invalid values' })
		expect(validateConfSection(SPECS, [])).toEqual({ error: 'Invalid values' })
	})
})

describe('readConfSection', () => {
	it('decodes raw conf strings into typed values', async () => {
		readConfKeys.mockResolvedValue({
			'a.bool': '1',
			'a.port': '55435',
			'a.set': 'retro',
			'a.name': null,
		})
		expect(await readConfSection('rb-1', SPECS)).toEqual({
			'a.bool': true,
			'a.port': 55435,
			'a.set': 'retro',
			'a.name': null,
		})
	})
})

describe('defaultConfValues', () => {
	it('uses false for booleans and null otherwise', () => {
		expect(defaultConfValues(SPECS)).toEqual({
			'a.bool': false,
			'a.port': null,
			'a.set': null,
			'a.name': null,
		})
	})
})
