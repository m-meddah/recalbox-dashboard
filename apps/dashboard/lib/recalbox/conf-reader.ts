import { logger } from '@/lib/logger'
import { shellQuote } from './shell'
import type { SshClientLike } from './ssh-client'

const ALLOWED_CONF_KEYS = [
	'global.retroachievements',
	'global.retroachievements.username',
	'global.retroachievements.hardcore',
] as const

// Keys that may only be checked for presence — their value is NEVER returned via any API.
// Reading these keys must go through dedicated modules (e.g. lib/recalbox/patron-status.ts)
// that expose only derived booleans.
const PRESENCE_ONLY_CONF_KEYS = ['patron.privatekey'] as const

const ALLOWED_CONF_KEYS_SET = new Set(ALLOWED_CONF_KEYS as readonly string[])

type AllowedConfKey = (typeof ALLOWED_CONF_KEYS)[number]

function isAllowed(key: string): key is AllowedConfKey {
	return ALLOWED_CONF_KEYS_SET.has(key)
}

function parseConfValue(output: string, key: string): string | null {
	for (const line of output.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eqIdx = trimmed.indexOf('=')
		if (eqIdx === -1) continue
		const k = trimmed.slice(0, eqIdx).trim()
		if (k === key) return trimmed.slice(eqIdx + 1).trim()
	}
	return null
}

const CONF_PATH = '/recalbox/share/system/recalbox.conf'

export async function readRecalboxConfValue(
	key: string,
	ssh: SshClientLike,
): Promise<string | null> {
	if (!isAllowed(key)) {
		throw new Error(`Key "${key}" is not in the allowed recalbox.conf whitelist`)
	}
	try {
		const output = await ssh.exec(`grep -E '^\\s*${shellQuote(key)}\\s*=' ${CONF_PATH} || true`)
		return parseConfValue(output, key)
	} catch (err) {
		logger.warn(`Failed to read recalbox.conf key "${key}"`, err)
		return null
	}
}

async function readRecalboxConfValues(
	keys: string[],
	ssh: SshClientLike,
): Promise<Record<string, string | null>> {
	const result: Record<string, string | null> = {}
	for (const key of keys) {
		if (!isAllowed(key)) {
			throw new Error(`Key "${key}" is not in the allowed recalbox.conf whitelist`)
		}
	}
	try {
		const output = await ssh.exec(`cat ${CONF_PATH}`)
		for (const key of keys) {
			result[key] = parseConfValue(output, key)
		}
	} catch (err) {
		logger.warn('Failed to read recalbox.conf', err)
		for (const key of keys) result[key] = null
	}
	return result
}

export { isAllowed as isAllowedConfKey }
