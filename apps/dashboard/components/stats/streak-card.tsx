import { Card, CardContent } from '@/components/ui/card'
import { getTranslations } from 'next-intl/server'

type Props = {
	currentStreak: number
	longestStreak: number
}

export async function StreakCard({ currentStreak, longestStreak }: Props) {
	const t = await getTranslations('stats')
	const isActive = currentStreak > 0

	return (
		<Card size="sm">
			<CardContent className="flex flex-col items-center justify-center py-4 text-center gap-1">
				{isActive ? (
					<>
						<p className="text-4xl font-bold text-orange-500">🔥 {currentStreak}</p>
						<p className="text-sm font-medium text-orange-400">
							{t('streak.days', { count: currentStreak })}
						</p>
					</>
				) : (
					<>
						<p className="text-2xl font-bold text-muted-foreground">💤 0</p>
						<p className="text-xs text-muted-foreground">{t('streak.noStreak')}</p>
					</>
				)}
				<p className="mt-2 text-xs text-muted-foreground">
					{t('streak.record', { days: longestStreak })}
				</p>
			</CardContent>
		</Card>
	)
}
