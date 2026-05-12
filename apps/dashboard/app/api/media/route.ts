import { sshClient } from '@/lib/recalbox/ssh-client'
import { shellQuote } from '@/lib/recalbox/shell'

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
	const { searchParams } = new URL(request.url)
	const filePath = searchParams.get('path')

	if (!filePath) {
		return new Response('Missing path parameter', { status: 400 })
	}

	const isAllowed = ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
	if (!isAllowed) {
		return new Response('Forbidden', { status: 403 })
	}

	// Reject any path traversal attempts that survived the prefix check
	if (filePath.includes('..')) {
		return new Response('Forbidden', { status: 403 })
	}

	const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
	const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

	try {
		// Verify file exists before fetching — avoids noisy base64 errors for missing scraper images
		const exists = await sshClient.exec(`test -f ${shellQuote(filePath)} && echo yes || echo no`)
		if (exists !== 'yes') {
			return new Response('Image not found', { status: 404 })
		}

		// Fetch image binary via SSH as base64 to safely handle binary over text channel
		const b64 = await sshClient.exec(`base64 -w 0 ${shellQuote(filePath)}`, 15_000)
		if (!b64) return new Response('Image not found', { status: 404 })
		const buffer = Buffer.from(b64, 'base64')
		if (buffer.byteLength === 0) return new Response('Image not found', { status: 404 })

		return new Response(buffer, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=3600',
				'Content-Length': String(buffer.byteLength),
			},
		})
	} catch {
		return new Response('Image not found', { status: 404 })
	}
}
