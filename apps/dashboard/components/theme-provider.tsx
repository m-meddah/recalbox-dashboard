'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
	theme: Theme
	setTheme: (theme: Theme) => void
}>({ theme: 'light', setTheme: () => {} })

export function useTheme() {
	return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>('light')

	useEffect(() => {
		const stored = localStorage.getItem('theme') as Theme | null
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
		const resolved = stored ?? (prefersDark ? 'dark' : 'light')
		apply(resolved)
		setTheme(resolved)
	}, [])

	function apply(t: Theme) {
		document.documentElement.classList.toggle('dark', t === 'dark')
		localStorage.setItem('theme', t)
	}

	function handleSet(t: Theme) {
		setTheme(t)
		apply(t)
	}

	return <ThemeContext.Provider value={{ theme, setTheme: handleSet }}>{children}</ThemeContext.Provider>
}
