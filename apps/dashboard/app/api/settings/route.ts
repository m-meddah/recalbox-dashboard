import { configStore } from '@/lib/config-store'
import {
	type AppConfig,
	type DeepPartial,
	PASSWORD_MASK,
	appConfigSchema,
	maskedConfig,
} from '@/lib/settings/schemas'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	return NextResponse.json(maskedConfig(configStore.get()))
}

const putBodySchema = z.object({
	recalbox: z
		.object({
			host: z
				.string()
				.min(1)
				.regex(/^[a-zA-Z0-9.-]+$/)
				.optional(),
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
			apiUrl: z.string().max(256).optional(),
			preferredRegion: z.enum(['US', 'EU', 'JP', '']).optional(),
		})
		.optional(),
	mqttPublish: z
		.object({
			enabled: z.boolean().optional(),
			brokerUrl: z.string().max(256).optional(),
			topicPrefix: z.string().max(64).optional(),
			homeAssistantDiscovery: z.boolean().optional(),
		})
		.optional(),
})

export async function PUT(req: NextRequest) {
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

	// Persist recalbox connection fields to the recalboxes table (the settings
	// table intentionally skips the recalbox scope, so without this the password
	// would only survive until the next server restart).
	if (partial.recalbox && Object.keys(partial.recalbox).length > 0) {
		const defaultRb = configStore.getDefaultRecalbox()
		if (defaultRb) {
			configStore.updateRecalboxConfig(defaultRb.id, partial.recalbox)
		}
	}

	const updated = configStore.update(partial)
	return NextResponse.json(maskedConfig(updated))
}
