import { user as userTable } from '@/lib/auth/auth-schema'
import { db } from '@/lib/db'
import { recalboxes } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'

async function main() {
	const [email, recalboxId] = process.argv.slice(2)
	if (!email) {
		console.error('Usage: tsx scripts/assign-recalbox-owner.ts <email> [recalboxId]')
		console.error('Without a recalboxId, assigns ALL currently-unowned recalboxes to the user.')
		process.exit(1)
	}
	const owner = db.select().from(userTable).where(eq(userTable.email, email)).get()
	if (!owner) {
		console.error(`No user found with email ${email}`)
		process.exit(1)
	}
	if (recalboxId) {
		db.update(recalboxes).set({ ownerUserId: owner.id }).where(eq(recalboxes.id, recalboxId)).run()
		console.log(`Assigned recalbox ${recalboxId} to ${email}`)
	} else {
		const res = db
			.update(recalboxes)
			.set({ ownerUserId: owner.id })
			.where(isNull(recalboxes.ownerUserId))
			.run()
		console.log(`Assigned ${res.changes} unowned recalbox(es) to ${email}`)
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
