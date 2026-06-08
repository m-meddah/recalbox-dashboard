import { db } from '@/lib/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite',
	}),
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
	},
	plugins: [admin()],
	hooks: {
		// Invitation-only: reject any public sign-up with a 403 Forbidden. Accounts are
		// created server-side via scripts/create-user.ts. Better Auth's own disableSignUp
		// guard (kept above as defense-in-depth) returns 400; we prefer a semantically
		// correct 403, applied before validation so the response is consistent.
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path.startsWith('/sign-up')) {
				throw new APIError('FORBIDDEN', { message: 'Sign up is disabled' })
			}
		}),
	},
})

export type Auth = typeof auth
