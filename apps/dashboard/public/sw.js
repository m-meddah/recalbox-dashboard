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

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
