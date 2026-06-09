'use client'

import { createContext, useContext } from 'react'

/**
 * Whether the current user may CONTROL the active Recalbox (launch/power/sync/etc.).
 * Computed server-side in the locale layout from the user's ownership of the active
 * machine. Read by action components to hide affordances that would otherwise 403.
 */
const CanControlContext = createContext(false)

export function CanControlProvider({
	value,
	children,
}: {
	value: boolean
	children: React.ReactNode
}) {
	return <CanControlContext.Provider value={value}>{children}</CanControlContext.Provider>
}

export function useCanControl(): boolean {
	return useContext(CanControlContext)
}
