'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { Download, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useEffect, useState } from 'react'

const DISMISS_KEY = 'install-banner-dismissed-at'
const DISMISS_DAYS = 14

function isDismissed(): boolean {
	try {
		const ts = localStorage.getItem(DISMISS_KEY)
		if (!ts) return false
		return Date.now() - Number(ts) < DISMISS_DAYS * 24 * 60 * 60 * 1000
	} catch {
		return false
	}
}

export function InstallBanner() {
	const t = useTranslations('pwa.installBanner')
	const { canInstall, isInstalled, isIOS, install } = useInstallPrompt()
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		if (!isInstalled && !isDismissed() && (canInstall || isIOS)) {
			setVisible(true)
		}
	}, [canInstall, isInstalled, isIOS])

	if (!visible) return null

	const dismiss = () => {
		try {
			localStorage.setItem(DISMISS_KEY, String(Date.now()))
		} catch {}
		setVisible(false)
	}

	const handleInstall = async () => {
		await install()
		setVisible(false)
	}

	return (
		<div className="fixed bottom-4 right-4 z-50 w-72 shadow-lg animate-in slide-in-from-bottom-4">
			<Card>
				<CardContent className="p-4">
					<div className="flex items-start gap-3">
						<Image
							src="/icons/icon-192.png"
							width={40}
							height={40}
							alt="Recalbox"
							className="rounded-lg flex-shrink-0"
						/>
						<div className="flex-1 min-w-0">
							<p className="font-medium text-sm">{t('title')}</p>
							<p className="text-xs text-muted-foreground mt-0.5">{t('description')}</p>
							{isIOS ? (
								<p className="text-xs text-muted-foreground mt-2 leading-relaxed">
									{t('iosInstructions')}
								</p>
							) : (
								<Button size="sm" className="mt-2 h-7 text-xs" onClick={handleInstall}>
									<Download className="size-3 mr-1" />
									{t('installButton')}
								</Button>
							)}
						</div>
						<button
							type="button"
							onClick={dismiss}
							className="text-muted-foreground hover:text-foreground flex-shrink-0 -mt-0.5"
							aria-label={t('dismissButton')}
						>
							<X className="size-4" />
						</button>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
