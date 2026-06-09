import { z } from 'zod'

const retroachievementsConfigSchema = z.object({
	enabled: z.boolean(),
	username: z.string().max(64),
	apiKey: z.string().max(256),
	autoSyncMinutes: z.number().int().min(1).max(1440),
})

const superRetrogamersConfigSchema = z.object({
	enabled: z.boolean(),
	apiUrl: z.string().max(256),
	preferredRegion: z.enum(['US', 'EU', 'JP', '']),
})

const mqttPublishConfigSchema = z.object({
	enabled: z.boolean(),
	brokerUrl: z.string().max(256),
	topicPrefix: z.string().max(64),
	homeAssistantDiscovery: z.boolean(),
})

const recalboxConfigSchema = z.object({
	host: z
		.string()
		.min(1)
		.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(1).max(128),
	sshPort: z.number().int().min(1).max(65535),
	mqttPort: z.number().int().min(1).max(65535),
})

const scrobbleConfigSchema = z.object({
	minDurationSec: z.number().int().min(0),
	maxDurationHours: z.number().min(0),
	orphanRecoveryHours: z.number().min(0),
})

const uiConfigSchema = z.object({
	locale: z.string().min(2).max(10),
	theme: z.enum(['light', 'dark', 'system']),
	weekStartsOn: z.union([z.literal(0), z.literal(1)]),
})

export const appConfigSchema = z.object({
	recalbox: recalboxConfigSchema,
	scrobble: scrobbleConfigSchema,
	ui: uiConfigSchema,
	retroachievements: retroachievementsConfigSchema,
	superRetrogamers: superRetrogamersConfigSchema,
	mqttPublish: mqttPublishConfigSchema,
})

export type RecalboxConfig = z.infer<typeof recalboxConfigSchema>
export type ScrobbleConfig = z.infer<typeof scrobbleConfigSchema>
export type UiConfig = z.infer<typeof uiConfigSchema>
export type RetroachievementsConfig = z.infer<typeof retroachievementsConfigSchema>
export type SuperRetrogamersConfig = z.infer<typeof superRetrogamersConfigSchema>
export type MqttPublishConfig = z.infer<typeof mqttPublishConfigSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

export type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T

export function maskedConfig(cfg: AppConfig): AppConfig {
	return {
		...cfg,
		recalbox: {
			...cfg.recalbox,
			sshPassword: '***',
		},
		retroachievements: {
			...cfg.retroachievements,
			apiKey: cfg.retroachievements?.apiKey ? '***' : '',
		},
	}
}

const recalboxInstanceSchema = z.object({
	id: z.uuid(),
	name: z.string().min(1).max(64),
	host: z
		.string()
		.min(1)
		.regex(/^[a-zA-Z0-9.-]+$/),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(1).max(128),
	sshPort: z.number().int().min(1).max(65535),
	mqttPort: z.number().int().min(1).max(65535),
	color: z.string().nullable(),
	iconEmoji: z.string().nullable(),
	ownerUserId: z.string().nullable().default(null),
	isDefault: z.boolean(),
	archived: z.boolean(),
})

export type RecalboxInstance = z.infer<typeof recalboxInstanceSchema>

export const SETUP_COMPLETED_KEY = '__setup_completed__'
export const PASSWORD_MASK = '***'
