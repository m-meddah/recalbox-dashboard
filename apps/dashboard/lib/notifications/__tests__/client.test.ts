import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from '../client'

type MockRegistration = { unregister: ReturnType<typeof vi.fn> }

function installBrowserMocks() {
	const registration: MockRegistration = { unregister: vi.fn().mockResolvedValue(true) }
	const register = vi.fn().mockResolvedValue(registration)
	const getRegistrations = vi.fn().mockResolvedValue([registration])
	const cachesDelete = vi.fn().mockResolvedValue(true)
	const cachesKeys = vi.fn().mockResolvedValue(['recalbox-static-v1', 'recalbox-runtime-v1'])

	vi.stubGlobal('window', { caches: {} } as unknown as Window)
	vi.stubGlobal('navigator', {
		serviceWorker: { register, getRegistrations },
	} as unknown as Navigator)
	vi.stubGlobal('caches', {
		keys: cachesKeys,
		delete: cachesDelete,
	} as unknown as CacheStorage)

	return { registration, register, getRegistrations, cachesDelete, cachesKeys }
}

describe('registerServiceWorker', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
	})

	it('does not register and cleans up stale registrations/caches in development', async () => {
		vi.stubEnv('NODE_ENV', 'development')
		const { register, getRegistrations, registration, cachesDelete } = installBrowserMocks()

		const result = await registerServiceWorker()

		expect(result).toBeNull()
		expect(register).not.toHaveBeenCalled()
		expect(getRegistrations).toHaveBeenCalled()
		expect(registration.unregister).toHaveBeenCalled()
		expect(cachesDelete).toHaveBeenCalledTimes(2)
	})

	it('registers the service worker in production', async () => {
		vi.stubEnv('NODE_ENV', 'production')
		const { register, getRegistrations } = installBrowserMocks()

		const result = await registerServiceWorker()

		expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
		expect(getRegistrations).not.toHaveBeenCalled()
		expect(result).not.toBeNull()
	})
})
