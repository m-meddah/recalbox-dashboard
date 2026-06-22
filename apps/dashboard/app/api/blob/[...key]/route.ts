import { contentTypeForPath, isLocalStorage, readLocal } from '@/lib/storage'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Serves artwork stored by the local-filesystem adapter (dev/tests). In
// production the storage adapter returns absolute Vercel Blob URLs, so this
// route is never hit.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
	if (!isLocalStorage()) return new Response('Not found', { status: 404 })
	const { key } = await params
	const k = key.join('/')
	const bytes = await readLocal(k)
	if (!bytes) return new Response('Not found', { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': contentTypeForPath(k),
			'Cache-Control': 'public, max-age=3600',
		},
	})
}
