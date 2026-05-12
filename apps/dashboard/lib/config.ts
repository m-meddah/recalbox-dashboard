/** Typed application configuration sourced from environment variables (lazy — read on access). */
export const config = {
	get recalbox() {
		return {
			host: requireEnv('RECALBOX_HOST'),
			sshUser: requireEnv('RECALBOX_SSH_USER'),
			sshPassword: requireEnv('RECALBOX_SSH_PASSWORD'),
		}
	},
	get mqtt() {
		return {
			brokerUrl: process.env.MQTT_BROKER_URL ?? 'mqtt://recalbox.local:1883',
		}
	},
}

function requireEnv(key: string): string {
	const value = process.env[key]
	if (!value) throw new Error(`Missing required environment variable: ${key}`)
	return value
}
