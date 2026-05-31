import Image from 'next/image'
import type { AchievementUnlockedData } from '@/lib/notifications/types'

type Props = {
	data: AchievementUnlockedData
}

export function AchievementToast({ data }: Props) {
	return (
		<div className="flex items-start gap-3">
			{data.imageUrl && (
				<Image
					src={data.imageUrl}
					alt={data.title}
					width={48}
					height={48}
					className="size-12 shrink-0 rounded object-cover"
				/>
			)}
			<div className="min-w-0">
				<p className="text-sm font-semibold leading-tight">{data.title}</p>
				<p className="text-muted-foreground mt-0.5 truncate text-xs">{data.gameTitle}</p>
				<div className="mt-1 flex items-center gap-1.5">
					<span className="text-xs font-medium text-yellow-500">+{data.points} pts</span>
					{data.isHardcore && (
						<span className="rounded bg-red-500 px-1 py-0.5 text-[10px] font-bold text-white">
							HARDCORE
						</span>
					)}
				</div>
			</div>
		</div>
	)
}
