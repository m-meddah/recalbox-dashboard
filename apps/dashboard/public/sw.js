const CACHE_VERSION = 'v1'
const STATIC_CACHE = `recalbox-static-${CACHE_VERSION}`
const RUNTIME_CACHE = `recalbox-runtime-${CACHE_VERSION}`
const MAX_RUNTIME_ENTRIES = 50
const OFFLINE_URLS = ['/en/offline', '/fr/offline']
const PRECACHE_URLS = [...OFFLINE_URLS, '/icons/icon-192.png', '/icons/icon-512.png']

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE)
			.then((cache) => cache.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting()),
	)
})

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	)
})

// ─── Push & Notification ──────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
	if (!event.data) return
	const payload = event.data.json()
	event.waitUntil(
		self.registration.showNotification(payload.title, {
			body: payload.body,
			icon: payload.icon,
			badge: payload.badge,
			tag: payload.tag,
			data: payload.data,
			vibrate: [200, 100, 200],
		}),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const url = event.notification.data?.url ?? '/'
	event.waitUntil(
		self.clients.matchAll({ type: 'window' }).then((clients) => {
			for (const client of clients) {
				if (client.url.includes(self.location.origin)) {
					client.focus()
					client.navigate(url)
					return
				}
			}
			return self.clients.openWindow(url)
		}),
	)
})

// ─── Message ──────────────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
	const { request } = event
	const url = new URL(request.url)

	if (request.method !== 'GET') return
	if (url.origin !== self.location.origin) return
	if (url.pathname.startsWith('/api/')) return

	const isNavigation =
		request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')

	if (isNavigation) {
		event.respondWith(handleHtmlRequest(request, url))
	} else if (isStaticAsset(url.pathname)) {
		event.respondWith(handleStaticRequest(request))
	}
})

// Navigation: network-first → runtime cache → locale offline fallback
async function handleHtmlRequest(request, url) {
	try {
		const response = await fetch(request)
		if (response.ok) {
			const cache = await caches.open(RUNTIME_CACHE)
			cache.put(request, response.clone())
			trimCache(cache, MAX_RUNTIME_ENTRIES)
		}
		return response
	} catch {
		const cached = await caches.match(request)
		if (cached) return cached
		const locale = url.pathname.split('/')[1] ?? 'en'
		const offlineUrl = OFFLINE_URLS.includes(`/${locale}/offline`)
			? `/${locale}/offline`
			: '/en/offline'
		return (await caches.match(offlineUrl)) ?? new Response('Offline', { status: 503 })
	}
}

// Static assets: cache-first → network
async function handleStaticRequest(request) {
	const cached = await caches.match(request)
	if (cached) return cached
	const response = await fetch(request)
	if (response.ok) {
		const cache = await caches.open(STATIC_CACHE)
		cache.put(request, response.clone())
	}
	return response
}

async function trimCache(cache, maxEntries) {
	const keys = await cache.keys()
	if (keys.length > maxEntries) {
		await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)))
	}
}

function isStaticAsset(pathname) {
	return (
		pathname.startsWith('/icons/') ||
		pathname.startsWith('/fonts/') ||
		pathname.startsWith('/_next/static/') ||
		/\.(png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf)$/.test(pathname)
	)
}
