import { db } from '@/lib/db/index'
import { pushSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import type { Notification } from './types'
import { getOrCreateVapidKeys } from './vapid'

type PushPayload = {
	title: string
	body: string
	icon: string
	badge: string
	tag: string
	data: { url: string; notificationId: number }
}

export function buildPushPayload(notification: Notification): PushPayload {
	const data = JSON.parse(notification.data)

	switch (notification.type) {
		case 'achievement.unlocked':
			return {
				title: `🏆 ${data.gameTitle}`,
				body: `${data.title} — ${data.points} pts${data.isHardcore ? ' (Hardcore)' : ''}`,
				icon: '/icon-192x192.png',
				badge: '/badge-72x72.png',
				tag: `achievement-${notification.id}`,
				data: { url: '/achievements', notificationId: notification.id },
			}
		case 'streak.milestone':
			return {
				title: '🔥 Série en cours !',
				body: `${data.days} jours consécutifs de jeu`,
				icon: '/icon-192x192.png',
				badge: '/badge-72x72.png',
				tag: `streak-${data.days}`,
				data: { url: '/stats', notificationId: notification.id },
			}
		case 'wrapped.available':
			return {
				title: '🎮 Recap annuel disponible',
				body: `Découvrez votre Wrapped ${data.year}`,
				icon: '/icon-192x192.png',
				badge: '/badge-72x72.png',
				tag: 'wrapped',
				data: { url: '/wrapped', notificationId: notification.id },
			}
		case 'game.started':
			return {
				title: '▶️ Partie démarrée',
				body: data.gameName ?? data.romPath,
				icon: '/icon-192x192.png',
				badge: '/badge-72x72.png',
				tag: 'game-started',
				data: { url: '/', notificationId: notification.id },
			}
		default:
			return {
				title: '📢 Recalbox Dashboard',
				body: data.message ?? 'Nouvelle notification',
				icon: '/icon-192x192.png',
				badge: '/badge-72x72.png',
				tag: `system-${notification.id}`,
				data: { url: '/', notificationId: notification.id },
			}
	}
}

export async function sendWebPush(notification: Notification): Promise<void> {
	const { publicKey, privateKey } = await getOrCreateVapidKeys()
	webpush.setVapidDetails('mailto:noreply@recalbox.local', publicKey, privateKey)

	const subs = db.select().from(pushSubscriptions).all()
	if (subs.length === 0) return

	const payload = JSON.stringify(buildPushPayload(notification))

	await Promise.allSettled(
		subs.map(async (sub) => {
			try {
				await webpush.sendNotification(
					{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
					payload,
				)
				db.update(pushSubscriptions)
					.set({ lastUsedAt: new Date() })
					.where(eq(pushSubscriptions.endpoint, sub.endpoint))
					.run()
			} catch (err: unknown) {
				const status = (err as { statusCode?: number }).statusCode
				if (status === 410 || status === 404) {
					db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).run()
				}
			}
		}),
	)
}
