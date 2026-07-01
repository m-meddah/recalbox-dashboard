'use client'

import { createContext, use } from 'react'

/**
 * Whether the app runs in serverless mode (AGENT_ONLY_MEDIA=1). Computed
 * server-side in the locale layout. Read by client components to hide UI that
 * relies on a direct SSH/MQTT link to the box (e.g. the live connection test) —
 * in serverless the cloud has no such link; the on-box agent reports liveness.
 */
const ServerlessContext = createContext(false)

export function ServerlessProvider({
	value,
	children,
}: {
	value: boolean
	children: React.ReactNode
}) {
	return <ServerlessContext.Provider value={value}>{children}</ServerlessContext.Provider>
}

export function useServerless(): boolean {
	return use(ServerlessContext)
}
