import type { WrappedSlide, Wrapped } from '@/lib/wrapped/types'
import { IntroSlideView } from './slides/intro-slide'
import { TotalTimeSlideView } from './slides/total-time-slide'
import { MostPlayedGameSlideView } from './slides/most-played-game-slide'
import { TopSystemSlideView } from './slides/top-system-slide'
import { TopGamesListSlideView } from './slides/top-games-list-slide'
import { LongestSessionSlideView } from './slides/longest-session-slide'
import { BusiestDaySlideView } from './slides/busiest-day-slide'
import { StreakSlideView } from './slides/streak-slide'
import { AchievementsSlideView } from './slides/achievements-slide'
import { UnlocksSlideView } from './slides/unlocks-slide'
import { ComparisonSlideView } from './slides/comparison-slide'
import { OutroSlideView } from './slides/outro-slide'

type Props = { slide: WrappedSlide; wrapped: Wrapped; slideIndex: number }

export function SlideRenderer({ slide, wrapped, slideIndex }: Props) {
	switch (slide.type) {
		case 'intro':              return <IntroSlideView slide={slide} wrapped={wrapped} />
		case 'total-time':         return <TotalTimeSlideView slide={slide} />
		case 'most-played-game':   return <MostPlayedGameSlideView slide={slide} />
		case 'top-system':         return <TopSystemSlideView slide={slide} />
		case 'top-games-list':     return <TopGamesListSlideView slide={slide} />
		case 'longest-session':    return <LongestSessionSlideView slide={slide} />
		case 'busiest-day':        return <BusiestDaySlideView slide={slide} />
		case 'streak':             return <StreakSlideView slide={slide} />
		case 'achievements-summary': return <AchievementsSlideView slide={slide} />
		case 'unlocks':            return <UnlocksSlideView slide={slide} />
		case 'comparison-vs-others': return <ComparisonSlideView slide={slide} />
		case 'outro':              return <OutroSlideView slide={slide} shareSlideIndex={slideIndex} />
		default:                   return null
	}
}
