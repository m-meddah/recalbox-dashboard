import { configStore } from '@/lib/config-store'

/** Typed application configuration — reads from DB (with .env fallbacks). */
export const config = {
	get recalbox() {
		const { host, sshUser, sshPassword, sshPort } = configStore.get().recalbox
		return { host, sshUser, sshPassword, sshPort }
	},
	get mqtt() {
		const { host, mqttPort } = configStore.get().recalbox
		return { brokerUrl: `mqtt://${host}:${mqttPort}` }
	},
}
