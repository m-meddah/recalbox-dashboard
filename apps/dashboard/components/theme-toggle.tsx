'use client'

import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
	const { theme, setTheme } = useTheme()

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
			aria-label="Toggle theme"
		>
			{theme === 'dark' ? <Sun /> : <Moon />}
		</Button>
	)
}
