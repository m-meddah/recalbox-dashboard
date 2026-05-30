import { Link } from '@/i18n/navigation'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

type Props = {
	year: number
	hours: number
	minutes: number
	topGame: string | null
}

export function WrappedPreviewBanner({ year, hours, minutes, topGame }: Props) {
	const t = useTranslations('wrapped.statsBanner')
	const duration = hours > 0 ? (minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`) : `${minutes}m`
	return (
		<Link
			href={`/wrapped/${year}`}
			className="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200 transition-colors hover:bg-purple-500/20"
		>
			<Sparkles className="h-4 w-4 shrink-0 text-purple-400" />
			<span className="flex-1 truncate">
				{t('text', { year, duration, topGame: topGame ?? '…' })}
			</span>
			<span className="shrink-0 text-xs font-medium text-purple-300">{t('cta')} →</span>
		</Link>
	)
}
