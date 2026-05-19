import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'

type Messages = Record<string, unknown>

function flattenKeys(obj: Messages, prefix = ''): string[] {
	const keys: string[] = []
	for (const [k, v] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${k}` : k
		if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
			keys.push(...flattenKeys(v as Messages, fullKey))
		} else {
			keys.push(fullKey)
		}
	}
	return keys
}

function extractPlaceholders(str: string): string[] {
	// Extract only top-level ICU variable names: {name} or {name, type, ...}
	// Skip content inside plural/select branches by only matching {word at start
	const matches = str.match(/\{(\w+)[,}]/g) ?? []
	const names = matches.map((m) => m.slice(1).replace(/[,}]$/, '').trim())
	// Deduplicate (FR can use same variable twice for grammatical agreement)
	return [...new Set(names)].sort()
}

const enKeys = flattenKeys(en as unknown as Messages)
const frKeys = flattenKeys(fr as unknown as Messages)

describe('i18n catalogue integrity', () => {
	it('EN and FR have the same keys', () => {
		const onlyInEn = enKeys.filter((k) => !frKeys.includes(k))
		const onlyInFr = frKeys.filter((k) => !enKeys.includes(k))

		if (onlyInEn.length > 0) {
			console.error('Keys only in EN:', onlyInEn)
		}
		if (onlyInFr.length > 0) {
			console.error('Keys only in FR:', onlyInFr)
		}

		expect(onlyInEn).toEqual([])
		expect(onlyInFr).toEqual([])
	})

	it('no empty strings in EN', () => {
		const enFlat = en as unknown as Messages
		const empty = enKeys.filter((k) => {
			const parts = k.split('.')
			let val: unknown = enFlat
			for (const p of parts) val = (val as Messages)[p]
			return typeof val === 'string' && val.trim() === ''
		})
		expect(empty).toEqual([])
	})

	it('no empty strings in FR', () => {
		const frFlat = fr as unknown as Messages
		const empty = frKeys.filter((k) => {
			const parts = k.split('.')
			let val: unknown = frFlat
			for (const p of parts) val = (val as Messages)[p]
			return typeof val === 'string' && val.trim() === ''
		})
		expect(empty).toEqual([])
	})

	it('ICU placeholders are preserved across locales', () => {
		const enFlat = en as unknown as Messages
		const frFlat = fr as unknown as Messages

		const mismatches: string[] = []

		for (const key of enKeys) {
			const parts = key.split('.')
			let enVal: unknown = enFlat
			let frVal: unknown = frFlat
			for (const p of parts) {
				enVal = (enVal as Messages)?.[p]
				frVal = (frVal as Messages)?.[p]
			}

			if (typeof enVal !== 'string' || typeof frVal !== 'string') continue

			const enPlaceholders = extractPlaceholders(enVal).sort()
			const frPlaceholders = extractPlaceholders(frVal).sort()

			if (JSON.stringify(enPlaceholders) !== JSON.stringify(frPlaceholders)) {
				mismatches.push(
					`${key}: EN=${JSON.stringify(enPlaceholders)} FR=${JSON.stringify(frPlaceholders)}`,
				)
			}
		}

		if (mismatches.length > 0) {
			console.error('Placeholder mismatches:', mismatches)
		}
		expect(mismatches).toEqual([])
	})
})
