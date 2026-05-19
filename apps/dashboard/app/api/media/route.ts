import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Paths must start with one of these prefixes to prevent path traversal
const ALLOWED_PREFIXES = ['/recalbox/share/']

// In-memory negative cache: avoids repeated SSH round-trips for missing scraper images.
// Key: "<recalboxId>:<path>", value: expiry timestamp.
const notFoundCache = new Map<string, number>()
const NOT_FOUND_TTL_MS = 5 * 60 * 1000

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

	// Reject path traversal — only block `..` as a full path component, not as part of a filename
	if (filePath.includes('/../') || filePath.endsWith('/..')) {
		return new Response('Forbidden', { status: 403 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return new Response('No Recalbox configured', { status: 503 })
	}

	const cacheKey = `${recalboxId}:${filePath}`
	const cachedExpiry = notFoundCache.get(cacheKey)
	if (cachedExpiry && cachedExpiry > Date.now()) {
		return new Response('Image not found', {
			status: 404,
			headers: { 'Cache-Control': 'public, max-age=300' },
		})
	}

	const ssh = getSshClient(recalboxId)

	const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
	const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

	try {
		// Verify file exists before fetching — avoids noisy base64 errors for missing scraper images
		const exists = await ssh.exec(`test -f ${shellQuote(filePath)} && echo yes || echo no`)
		if (exists !== 'yes') {
			notFoundCache.set(cacheKey, Date.now() + NOT_FOUND_TTL_MS)
			return new Response('Image not found', {
				status: 404,
				headers: { 'Cache-Control': 'public, max-age=300' },
			})
		}

		// Fetch image binary via SSH as base64 to safely handle binary over text channel
		const b64 = await ssh.exec(`base64 -w 0 ${shellQuote(filePath)}`, 15_000)
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
		notFoundCache.set(cacheKey, Date.now() + NOT_FOUND_TTL_MS)
		return new Response('Image not found', {
			status: 404,
			headers: { 'Cache-Control': 'public, max-age=300' },
		})
	}
}
