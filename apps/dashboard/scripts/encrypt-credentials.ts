import { encryptSecret, hasKey, isEncrypted } from '@/lib/crypto/credentials'
import { db } from '@/lib/db'
import { igdbCredentials, recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
	if (!hasKey()) {
		console.error(
			'No CREDENTIALS_SECRET/BETTER_AUTH_SECRET set — refusing to run; secrets would remain plaintext.',
		)
		process.exit(1)
	}

	const dryRun = process.argv.includes('--dry-run')
	let changed = 0

	// recalboxes.ssh_password
	for (const row of db.select().from(recalboxes).all()) {
		if (row.sshPassword && !isEncrypted(row.sshPassword)) {
			console.log(`recalbox ${row.id} (${row.name}): ssh_password -> encrypt`)
			if (!dryRun) {
				db.update(recalboxes)
					.set({ sshPassword: encryptSecret(row.sshPassword) })
					.where(eq(recalboxes.id, row.id))
					.run()
			}
			changed++
		}
	}

	// igdb_credentials.client_secret / access_token (singleton row id=1)
	const creds = db.select().from(igdbCredentials).where(eq(igdbCredentials.id, 1)).get()
	if (creds) {
		const patch: { clientSecret?: string; accessToken?: string } = {}
		if (creds.clientSecret && !isEncrypted(creds.clientSecret)) {
			console.log('igdb: client_secret -> encrypt')
			patch.clientSecret = encryptSecret(creds.clientSecret)
			changed++
		}
		if (creds.accessToken && !isEncrypted(creds.accessToken)) {
			console.log('igdb: access_token -> encrypt')
			patch.accessToken = encryptSecret(creds.accessToken)
			changed++
		}
		if (!dryRun && Object.keys(patch).length > 0) {
			db.update(igdbCredentials).set(patch).where(eq(igdbCredentials.id, 1)).run()
		}
	}

	console.log(
		dryRun
			? `Dry run: ${changed} secret(s) would be encrypted.`
			: `Done: ${changed} secret(s) encrypted.`,
	)
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
