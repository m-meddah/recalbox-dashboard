import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { loadRecalboxes } from '@/lib/auth/recalbox-acl'
import { getUser } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { isServerlessMode } from '@/lib/serverless'
import { cn } from '@/lib/utils'
import { getTranslations } from 'next-intl/server'

export default async function RecalboxesPage() {
	const t = await getTranslations('recalboxes')
	const user = await getUser()
	const viewable = user ? new Set(await getViewableRecalboxIds(user)) : new Set<string>()
	const all = (user ? await loadRecalboxes() : []).filter((rb) => viewable.has(rb.id))
	const activeId = await getActiveRecalboxId()
	const active = all.filter((r) => !r.archived)
	const archived = all.filter((r) => r.archived)
	const serverless = isServerlessMode()

	// "Never seen" only means anything for serverless enrollment (the guided
	// wizard): self-hosted boxes connect straight over SSH/MQTT and never
	// install the on-box agent, so they'd otherwise show as permanently
	// "awaiting setup" for a step they don't need.
	//
	// `getAgentLastSeen` is `cache()`-wrapped and already grouped over every
	// box in one query; in serverless mode the layout's `buildSeedState` call
	// already invoked it this request (see lib/sse/build-seed-state.ts), so
	// this costs zero additional round trips rather than one query per box.
	const lastSeen = serverless ? await getAgentLastSeen(db) : new Map<string, Date>()
	const pendingIds = serverless
		? new Set(active.filter((rb) => !lastSeen.has(rb.id)).map((rb) => rb.id))
		: new Set<string>()

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{t('page.title')}</h1>
				<Link href="/recalboxes/add" className={cn(buttonVariants())}>
					+ {t('page.add')}
				</Link>
			</div>
			<div className="grid gap-4">
				{active.map((rb) => {
					const pending = pendingIds.has(rb.id)
					return (
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
									{pending && (
										<span className="text-xs text-muted-foreground border rounded px-1">
											{t('wizard.pending')}
										</span>
									)}
								</CardTitle>
								<div className="flex gap-2">
									{pending && (
										<Link
											href={`/recalboxes/add?startAt=install&recalboxId=${encodeURIComponent(rb.id)}`}
											className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
										>
											{t('wizard.resume')}
										</Link>
									)}
									<Link
										href={`/recalboxes/${rb.id}/edit`}
										className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
									>
										{t('page.edit')}
									</Link>
								</div>
							</CardHeader>
							{!serverless && (
								<CardContent className="text-sm text-muted-foreground">
									{rb.host} · SSH:{rb.sshPort} · MQTT:{rb.mqttPort}
								</CardContent>
							)}
						</Card>
					)
				})}
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
