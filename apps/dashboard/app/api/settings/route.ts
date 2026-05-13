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

	const updated = configStore.update(partial)
	return NextResponse.json(maskedConfig(updated))
}
