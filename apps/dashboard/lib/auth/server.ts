import { db } from '@/lib/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
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
})

export type Auth = typeof auth
