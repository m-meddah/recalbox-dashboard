import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Paths must start with one of these prefixes to prevent path traversal
const ALLOWED_PREFIXES = ['/recalbox/share/']

const CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	bmp: 'image/bmp',
}

export async function GET(request: Request) {
	if (!(await getUser())) return unauthorized()
	const { searchParams } = new URL(request.url)
	const filePath = searchParams.get('path')

	if (!filePath) {
		return new Response('Missing path parameter', { status: 400 })
	}

	const isAllowed = ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
	if (!isAllowed) {
		return new Response('Forbidden', { status: 403 })
	}

	// Reject path traversal — only block `..` as a full path component, not as part of a filename
	if (filePath.includes('/../') || filePath.endsWith('/..')) {
		return new Response('Forbidden', { status: 403 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return new Response('No Recalbox configured', { status: 503 })
	}

	const ssh = getSshClient(recalboxId, 'media')

	const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
	const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

	try {
		// Single SSH round-trip: check existence and fetch in one command.
		// __NF__ is a safe sentinel — it cannot appear in valid base64 output ([A-Za-z0-9+/=]).
		const result = await ssh.exec(
			`test -f ${shellQuote(filePath)} && base64 -w 0 ${shellQuote(filePath)} || printf '__NF__'`,
			15_000,
		)

		if (!result || result === '__NF__') {
			return new Response('Image not found', {
				status: 404,
				headers: { 'Cache-Control': 'public, max-age=300' },
			})
		}

		const buffer = Buffer.from(result, 'base64')
		if (buffer.byteLength === 0) return new Response('Image not found', { status: 404 })

		return new Response(buffer, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=3600',
				'Content-Length': String(buffer.byteLength),
			},
		})
	} catch {
		// Transient error (SSH timeout, connection drop) — do NOT cache, allow retry
		return new Response('Image not found', { status: 404 })
	}
}
