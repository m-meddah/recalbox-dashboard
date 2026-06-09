import { auth } from '@/lib/auth/server'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

export type AuthedUser = { id: string; email: string; role: string }

export class UnauthorizedError extends Error {
	constructor() {
		super('Unauthorized')
		this.name = 'UnauthorizedError'
	}
}

export async function getUser(): Promise<AuthedUser | null> {
	const session = await auth.api.getSession({ headers: await headers() })
	const user = session?.user
	if (!user) return null
	return { id: user.id, email: user.email, role: (user as { role?: string }).role ?? 'member' }
}

export async function requireUser(): Promise<AuthedUser> {
	const user = await getUser()
	if (!user) throw new UnauthorizedError()
	return user
}

export function unauthorized(): NextResponse {
	return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden(): NextResponse {
	return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
