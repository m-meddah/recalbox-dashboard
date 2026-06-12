import { logger } from '@/lib/logger'
import { RECALBOX_CONF_PATH, extractConfKeysBySuffix } from './recalbox-conf-editor'
import { shellQuote } from './shell'
import { getSshClient } from './ssh-client'

export type SystemEmulatorOverride = { emulator: string | null; core: string | null }

/**
 * Read the per-system emulator/core overrides set in recalbox.conf, keyed by
 * system id (excludes the `global` default). Best-effort: returns {} when the
 * box is unreachable. Shared by the API route and the server-rendered catalog.
 */
export async function readSystemEmulatorOverrides(
	recalboxId: string,
): Promise<Record<string, SystemEmulatorOverride>> {
	try {
		const ssh = getSshClient(recalboxId)
		const conf = await ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000)
		const overrides: Record<string, SystemEmulatorOverride> = {}
		const add = (fullKey: string, suffix: string, field: 'emulator' | 'core', value: string) => {
			const system = fullKey.slice(0, -suffix.length)
			if (system === 'global') return
			overrides[system] ??= { emulator: null, core: null }
			overrides[system][field] = value
		}
		for (const [k, v] of Object.entries(extractConfKeysBySuffix(conf, '.emulator'))) {
			add(k, '.emulator', 'emulator', v)
		}
		for (const [k, v] of Object.entries(extractConfKeysBySuffix(conf, '.core'))) {
			add(k, '.core', 'core', v)
		}
		return overrides
	} catch (err) {
		logger.warn('readSystemEmulatorOverrides failed', err)
		return {}
	}
}
