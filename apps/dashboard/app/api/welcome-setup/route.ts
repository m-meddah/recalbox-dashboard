import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { HOST_REGEX } from '@/lib/validation/host'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const formSchema = z.object({
	host: z.string().min(1).regex(HOST_REGEX),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(1).max(128),
	sshPort: z.coerce.number().int().min(1).max(65535).default(22),
	mqttPort: z.coerce.number().int().min(1).max(65535).default(1883),
})

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	let fields: Record<string, string>
	try {
		const data = await req.formData()
		fields = Object.fromEntries(data.entries()) as Record<string, string>
	} catch {
		return NextResponse.redirect(new URL('/en/welcome?error=invalid', req.url))
	}

	const parsed = formSchema.safeParse(fields)
	if (!parsed.success) {
		return NextResponse.redirect(new URL('/en/welcome?error=validation', req.url))
	}

	const { host, sshUser, sshPassword, sshPort, mqttPort } = parsed.data

	configStore.addRecalbox({
		name: 'My Recalbox',
		host,
		sshUser,
		sshPassword,
		sshPort,
		mqttPort,
		color: null,
		iconEmoji: '🕹️',
	})
	configStore.markSetupComplete()

	const locale = req.cookies.get('NEXT_LOCALE')?.value ?? 'en'
	const response = NextResponse.redirect(new URL(`/${locale}`, req.url), { status: 303 })
	response.cookies.set('setup_done', '1', {
		httpOnly: true,
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
	})
	return response
}
