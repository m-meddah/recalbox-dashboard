function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const rawData = atob(base64)
	const buf = new ArrayBuffer(rawData.length)
	const view = new Uint8Array(buf)
	for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i)
	return view
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (typeof window === 'undefined') return null
	if (!('serviceWorker' in navigator)) return null

	// The service worker serves /_next/static/ chunks cache-first. In development those
	// URLs are reused across recompiles, so a cached chunk gets served against freshly
	// server-rendered HTML — causing hydration mismatches. Never run the SW outside
	// production, and proactively clean up any registration/cache left over on the origin.
	if (process.env.NODE_ENV !== 'production') {
		await unregisterServiceWorkers()
		return null
	}

	try {
		return await navigator.serviceWorker.register('/sw.js', {
			scope: '/',
			updateViaCache: 'none',
		})
	} catch {
		return null
	}
}

async function unregisterServiceWorkers(): Promise<void> {
	try {
		const registrations = await navigator.serviceWorker.getRegistrations()
		await Promise.all(registrations.map((reg) => reg.unregister()))
		if ('caches' in window) {
			const keys = await caches.keys()
			await Promise.all(keys.map((key) => caches.delete(key)))
		}
	} catch {
		// Best effort — cleanup failures must not break the app.
	}
}

async function getVapidPublicKey(): Promise<string | null> {
	try {
		const res = await fetch('/api/notifications/vapid-public-key')
		if (!res.ok) return null
		const { publicKey } = await res.json()
		return publicKey as string
	} catch {
		return null
	}
}

export async function subscribeToPush(
	reg: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
	const permission = await Notification.requestPermission()
	if (permission !== 'granted') return null

	const publicKey = await getVapidPublicKey()
	if (!publicKey) return null

	try {
		const subscription = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey),
		})

		await fetch('/api/notifications/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(subscription),
		})

		return subscription
	} catch {
		return null
	}
}

export async function unsubscribeFromPush(reg: ServiceWorkerRegistration): Promise<void> {
	const subscription = await reg.pushManager.getSubscription()
	if (!subscription) return

	await fetch('/api/notifications/unsubscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	})

	await subscription.unsubscribe()
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
	if (typeof window === 'undefined') return null
	if (!('serviceWorker' in navigator)) return null
	const reg = await navigator.serviceWorker.getRegistration('/sw.js')
	if (!reg) return null
	return reg.pushManager.getSubscription()
}
