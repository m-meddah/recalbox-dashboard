/**
 * Typed, validated read/write of a small set of recalbox.conf keys ("section").
 * Each field declares its type so the engine can decode current values and
 * validate incoming changes — the security boundary that keeps clients from
 * writing arbitrary values (enum allow-lists, int ranges, string patterns).
 */

import { readConfKeys, writeConfKeys } from './conf-keys'

export type FieldSpec =
	| { key: string; type: 'boolean' }
	| { key: string; type: 'int'; min: number; max: number }
	| { key: string; type: 'enum'; options: readonly string[] }
	| { key: string; type: 'string'; pattern: RegExp; maxLen: number }

export type ConfValue = string | number | boolean | null

/** Decode the current values of a section into typed values keyed by conf key. */
export async function readConfSection(
	recalboxId: string,
	specs: readonly FieldSpec[],
): Promise<Record<string, ConfValue>> {
	const raw = await readConfKeys(
		recalboxId,
		specs.map((s) => s.key),
	)
	const out: Record<string, ConfValue> = {}
	for (const spec of specs) {
		const v = raw[spec.key] ?? null
		if (spec.type === 'boolean') {
			out[spec.key] = v === '1'
		} else if (spec.type === 'int') {
			const n = v === null ? null : Number.parseInt(v, 10)
			out[spec.key] = n === null || Number.isNaN(n) ? null : n
		} else {
			// enum | string → raw string or null
			out[spec.key] = v
		}
	}
	return out
}

/**
 * Validate an incoming values map against the section spec. Unprovided keys are
 * left untouched; empty/null clears a key (revert to default). Returns the conf
 * changes map (string values, null to remove) or an error message.
 */
export function validateConfSection(
	specs: readonly FieldSpec[],
	input: unknown,
): { changes: Record<string, string | null> } | { error: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { error: 'Invalid values' }
	}
	const rec = input as Record<string, unknown>
	const changes: Record<string, string | null> = {}

	for (const spec of specs) {
		const v = rec[spec.key]
		if (v === undefined) continue

		if (spec.type === 'boolean') {
			if (typeof v !== 'boolean') return { error: `Invalid ${spec.key}` }
			changes[spec.key] = v ? '1' : '0'
		} else if (spec.type === 'int') {
			if (typeof v !== 'number' || !Number.isInteger(v) || v < spec.min || v > spec.max) {
				return { error: `Invalid ${spec.key}` }
			}
			changes[spec.key] = String(v)
		} else if (spec.type === 'enum') {
			if (v === null || v === '') {
				changes[spec.key] = null
				continue
			}
			if (typeof v !== 'string' || !spec.options.includes(v))
				return { error: `Invalid ${spec.key}` }
			changes[spec.key] = v
		} else {
			// string
			if (v === null || v === '') {
				changes[spec.key] = null
				continue
			}
			if (typeof v !== 'string') return { error: `Invalid ${spec.key}` }
			const trimmed = v.trim()
			if (trimmed.length > spec.maxLen || !spec.pattern.test(trimmed)) {
				return { error: `Invalid ${spec.key}` }
			}
			changes[spec.key] = trimmed
		}
	}

	return { changes }
}

/** Neutral default values for a section, used when the device is unreachable. */
export function defaultConfValues(specs: readonly FieldSpec[]): Record<string, ConfValue> {
	const out: Record<string, ConfValue> = {}
	for (const spec of specs) out[spec.key] = spec.type === 'boolean' ? false : null
	return out
}

/** Write validated changes to recalbox.conf. Returns false if the file is missing. */
export async function writeConfSection(
	recalboxId: string,
	changes: Record<string, string | null>,
): Promise<boolean> {
	return writeConfKeys(recalboxId, changes)
}
