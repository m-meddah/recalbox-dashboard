import { configStore } from '@/lib/config-store'
import { buildAuthorization } from '@retroachievements/api'

type Authorization = ReturnType<typeof buildAuthorization>

let cachedAuth: Authorization | null = null

export function getAuth(): Authorization {
	if (!cachedAuth) {
		const { username, apiKey } = configStore.get().retroachievements
		cachedAuth = buildAuthorization({ username, webApiKey: apiKey })
	}
	return cachedAuth
}

configStore.on('changed:retroachievements', () => {
	cachedAuth = null
})
