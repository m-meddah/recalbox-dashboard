#!/usr/bin/env tsx
import { auth } from '@/lib/auth/server'

async function main() {
	const [email, password, role = 'member'] = process.argv.slice(2)
	if (!email || !password) {
		console.error('Usage: tsx scripts/create-user.ts <email> <password> [admin|member]')
		process.exit(1)
	}

	if (role !== 'admin' && role !== 'member') {
		console.error(`Error: role must be "admin" or "member", got "${role}"`)
		process.exit(1)
	}

	let result: { user: { id: string; email: string; role?: string | null } }
	try {
		result = await auth.api.createUser({
			body: {
				email,
				password,
				name: email,
				role: role as 'admin' | 'member',
			},
		})
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes('USER_ALREADY_EXISTS') || msg.toLowerCase().includes('already exists')) {
			console.error(`Error: a user with email "${email}" already exists.`)
			process.exit(1)
		}
		throw err
	}

	console.log('Created user:', {
		id: result.user.id,
		email: result.user.email,
		role: result.user.role,
	})
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
