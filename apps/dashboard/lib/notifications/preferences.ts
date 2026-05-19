import { db } from '@/lib/db/index'
import { upsertSetting } from '@/lib/db/queries'
import { settings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { DEFAULT_PREFERENCES, type NotificationEvent, type NotificationPreferences } from './types'

const PREFS_KEY = 'notifications.preferences'

export async function getPreferences(): Promise<NotificationPreferences> {
	const row = db.select().from(settings).where(eq(settings.key, PREFS_KEY)).get()
	if (!row) return DEFAULT_PREFERENCES
	try {
		return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.value) }
	} catch {
		return DEFAULT_PREFERENCES
	}
}

export async function savePreferences(prefs: NotificationPreferences): Promise<void> {
	upsertSetting(PREFS_KEY, JSON.stringify(prefs))
}

export function shouldNotify(event: NotificationEvent, prefs: NotificationPreferences): boolean {
	if (!prefs.enabled) return false

	switch (event.type) {
		case 'achievement.unlocked':
			if (!prefs.types.achievementUnlocked) return false
			if (prefs.types.achievementHardcoreOnly && !event.data.isHardcore) return false
			return true
		case 'game.started':
			return prefs.types.gameStarted
		case 'streak.milestone':
			return prefs.types.streakMilestone
		case 'wrapped.available':
			return prefs.types.wrappedAvailable
		case 'system.alert':
			return prefs.types.systemAlerts
		default:
			return true
	}
}

export function isInQuietHours(prefs: NotificationPreferences): boolean {
	if (!prefs.quietHours.enabled) return false
	const hour = new Date().getHours()
	const { startHour, endHour } = prefs.quietHours
	if (startHour < endHour) {
		return hour >= startHour && hour < endHour
	}
	// Wraps midnight (e.g. 22 → 8)
	return hour >= startHour || hour < endHour
}
