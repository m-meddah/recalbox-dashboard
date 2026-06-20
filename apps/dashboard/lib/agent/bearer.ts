import type { NextRequest } from 'next/server'

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function getBearerToken(req: NextRequest): string | null {
	const header = req.headers.get('authorization') ?? ''
	const match = /^Bearer\s+(.+)$/i.exec(header)
	return match?.[1]?.trim() || null
}
