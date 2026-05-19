import { EventEmitter } from 'node:events'
import { db } from '@/lib/db/index'
import { notifications } from '@/lib/db/schema'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { getPreferences, isInQuietHours, shouldNotify } from './preferences'
import type { Notification, NotificationEvent } from './types'

const SINGLETON_VERSION = 1

interface NotificationServiceEvents {
	created: (notification: Notification) => void
}

declare interface NotificationService {
	on<K extends keyof NotificationServiceEvents>(
		event: K,
		listener: NotificationServiceEvents[K],
	): this
	off<K extends keyof NotificationServiceEvents>(
		event: K,
		listener: NotificationServiceEvents[K],
	): this
	emit<K extends keyof NotificationServiceEvents>(
		event: K,
		...args: Parameters<NotificationServiceEvents[K]>
	): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter pattern
class NotificationService extends EventEmitter {
	async create(event: NotificationEvent): Promise<Notification | null> {
		const prefs = await getPreferences()
		if (!shouldNotify(event, prefs)) return null

		const inQuiet = isInQuietHours(prefs)

		const row = db
			.insert(notifications)
			.values({
				type: event.type,
				data: JSON.stringify(event.data),
				createdAt: new Date(),
				pushedInApp: false,
				pushedWeb: false,
			})
			.returning()
			.get()

		if (!inQuiet) {
			this.emit('created', row)
		}

		return row
	}

	async markRead(id: number): Promise<void> {
		db.update(notifications)
			.set({ readAt: new Date() })
			.where(and(eq(notifications.id, id), isNull(notifications.readAt)))
			.run()
	}

	async markAllRead(): Promise<void> {
		db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt)).run()
	}

	async getUnreadCount(): Promise<number> {
		const rows = db
			.select({ id: notifications.id })
			.from(notifications)
			.where(isNull(notifications.readAt))
			.all()
		return rows.length
	}

	async listRecent(limit = 50): Promise<Notification[]> {
		return db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit).all()
	}

	async getUnpushedInApp(sinceId = 0): Promise<Notification[]> {
		return db
			.select()
			.from(notifications)
			.where(
				and(
					eq(notifications.pushedInApp, false),
					lt(notifications.id, sinceId === 0 ? 2147483647 : sinceId + 1),
				),
			)
			.orderBy(desc(notifications.createdAt))
			.limit(10)
			.all()
	}

	async markPushedInApp(id: number): Promise<boolean> {
		const result = db
			.update(notifications)
			.set({ pushedInApp: true })
			.where(and(eq(notifications.id, id), eq(notifications.pushedInApp, false)))
			.returning({ id: notifications.id })
			.get()
		return result !== undefined
	}
}

const g = globalThis as typeof globalThis & {
	__notificationService?: NotificationService
	__notificationServiceVersion?: number
}

if (!g.__notificationService || g.__notificationServiceVersion !== SINGLETON_VERSION) {
	g.__notificationService = new NotificationService()
	g.__notificationServiceVersion = SINGLETON_VERSION
}

export const notificationService = g.__notificationService

export function getNotificationService(): NotificationService {
	const svc = g.__notificationService
	if (!svc) throw new Error('NotificationService not initialized')
	return svc
}
