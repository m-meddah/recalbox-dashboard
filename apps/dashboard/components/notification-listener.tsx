'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { registerServiceWorker } from '@/lib/notifications/client'
import type { AchievementUnlockedData } from '@/lib/notifications/types'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { AchievementToast } from './achievement-toast'

const MAX_TOASTS = 3

export function NotificationListener() {
	const { subscribe } = useRecalboxEvents()
	const activeToasts = useRef<string[]>([])

	useEffect(() => {
		registerServiceWorker()
	}, [])

	useEffect(() => {
		return subscribe((event) => {
			if (event.type !== 'notification') return

			const notif = event.notification
			if (activeToasts.current.length >= MAX_TOASTS) return

			const toastId = `notif-${notif.id}`
			if (activeToasts.current.includes(toastId)) return
			activeToasts.current.push(toastId)

			const cleanup = () => {
				activeToasts.current = activeToasts.current.filter((id) => id !== toastId)
			}

			switch (notif.type) {
				case 'achievement.unlocked': {
					const data = JSON.parse(notif.data) as AchievementUnlockedData
					toast.custom(
						() => (
							<div className="bg-background border rounded-lg shadow-lg p-3 w-80">
								<p className="text-xs font-medium text-muted-foreground mb-2">🏆 Succès débloqué</p>
								<AchievementToast data={data} />
							</div>
						),
						{ id: toastId, duration: 6000, onDismiss: cleanup, onAutoClose: cleanup },
					)
					break
				}
				case 'streak.milestone': {
					const data = JSON.parse(notif.data) as { days: number }
					toast(`🔥 ${data.days} jours consécutifs !`, {
						id: toastId,
						description: 'Série en cours — continuez comme ça !',
						duration: 5000,
						onDismiss: cleanup,
						onAutoClose: cleanup,
					})
					break
				}
				case 'wrapped.available': {
					const data = JSON.parse(notif.data) as { year: number }
					toast(`🎮 Votre Wrapped ${data.year} est disponible`, {
						id: toastId,
						description: 'Cliquez pour découvrir votre recap annuel',
						action: {
							label: 'Voir',
							onClick: () => {
								window.location.href = '/wrapped'
							},
						},
						duration: 8000,
						onDismiss: cleanup,
						onAutoClose: cleanup,
					})
					break
				}
				default: {
					const data = JSON.parse(notif.data) as { message?: string }
					toast(data.message ?? 'Nouvelle notification', {
						id: toastId,
						duration: 4000,
						onDismiss: cleanup,
						onAutoClose: cleanup,
					})
				}
			}
		})
	}, [subscribe])

	return null
}
