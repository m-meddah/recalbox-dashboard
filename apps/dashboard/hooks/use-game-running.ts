'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { useCallback, useEffect, useState } from 'react'

/**
 * Tracks whether a real (non-screensaver) game is currently running on the Recalbox,
 * from the live MQTT event stream. Used to prevent launching a second game while one
 * is in progress — EmulationStation can't switch mid-game and would apply the queued
 * command only when the player returns to the menu.
 *
 * Note: only reflects events seen since mount; if a game was already running when the
 * page loaded (no `game:start` received), it reports false until the next event.
 */
export function useGameRunning(): { running: boolean; gameName: string | null } {
	const { subscribe } = useRecalboxEvents()
	const [game, setGame] = useState<{ romPath: string; name: string } | null>(null)

	const handle = useCallback((event: { type: string } & Record<string, unknown>) => {
		if (event.type === 'game:start') {
			const e = event as unknown as GameStartEvent
			if (e.fromScreensaver) return // demo / attract mode doesn't count
			setGame({ romPath: e.romPath, name: e.gameName })
		} else if (event.type === 'game:stop') {
			const e = event as unknown as GameStopEvent
			setGame((prev) => (prev?.romPath === e.romPath ? null : prev))
		} else if (event.type === 'screensaver:start') {
			setGame(null)
		}
	}, [])

	useEffect(() => subscribe(handle), [subscribe, handle])

	return { running: game !== null, gameName: game?.name ?? null }
}
