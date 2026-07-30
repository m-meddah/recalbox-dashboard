import { z } from 'zod'

/** Power actions the agent is allowed to perform on the device. */
export const POWER_ACTIONS = ['reboot', 'shutdown'] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]

/**
 * recalbox.conf keys are dotted alphanumerics. Reject anything that could break
 * out of a single `key=value` INI line (whitespace, `=`, newlines, quotes, …).
 */
const CONF_KEY_RE = /^[A-Za-z0-9._-]+$/
/** A conf value stays on one line — no CR/LF. */
const CONF_VALUE_RE = /^[^\r\n]*$/

/**
 * A system id is a `/roms` directory name: no separator, no traversal, no
 * control character. Real disks carry `@eaDir` and hand-made folders, so this
 * is a safety guard rather than a slug whitelist.
 */
const SYSTEM_ID_RE = /^[^/\\\r\n\t\0]+$/

/**
 * Allowlist of remote-control commands. This is the authoritative (server-side)
 * definition of what may be queued: the enqueue route validates against it, so a
 * user can never queue an arbitrary action and the agent only ever dispatches a
 * known, bounded command — never a raw shell string.
 */
export const commandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('power'), action: z.enum(POWER_ACTIONS) }),
	z.object({
		type: z.literal('launch'),
		romPath: z.string().min(1).max(1024),
		system: z.string().min(1).max(64),
	}),
	z.object({
		type: z.literal('conf'),
		key: z.string().min(1).max(128).regex(CONF_KEY_RE),
		value: z.string().max(1024).regex(CONF_VALUE_RE),
	}),
	// A ROM audit scan. It carries NO path: the box discovers its own disks, so
	// nothing the cloud sends here ever reaches an open(). `systems` is a bounded
	// list of `/roms` directory names, guarded like the manifest's system id.
	z.object({
		type: z.literal('scan'),
		scanId: z.string().min(1).max(64),
		systems: z.array(z.string().min(1).max(64).regex(SYSTEM_ID_RE)).max(256).optional(),
	}),
])

export type AgentCommand = z.infer<typeof commandSchema>
export type CommandType = AgentCommand['type']

/** Split a validated command into the queue's `(type, payload)` columns. */
export function toQueuePayload(cmd: AgentCommand): {
	type: CommandType
	payload: Record<string, unknown>
} {
	const { type, ...payload } = cmd
	return { type, payload }
}
