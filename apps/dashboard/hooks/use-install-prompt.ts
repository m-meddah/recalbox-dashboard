'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
	const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
	const [isInstalled, setIsInstalled] = useState(false)
	const [isIOS, setIsIOS] = useState(false)

	useEffect(() => {
		if (
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as { standalone?: boolean }).standalone === true
		) {
			setIsInstalled(true)
			return
		}

		setIsIOS(
			/iPad|iPhone|iPod/.test(navigator.userAgent) &&
				!(window as unknown as { MSStream?: unknown }).MSStream,
		)

		const handleInstallPrompt = (e: Event) => {
			e.preventDefault()
			setInstallPrompt(e as BeforeInstallPromptEvent)
		}

		const handleAppInstalled = () => {
			setIsInstalled(true)
			setInstallPrompt(null)
		}

		window.addEventListener('beforeinstallprompt', handleInstallPrompt)
		window.addEventListener('appinstalled', handleAppInstalled)

		return () => {
			window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
			window.removeEventListener('appinstalled', handleAppInstalled)
		}
	}, [])

	const install = async () => {
		if (!installPrompt) return
		await installPrompt.prompt()
		const { outcome } = await installPrompt.userChoice
		if (outcome === 'accepted') {
			setIsInstalled(true)
			setInstallPrompt(null)
		}
	}

	return { canInstall: installPrompt !== null, isInstalled, isIOS, install }
}
