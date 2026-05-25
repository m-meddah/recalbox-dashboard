'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'

export function ServiceWorkerUpdater() {
	const tUpdate = useTranslations('pwa.update')
	const tConnection = useTranslations('pwa.connection')

	useEffect(() => {
		if (!('serviceWorker' in navigator)) return

		navigator.serviceWorker.ready.then((reg) => {
			const interval = setInterval(() => reg.update(), 60 * 60 * 1000)

			reg.addEventListener('updatefound', () => {
				const newWorker = reg.installing
				if (!newWorker) return

				newWorker.addEventListener('statechange', () => {
					if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
						toast.info(tUpdate('title'), {
							description: tUpdate('description'),
							action: {
								label: tUpdate('action'),
								onClick: () => {
									newWorker.postMessage({ type: 'SKIP_WAITING' })
									window.location.reload()
								},
							},
							duration: Number.POSITIVE_INFINITY,
						})
					}
				})
			})

			return () => clearInterval(interval)
		})
	}, [tUpdate])

	useEffect(() => {
		const onOffline = () => toast.warning(tConnection('offline'), { id: 'connection-status' })
		const onOnline = () =>
			toast.success(tConnection('online'), { id: 'connection-status', duration: 3000 })

		window.addEventListener('offline', onOffline)
		window.addEventListener('online', onOnline)
		return () => {
			window.removeEventListener('offline', onOffline)
			window.removeEventListener('online', onOnline)
		}
	}, [tConnection])

	return null
}
