import type { AppConfig } from './schemas'

export function getDefaults(): AppConfig {
	return {
		recalbox: {
			host: process.env.RECALBOX_HOST ?? 'recalbox.local',
			sshUser: process.env.RECALBOX_SSH_USER ?? 'root',
			sshPassword: process.env.RECALBOX_SSH_PASSWORD ?? '',
			sshPort: 22,
			mqttPort: 1883,
		},
		scrobble: {
			minDurationSec: Number.parseInt(process.env.MIN_DURATION_SEC ?? '10', 10),
			maxDurationHours: 1,
			orphanRecoveryHours: 12,
		},
		ui: {
			locale: 'en',
			theme: 'system',
			weekStartsOn: 1,
		},
	}
}
