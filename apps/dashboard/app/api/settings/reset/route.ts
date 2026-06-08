import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { type AppConfig, maskedConfig } from '@/lib/settings/schemas'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
	scope: z.enum(['recalbox', 'scrobble', 'ui']).optional(),
})

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	let body: unknown = {}
	try {
		body = await req.json()
	} catch {
		// empty body is fine
	}

	const parsed = bodySchema.safeParse(body)
	const scope = parsed.success ? parsed.data.scope : undefined

	const updated = configStore.reset(scope as keyof AppConfig | undefined)
	return NextResponse.json(maskedConfig(updated))
}
