'use client'

import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
	theme: Theme
	setTheme: (theme: Theme) => void
}>({ theme: 'light', setTheme: () => {} })

function applyTheme(t: Theme) {
	document.documentElement.classList.toggle('dark', t === 'dark')
	localStorage.setItem('theme', t)
}

export function useTheme() {
	return use(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>('light')

	useEffect(() => {
		const stored = localStorage.getItem('theme') as Theme | null
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
		const resolved = stored ?? (prefersDark ? 'dark' : 'light')
		applyTheme(resolved)
		setTheme(resolved)
	}, [])

	const handleSet = useCallback((t: Theme) => {
		setTheme(t)
		applyTheme(t)
	}, [])

	const contextValue = useMemo(() => ({ theme, setTheme: handleSet }), [theme, handleSet])

	return (
		<ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
	)
}
