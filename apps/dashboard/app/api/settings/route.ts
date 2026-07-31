import { canControlRecalbox, isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import {
	type AppConfig,
	type DeepPartial,
	PASSWORD_MASK,
	appConfigSchema,
	maskedConfig,
} from '@/lib/settings/schemas'
import { HOST_REGEX } from '@/lib/validation/host'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	return NextResponse.json(maskedConfig(configStore.get()))
}

const putBodySchema = z.object({
	recalbox: z
		.object({
			host: z.string().min(1).regex(HOST_REGEX).optional(),
			sshUser: z.string().min(1).max(32).optional(),
			sshPassword: z.string().min(1).max(128).optional(),
			sshPort: z.number().int().min(1).max(65535).optional(),
			mqttPort: z.number().int().min(1).max(65535).optional(),
		})
		.optional(),
	scrobble: z
		.object({
			minDurationSec: z.number().int().min(0).optional(),
			maxDurationHours: z.number().min(0).optional(),
			orphanRecoveryHours: z.number().min(0).optional(),
		})
		.optional(),
	ui: z
		.object({
			locale: z.string().min(2).max(10).optional(),
			theme: z.enum(['light', 'dark', 'system']).optional(),
			weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
		})
		.optional(),
	retroachievements: z
		.object({
			enabled: z.boolean().optional(),
			username: z.string().max(64).optional(),
			apiKey: z.string().max(256).optional(),
			autoSyncMinutes: z.number().int().min(1).max(1440).optional(),
		})
		.optional(),
	superRetrogamers: z
		.object({
			enabled: z.boolean().optional(),
			apiUrl: z
				.string()
				.max(256)
				.refine((v) => v === '' || /^https?:\/\/.+/.test(v), {
					message: 'Must be a valid HTTP(S) URL',
				})
				.optional(),
			apiKey: z.string().max(256).optional(),
			preferredRegion: z.enum(['FR', 'EU', 'WOR', 'US', 'JP', 'ASI', '']).optional(),
		})
		.optional(),
	mqttPublish: z
		.object({
			enabled: z.boolean().optional(),
			brokerUrl: z
				.string()
				.max(256)
				.refine((v) => v === '' || /^mqtts?:\/\/.+/.test(v), {
					message: 'Must be a valid MQTT(S) URL',
				})
				.optional(),
			topicPrefix: z.string().max(64).optional(),
			homeAssistantDiscovery: z.boolean().optional(),
		})
		.optional(),
})

const SHARED_SCOPES = [
	'scrobble',
	'retroachievements',
	'superRetrogamers',
	'mqttPublish',
] as const satisfies readonly (keyof AppConfig)[]

export async function PUT(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}

	const parsed = putBodySchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
	}

	const partial = parsed.data as DeepPartial<AppConfig>

	// Shared infrastructure, not per-user preference: these scopes hold API keys AND the
	// outbound endpoints those keys are sent to. A member repointing superRetrogamers.apiUrl
	// (or mqttPublish.brokerUrl) at a host they run would ship the stored key straight to
	// them — the same exfiltration shape F1 closed on the SSH password. Admin only.
	// `ui` stays open: it is cosmetic and holds no secret. `recalbox` is owner-gated below.
	const touchesSharedScope = SHARED_SCOPES.some(
		(scope) => partial[scope] && Object.keys(partial[scope]).length > 0,
	)
	if (touchesSharedScope && !isAdmin(user)) return forbidden()

	// Do not overwrite password if the client sent the mask sentinel
	if (partial.recalbox?.sshPassword === PASSWORD_MASK) {
		const { sshPassword: _omit, ...recalboxWithoutPassword } = partial.recalbox
		partial.recalbox = recalboxWithoutPassword
	}

	// Do not overwrite apiKey if the client sent the mask sentinel
	if (partial.retroachievements?.apiKey === PASSWORD_MASK) {
		const { apiKey: _omit, ...raWithoutKey } = partial.retroachievements
		partial.retroachievements = raWithoutKey
	}
	if (partial.superRetrogamers?.apiKey === PASSWORD_MASK) {
		const { apiKey: _omit, ...srWithoutKey } = partial.superRetrogamers
		partial.superRetrogamers = srWithoutKey
	}

	// Persist recalbox connection fields to the recalboxes table (the settings
	// table intentionally skips the recalbox scope, so without this the password
	// would only survive until the next server restart).
	//
	// Target the ACTIVE box, never the global default: the default may belong to
	// somebody else, and this scope rewrites SSH connection details — repointing
	// `host` at a host the caller runs would harvest the stored password on the next
	// connection. Owner only, admins included (canControlRecalbox enforces both).
	if (partial.recalbox && Object.keys(partial.recalbox).length > 0) {
		const recalboxId = await getActiveRecalboxId()
		if (!recalboxId || !(await canControlRecalbox(user, recalboxId))) return forbidden()
		await configStore.updateRecalboxConfig(recalboxId, partial.recalbox)
	}

	const updated = await configStore.update(partial)
	return NextResponse.json(maskedConfig(updated))
}
