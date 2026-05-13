import { Card, CardContent } from '@/components/ui/card'

type Props = {
  currentStreak: number
  longestStreak: number
}

export function StreakCard({ currentStreak, longestStreak }: Props) {
  const isActive = currentStreak > 0

  return (
    <Card size="sm">
      <CardContent className="flex flex-col items-center justify-center py-4 text-center gap-1">
        {isActive ? (
          <>
            <p className="text-4xl font-bold text-orange-500">🔥 {currentStreak}</p>
            <p className="text-sm font-medium text-orange-400">
              jour{currentStreak > 1 ? 's' : ''} consécutif{currentStreak > 1 ? 's' : ''}
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold text-muted-foreground">💤 0</p>
            <p className="text-xs text-muted-foreground">
              Commence une nouvelle série aujourd&apos;hui&nbsp;!
            </p>
          </>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Record&nbsp;: <span className="font-semibold text-foreground">{longestStreak} jour{longestStreak > 1 ? 's' : ''}</span>
        </p>
      </CardContent>
    </Card>
  )
}
