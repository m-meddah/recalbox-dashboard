import type { notifications } from '@/lib/db/schema'

export type Notification = typeof notifications.$inferSelect

export type AchievementUnlockedData = {
	achievementId: number
	title: string
	points: number
	imageUrl: string
	isHardcore: boolean
	gameTitle: string
	gameId: number
}

export type GameStartedData = {
	system: string
	romPath: string
	gameName?: string
}

export type StreakMilestoneData = {
	days: number
}

export type WrappedAvailableData = {
	year: number
}

export type SystemAlertData = {
	message: string
}

export type NotificationEvent =
	| { type: 'achievement.unlocked'; data: AchievementUnlockedData }
	| { type: 'game.started'; data: GameStartedData }
	| { type: 'streak.milestone'; data: StreakMilestoneData }
	| { type: 'wrapped.available'; data: WrappedAvailableData }
	| { type: 'system.alert'; data: SystemAlertData }

export type NotificationPreferences = {
	enabled: boolean
	inApp: boolean
	webPush: boolean
	types: {
		achievementUnlocked: boolean
		achievementHardcoreOnly: boolean
		gameStarted: boolean
		streakMilestone: boolean
		wrappedAvailable: boolean
		systemAlerts: boolean
	}
	quietHours: {
		enabled: boolean
		startHour: number
		endHour: number
	}
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
	enabled: true,
	inApp: true,
	webPush: false,
	types: {
		achievementUnlocked: true,
		achievementHardcoreOnly: false,
		gameStarted: false,
		streakMilestone: true,
		wrappedAvailable: true,
		systemAlerts: true,
	},
	quietHours: {
		enabled: false,
		startHour: 22,
		endHour: 8,
	},
}
