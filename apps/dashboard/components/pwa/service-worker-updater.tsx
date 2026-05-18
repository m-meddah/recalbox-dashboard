'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

export function ServiceWorkerUpdater() {
	const t = useTranslations('pwa.update')

	useEffect(() => {
		if (!('serviceWorker' in navigator)) return

		navigator.serviceWorker.ready.then((reg) => {
			const interval = setInterval(() => reg.update(), 60 * 60 * 1000)

			reg.addEventListener('updatefound', () => {
				const newWorker = reg.installing
				if (!newWorker) return

				newWorker.addEventListener('statechange', () => {
					if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
						toast.info(t('title'), {
							description: t('description'),
							action: {
								label: t('action'),
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
	}, [t])

	return null
}
