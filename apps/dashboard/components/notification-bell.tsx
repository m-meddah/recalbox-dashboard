'use client'

import type { NotificationSSEEvent } from '@/app/recalbox-events-provider'
import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import type { Notification } from '@/lib/notifications/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover'
import { Bell } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

function formatTime(date: Date | string | null): string {
	if (!date) return ''
	const d = date instanceof Date ? date : new Date(date)
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function notificationLabel(notif: Notification): { title: string; body: string } {
	try {
		const data = JSON.parse(notif.data)
		switch (notif.type) {
			case 'achievement.unlocked':
				return { title: `🏆 ${data.title}`, body: data.gameTitle ?? '' }
			case 'streak.milestone':
				return { title: `🔥 ${data.days} jours consécutifs`, body: 'Série en cours !' }
			case 'wrapped.available':
				return { title: `🎮 Wrapped ${data.year}`, body: 'Votre recap est disponible' }
			case 'game.started':
				return { title: '▶️ Partie démarrée', body: data.gameName ?? data.romPath ?? '' }
			default:
				return { title: '📢 Notification', body: data.message ?? '' }
		}
	} catch {
		return { title: '📢 Notification', body: '' }
	}
}

export function NotificationBell() {
	const { subscribe } = useRecalboxEvents()
	const [notifications, setNotifications] = useState<Notification[]>([])
	const [unreadCount, setUnreadCount] = useState(0)
	const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

	const fetchNotifications = useCallback(async () => {
		try {
			const res = await fetch('/api/notifications')
			if (!res.ok) return
			const json = await res.json()
			setNotifications(json.notifications)
			setUnreadCount(json.unreadCount)
		} catch {
			// Ignore fetch errors
		}
	}, [])

	useEffect(() => {
		fetchNotifications()
		pollTimer.current = setInterval(fetchNotifications, 30000)
		return () => {
			if (pollTimer.current) clearInterval(pollTimer.current)
		}
	}, [fetchNotifications])

	useEffect(() => {
		return subscribe((event) => {
			if (event.type !== 'notification') return
			const notifEvent = event as NotificationSSEEvent
			setNotifications((prev) => [notifEvent.notification, ...prev].slice(0, 50))
			setUnreadCount((c) => c + 1)
		})
	}, [subscribe])

	const markAllRead = async () => {
		await fetch('/api/notifications/read-all', { method: 'POST' })
		setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })))
		setUnreadCount(0)
	}

	const markRead = async (notif: Notification) => {
		if (notif.readAt) return
		await fetch(`/api/notifications/${notif.id}/read`, { method: 'PATCH' })
		setNotifications((prev) =>
			prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date() } : n)),
		)
		setUnreadCount((c) => Math.max(0, c - 1))
	}

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
						<Bell className="size-4" />
						{unreadCount > 0 && (
							<Badge className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 py-0 text-[10px]">
								{unreadCount > 99 ? '99+' : unreadCount}
							</Badge>
						)}
					</Button>
				}
			/>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between border-b px-3 py-2">
					<span className="text-sm font-semibold">Notifications</span>
					{unreadCount > 0 && (
						<button
							type="button"
							onClick={markAllRead}
							className="text-muted-foreground hover:text-foreground text-xs"
						>
							Tout marquer lu
						</button>
					)}
				</div>
				<div className="max-h-96 overflow-y-auto">
					{notifications.length === 0 ? (
						<p className="text-muted-foreground p-4 text-center text-sm">Aucune notification</p>
					) : (
						notifications.map((notif) => {
							const { title, body } = notificationLabel(notif)
							return (
								<button
									key={notif.id}
									type="button"
									onClick={() => markRead(notif)}
									className={`hover:bg-muted w-full border-b px-3 py-2.5 text-left last:border-0 ${!notif.readAt ? 'bg-primary/5' : ''}`}
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="truncate text-sm font-medium">{title}</p>
											{body && (
												<p className="text-muted-foreground mt-0.5 truncate text-xs">{body}</p>
											)}
										</div>
										<span className="text-muted-foreground shrink-0 text-[10px]">
											{formatTime(notif.createdAt)}
										</span>
									</div>
									{!notif.readAt && (
										<span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
									)}
								</button>
							)
						})
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
