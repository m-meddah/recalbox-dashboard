'use client'

import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type Props = {
	srHasPage: number | null
	srUrl: string | null
	variant?: 'button' | 'icon' | 'badge'
	romPath?: string
}

export function SuperRetrogamersLink({ srHasPage, srUrl, variant = 'button', romPath }: Props) {
	const t = useTranslations('superRetrogamers')
	const [checking, setChecking] = useState(false)

	async function handleCheck() {
		if (!romPath) return
		setChecking(true)
		try {
			await fetch('/api/super-retrogamers/lookup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slugs: [], romPaths: [romPath] }),
			})
			window.location.reload()
		} catch {
			// silently fail
		} finally {
			setChecking(false)
		}
	}

	if (srHasPage === 1 && srUrl) {
		if (variant === 'badge') {
			return (
				<a
					href={srUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
				>
					SR ✓
				</a>
			)
		}
		if (variant === 'icon') {
			return (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>
							<a
								href={srUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center text-violet-400 hover:text-violet-300 transition-colors"
							>
								<ExternalLink className="size-3.5" />
							</a>
						</TooltipTrigger>
						<TooltipContent>{t('viewOnSr')}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)
		}
		return (
			<a
				href={srUrl}
				target="_blank"
				rel="noopener noreferrer"
				className={buttonVariants({ variant: 'outline', size: 'sm' })}
			>
				{t('viewOnSr')}
				<ExternalLink className="ml-1.5 size-3.5" />
			</a>
		)
	}

	if (srHasPage === 0) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger>
						<span className="inline-flex items-center gap-1 rounded border border-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground cursor-default select-none">
							SR
						</span>
					</TooltipTrigger>
					<TooltipContent>{t('noPage')}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	// null — never checked
	if (variant === 'badge' && romPath) {
		return (
			<button
				type="button"
				onClick={handleCheck}
				disabled={checking}
				className="inline-flex items-center gap-1 rounded border border-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-violet-500/40 hover:text-violet-400 transition-colors disabled:opacity-50"
			>
				{checking ? '…' : t('check')}
			</button>
		)
	}

	return null
}
