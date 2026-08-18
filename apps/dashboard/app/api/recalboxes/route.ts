import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { isServerlessMode } from '@/lib/serverless'
import { HOST_REGEX } from '@/lib/validation/host'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	const viewable = new Set(await getViewableRecalboxIds(user))
	const all = configStore
		.getRecalboxes()
		.flatMap((rb) => (viewable.has(rb.id) ? [{ ...rb, sshPassword: '***' }] : []))
	return NextResponse.json(all)
}

const baseCreateSchema = z.object({
	name: z.string().min(1).max(64),
	host: z.string().min(1).regex(HOST_REGEX),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().max(128),
	sshPort: z.number().int().min(1).max(65535).default(22),
	mqttPort: z.number().int().min(1).max(65535).default(1883),
	color: z.string().nullable().optional(),
	iconEmoji: z.string().nullable().optional(),
})

/**
 * Serverless deploys accept an EMPTY SSH password; self-hosted ones still demand it.
 * The cloud has no SSH path to the box — the on-box agent pushes outbound — so the
 * credential is never used there, and requiring it blocked enrollment on a secret
 * that serves no purpose. Self-hosted is the opposite: every read (gamelist, media,
 * stats) goes over SSH, so an empty password is a misconfiguration, not a choice.
 *
 * Read per request rather than at module scope so the mode is never baked into a
 * warm instance ahead of its env.
 */
function createSchema() {
	return isServerlessMode()
		? baseCreateSchema
		: baseCreateSchema.extend({ sshPassword: z.string().min(1).max(128) })
}

/** First validation issue as one human sentence — the client shows this verbatim. */
function firstIssue(error: z.ZodError): string {
	const issue = error.issues[0]
	if (!issue) return 'Invalid request'
	const field = issue.path.join('.')
	return field ? `${field}: ${issue.message}` : issue.message
}

export async function POST(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = createSchema().safeParse(body)
	if (!parsed.success)
		return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 422 })
	const rb = await configStore.addRecalbox(
		{
			...parsed.data,
			color: parsed.data.color ?? null,
			iconEmoji: parsed.data.iconEmoji ?? null,
		},
		user.id,
	)
	return NextResponse.json({ ...rb, sshPassword: '***' }, { status: 201 })
}
