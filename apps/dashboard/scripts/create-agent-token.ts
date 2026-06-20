#!/usr/bin/env tsx
// Mint an agent token for a Recalbox. The raw token is printed once — paste it
// into the on-device agent's config.json. Only its hash is stored.
//
//   pnpm --filter @recalbox/dashboard exec tsx scripts/create-agent-token.ts <recalboxId> [name]
import './load-env'
import { db } from '../lib/db'
import { createAgentToken } from '../lib/db/agent-queries'
import { getRecalbox, listRecalboxes } from '../lib/db/recalbox-queries'

async function main() {
	const recalboxId = process.argv[2]
	const name = process.argv[3]

	if (!recalboxId) {
		const all = await listRecalboxes()
		console.error('Usage: tsx scripts/create-agent-token.ts <recalboxId> [name]\n')
		console.error('Known Recalboxes:')
		for (const r of all) console.error(`  ${r.id}\t${r.name}`)
		process.exit(1)
	}

	const rb = await getRecalbox(recalboxId)
	if (!rb) {
		console.error(`No Recalbox found with id "${recalboxId}".`)
		process.exit(1)
	}

	const { token, row } = await createAgentToken(db, recalboxId, name)

	console.log(`\n✓ Agent token created for "${rb.name}" (${recalboxId}).`)
	console.log('  Shown ONCE — copy it into the agent config.json now:\n')
	console.log(`  ${token}\n`)
	console.log('  config.json:')
	console.log(
		JSON.stringify(
			{ recalbox_id: recalboxId, token, cloud_url: 'https://<your-app>/api/agent/ingest' },
			null,
			2,
		),
	)
	console.log(`\n  (token id: ${row.id})`)
	process.exit(0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
