import { db } from '@/lib/db/index'
import { games, notifications, raGameMapping, recalboxes, sessions, settings, systemSnapshots } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

const MIGRATION_FLAG = '__multi_recalbox_migrated__'

function readSetting(key: string): string | null {
	return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null
}

export function runMultiRecalboxMigrationIfNeeded(): void {
	if (readSetting(MIGRATION_FLAG) === 'true') return

	const existing = db.select().from(recalboxes).limit(1).all()
	if (existing.length > 0) {
		db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
			.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()
		return
	}

	const sessionCount = db.select().from(sessions).limit(1).all().length
	const gameCount = db.select().from(games).limit(1).all().length
	if (sessionCount === 0 && gameCount === 0) {
		db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
			.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()
		return
	}

	const host = readSetting('recalbox.host') ?? process.env['RECALBOX_HOST'] ?? 'recalbox.local'
	const sshUser = readSetting('recalbox.sshUser') ?? 'root'
	const sshPassword = readSetting('recalbox.sshPassword') ?? ''
	const sshPort = Number(readSetting('recalbox.sshPort') ?? '22')
	const mqttPort = Number(readSetting('recalbox.mqttPort') ?? '1883')

	const defaultId = randomUUID()

	db.insert(recalboxes).values({
		id: defaultId,
		name: 'My Recalbox',
		host,
		sshUser,
		sshPassword,
		sshPort,
		mqttPort,
		isDefault: true,
		archived: false,
		createdAt: new Date(),
	}).run()

	db.update(sessions).set({ recalboxId: defaultId }).where(isNull(sessions.recalboxId)).run()
	db.update(games).set({ recalboxId: defaultId }).where(isNull(games.recalboxId)).run()
	db.update(systemSnapshots).set({ recalboxId: defaultId }).where(isNull(systemSnapshots.recalboxId)).run()
	db.update(notifications).set({ recalboxId: defaultId }).where(isNull(notifications.recalboxId)).run()
	db.update(raGameMapping).set({ recalboxId: defaultId }).where(eq(raGameMapping.recalboxId, '')).run()

	db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
		.onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()

	console.log(`[multi-recalbox] Migrated existing data to Recalbox ${defaultId} (${host})`)
}
