import { getBearerToken } from '@/lib/agent/bearer'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { listWanted, saveArtwork } from '@/lib/db/artwork'
import { logger } from '@/lib/logger'
import { artworkContentType, artworkKey, looksLikeImage, putObject } from '@/lib/storage'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Agent polls the list of box file paths whose artwork browsers have requested
// but we don't have yet (request-driven, lazy — no bulk upload).
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })
	const resolved = await resolveAgentToken(db, token)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	const wanted = await listWanted(db, resolved.recalboxId)
	return NextResponse.json({ wanted: wanted.map((w) => w.boxPath) })
}

const Payload = z.object({
	box_path: z.string().min(1),
	// Accepted for wire compatibility but INTENTIONALLY IGNORED — see POST below.
	// The shipped agent never sends it (agent/agent.py posts only box_path + data).
	content_type: z.string().nullish(),
	// base64-encoded image bytes
	data: z.string().min(1),
})

// Agent uploads one image's bytes; we store it and record the public URL.
export async function POST(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })
	const resolved = await resolveAgentToken(db, token)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	let json: unknown
	try {
		json = await req.json()
	} catch {
		return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
	}
	const parsed = Payload.safeParse(json)
	if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
	const p = parsed.data

	let bytes: Buffer
	try {
		bytes = Buffer.from(p.data, 'base64')
	} catch {
		return NextResponse.json({ error: 'invalid_data' }, { status: 400 })
	}
	if (bytes.byteLength === 0) return NextResponse.json({ error: 'empty_data' }, { status: 400 })

	// The agent's `content_type` is NOT trusted. A token holder (a compromised box, or
	// anyone running their own) could claim text/html and turn the artwork bucket into a
	// page-hosting service on a domain we own — served from object storage, where our
	// own security headers do not reach. The type is derived from the file extension
	// against a fixed image allowlist instead, and an upload we cannot type as an image
	// is refused, so no .html key is ever created either.
	const contentType = artworkContentType(p.box_path)
	if (!contentType) {
		logger.warn(`[agent/artwork] refused non-image path: ${p.box_path}`)
		return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
	}
	// …and the bytes must actually be an image, or a correct Content-Type would just be
	// a label on arbitrary content.
	if (!looksLikeImage(bytes)) {
		logger.warn(`[agent/artwork] refused non-image bytes for: ${p.box_path}`)
		return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
	}

	try {
		const key = artworkKey(resolved.recalboxId, p.box_path)
		const { url } = await putObject(key, bytes, contentType)
		await saveArtwork(db, resolved.recalboxId, p.box_path, url, contentType)
		return NextResponse.json({ ok: true, url }, { status: 201 })
	} catch (e) {
		logger.error('[agent/artwork] upload failed', e)
		return NextResponse.json({ error: 'upload_failed' }, { status: 500 })
	}
}
