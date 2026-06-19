import { randomUUID } from 'node:crypto'
import { encryptSecret } from '@/lib/crypto/credentials'
import { db } from '@/lib/db/index'
import {
	games,
	notifications,
	raGameMapping,
	recalboxes,
	sessions,
	settings,
	systemSnapshots,
} from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'

const MIGRATION_FLAG = '__multi_recalbox_migrated__'

async function readSetting(key: string): Promise<string | null> {
	const row = await db.select().from(settings).where(eq(settings.key, key)).get()
	return row?.value ?? null
}

export async function runMultiRecalboxMigrationIfNeeded(): Promise<void> {
	if ((await readSetting(MIGRATION_FLAG)) === 'true') return

	const existing = await db.select().from(recalboxes).limit(1).all()
	if (existing.length > 0) {
		await db
			.insert(settings)
			.values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
			.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } })
			.run()
		return
	}

	const sessionCount = (await db.select().from(sessions).limit(1).all()).length
	const gameCount = (await db.select().from(games).limit(1).all()).length
	if (sessionCount === 0 && gameCount === 0) {
		await db
			.insert(settings)
			.values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
			.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } })
			.run()
		return
	}

	const host = (await readSetting('recalbox.host')) ?? process.env.RECALBOX_HOST ?? 'recalbox.local'
	const sshUser = (await readSetting('recalbox.sshUser')) ?? 'root'
	const sshPassword = (await readSetting('recalbox.sshPassword')) ?? ''
	const sshPort = Number((await readSetting('recalbox.sshPort')) ?? '22')
	const mqttPort = Number((await readSetting('recalbox.mqttPort')) ?? '1883')

	const defaultId = randomUUID()

	await db
		.insert(recalboxes)
		.values({
			id: defaultId,
			name: 'My Recalbox',
			host,
			sshUser,
			sshPassword: encryptSecret(sshPassword),
			sshPort,
			mqttPort,
			isDefault: true,
			archived: false,
			createdAt: new Date(),
		})
		.run()

	await db.update(sessions).set({ recalboxId: defaultId }).where(isNull(sessions.recalboxId)).run()
	await db.update(games).set({ recalboxId: defaultId }).where(isNull(games.recalboxId)).run()
	await db
		.update(systemSnapshots)
		.set({ recalboxId: defaultId })
		.where(isNull(systemSnapshots.recalboxId))
		.run()
	await db
		.update(notifications)
		.set({ recalboxId: defaultId })
		.where(isNull(notifications.recalboxId))
		.run()
	await db
		.update(raGameMapping)
		.set({ recalboxId: defaultId })
		.where(eq(raGameMapping.recalboxId, ''))
		.run()

	await db
		.insert(settings)
		.values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
		.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } })
		.run()

	console.log(`[multi-recalbox] Migrated existing data to Recalbox ${defaultId} (${host})`)
}
