import { decryptSecret, encryptSecret } from '@/lib/crypto/credentials'
import { type DB, db } from '@/lib/db/index'
import {
	agentCommands,
	agentTokens,
	artwork,
	games,
	notifications,
	nowPlaying,
	raGameMapping,
	recalboxes,
	sessions,
	systemSnapshots,
} from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import type { RecalboxInstance } from '@/lib/settings/schemas'
import { eq } from 'drizzle-orm'

export type RecalboxRow = typeof recalboxes.$inferSelect
export type RecalboxInsert = typeof recalboxes.$inferInsert

/** Map a DB row to the shape the app consumes (drops timestamps, normalises nulls). */
export function rowToInstance(row: RecalboxRow): RecalboxInstance {
	return {
		id: row.id,
		name: row.name,
		host: row.host,
		sshUser: row.sshUser,
		sshPassword: row.sshPassword,
		sshPort: row.sshPort,
		mqttPort: row.mqttPort,
		color: row.color,
		iconEmoji: row.iconEmoji,
		ownerUserId: row.ownerUserId ?? null,
		isDefault: row.isDefault ?? false,
		archived: row.archived ?? false,
		agentChannel: row.agentChannel === 'beta' ? 'beta' : 'stable',
	}
}

function decryptRow(row: RecalboxRow): RecalboxRow {
	try {
		return { ...row, sshPassword: decryptSecret(row.sshPassword) }
	} catch (err) {
		logger.error(`Failed to decrypt ssh_password for recalbox ${row.id}`, err)
		return row
	}
}

export async function listRecalboxes(): Promise<RecalboxRow[]> {
	try {
		const rows = await db.select().from(recalboxes).all()
		return rows.map(decryptRow)
	} catch (err) {
		logger.error('listRecalboxes failed', err)
		return []
	}
}
export async function getRecalbox(id: string): Promise<RecalboxRow | null> {
	try {
		const row = await db.select().from(recalboxes).where(eq(recalboxes.id, id)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getRecalbox failed', err)
		return null
	}
}
export async function getDefaultRecalbox(): Promise<RecalboxRow | null> {
	try {
		const row = await db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get()
		return row ? decryptRow(row) : null
	} catch (err) {
		logger.error('getDefaultRecalbox failed', err)
		return null
	}
}
export async function insertRecalbox(row: RecalboxInsert): Promise<void> {
	await db
		.insert(recalboxes)
		.values({ ...row, sshPassword: encryptSecret(row.sshPassword) })
		.run()
}
export async function updateRecalbox(
	id: string,
	patch: Partial<Omit<RecalboxInsert, 'id'>>,
): Promise<void> {
	const next =
		patch.sshPassword !== undefined
			? { ...patch, sshPassword: encryptSecret(patch.sshPassword) }
			: patch
	await db.update(recalboxes).set(next).where(eq(recalboxes.id, id)).run()
}
export async function deleteRecalbox(id: string, database: DB = db): Promise<void> {
	// The schema declares no FK constraints, so cascade every dependent row explicitly.
	// Deleting the box's agent_tokens also REVOKES them — otherwise the on-device agent
	// keeps authenticating and pushing into now-orphaned rows forever (a data-integrity
	// leak and an auth gap).
	//
	// Order matters: dependents first, the `recalboxes` row LAST. If this is interrupted
	// mid-cascade the box still exists (nothing is left orphaned without a parent) and a
	// retry simply finishes the job. Sequential rather than a transaction to stay portable
	// across the libSQL (prod) and better-sqlite3 (tests) drivers.
	await database.delete(sessions).where(eq(sessions.recalboxId, id)).run()
	await database.delete(games).where(eq(games.recalboxId, id)).run()
	await database.delete(systemSnapshots).where(eq(systemSnapshots.recalboxId, id)).run()
	await database.delete(notifications).where(eq(notifications.recalboxId, id)).run()
	await database.delete(raGameMapping).where(eq(raGameMapping.recalboxId, id)).run()
	await database.delete(nowPlaying).where(eq(nowPlaying.recalboxId, id)).run()
	await database.delete(artwork).where(eq(artwork.recalboxId, id)).run()
	await database.delete(agentCommands).where(eq(agentCommands.recalboxId, id)).run()
	await database.delete(agentTokens).where(eq(agentTokens.recalboxId, id)).run()
	await database.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}
export async function setDefaultRecalbox(id: string): Promise<void> {
	await db.update(recalboxes).set({ isDefault: false }).run()
	await db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}
