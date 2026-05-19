import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { cn } from '@/lib/utils'
import { getTranslations } from 'next-intl/server'

export default async function RecalboxesPage() {
	const t = await getTranslations('recalboxes')
	const all = configStore.getRecalboxes()
	const activeId = await getActiveRecalboxId()
	const active = all.filter((r) => !r.archived)
	const archived = all.filter((r) => r.archived)

	return (
		<div className="container max-w-3xl mx-auto p-6 space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{t('page.title')}</h1>
				<Link href="/recalboxes/add" className={cn(buttonVariants())}>
					+ {t('page.add')}
				</Link>
			</div>
			<div className="grid gap-4">
				{active.map((rb) => (
					<Card key={rb.id} className={rb.id === activeId ? 'border-primary' : ''}>
						<CardHeader className="flex flex-row items-center justify-between pb-2">
							<CardTitle className="text-base flex items-center gap-2">
								<span>{rb.iconEmoji ?? '🕹️'}</span>
								<span>{rb.name}</span>
								{rb.isDefault && (
									<span className="text-xs text-muted-foreground border rounded px-1">
										{t('page.default')}
									</span>
								)}
								{rb.id === activeId && (
									<span className="text-xs text-primary border border-primary rounded px-1">
										{t('page.active')}
									</span>
								)}
							</CardTitle>
							<div className="flex gap-2">
								<Link
									href={`/recalboxes/${rb.id}/edit`}
									className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
								>
									{t('page.edit')}
								</Link>
							</div>
						</CardHeader>
						<CardContent className="text-sm text-muted-foreground">
							{rb.host} · SSH:{rb.sshPort} · MQTT:{rb.mqttPort}
						</CardContent>
					</Card>
				))}
			</div>
			{archived.length > 0 && (
				<div className="space-y-2">
					<p className="text-sm font-medium text-muted-foreground">{t('page.archived')}</p>
					{archived.map((rb) => (
						<Card key={rb.id} className="opacity-60">
							<CardHeader className="flex flex-row items-center justify-between py-3">
								<span className="text-sm">
									{rb.iconEmoji ?? '🕹️'} {rb.name}
								</span>
								<Link
									href={`/recalboxes/${rb.id}/edit`}
									className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
								>
									{t('page.edit')}
								</Link>
							</CardHeader>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
