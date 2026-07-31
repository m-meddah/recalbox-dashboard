import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
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
	const user = await getUser()
	if (!user) return unauthorized()
	// An omitted `scope` resets EVERY scope, wiping the shared API keys along with it.
	// Destructive and global either way — admin only.
	if (!isAdmin(user)) return forbidden()
	let body: unknown = {}
	try {
		body = await req.json()
	} catch {
		// empty body is fine
	}

	const parsed = bodySchema.safeParse(body)
	const scope = parsed.success ? parsed.data.scope : undefined

	const updated = await configStore.reset(scope as keyof AppConfig | undefined)
	return NextResponse.json(maskedConfig(updated))
}
