'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type AgentToken = {
	id: string
	name: string | null
	createdAt: string
	lastUsedAt: string | null
}
type Minted = { token: string; ingestUrl: string }

export function AgentTokensSection({ recalboxId }: { recalboxId: string }) {
	const t = useTranslations('agentTokens')
	const [tokens, setTokens] = useState<AgentToken[]>([])
	const [name, setName] = useState('')
	const [minting, setMinting] = useState(false)
	const [minted, setMinted] = useState<Minted | null>(null)
	const [copied, setCopied] = useState(false)

	const load = useCallback(() => {
		fetch(`/api/recalboxes/${recalboxId}/agent-tokens`)
			.then((r) => (r.ok ? r.json() : { tokens: [] }))
			.then((d: { tokens: AgentToken[] }) => setTokens(d.tokens ?? []))
			.catch(() => setTokens([]))
	}, [recalboxId])

	useEffect(() => {
		load()
	}, [load])

	const configSnippet = minted
		? JSON.stringify(
				{ recalbox_id: recalboxId, token: minted.token, cloud_url: minted.ingestUrl },
				null,
				2,
			)
		: ''

	async function mint(e: React.FormEvent) {
		e.preventDefault()
		setMinting(true)
		setMinted(null)
		setCopied(false)
		try {
			const res = await fetch(`/api/recalboxes/${recalboxId}/agent-tokens`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim() || undefined }),
			})
			if (!res.ok) throw new Error()
			setMinted((await res.json()) as Minted)
			setName('')
			load()
		} catch {
			toast.error(t('createError'))
		} finally {
			setMinting(false)
		}
	}

	async function revoke(id: string) {
		if (!confirm(t('revokeConfirm'))) return
		await fetch(`/api/recalboxes/${recalboxId}/agent-tokens/${id}`, { method: 'DELETE' })
		load()
	}

	async function copyConfig() {
		await navigator.clipboard.writeText(configSnippet)
		setCopied(true)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('heading')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">{t('description')}</p>

				<form onSubmit={mint} className="flex flex-col gap-2 sm:flex-row">
					<input
						type="text"
						placeholder={t('namePlaceholder')}
						aria-label={t('namePlaceholder')}
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="flex-1 rounded border px-3 py-2 text-sm"
					/>
					<Button type="submit" disabled={minting}>
						{minting ? t('generating') : t('generate')}
					</Button>
				</form>

				{minted && (
					<div className="space-y-2 rounded border bg-muted p-3">
						<p className="font-medium text-amber-600 text-xs dark:text-amber-500">
							{t('onceWarning')}
						</p>
						<pre className="overflow-x-auto rounded bg-background p-2 text-xs">{configSnippet}</pre>
						<Button type="button" variant="outline" size="sm" onClick={copyConfig}>
							{copied ? t('copied') : t('copyConfig')}
						</Button>
					</div>
				)}

				{tokens.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t('none')}</p>
				) : (
					<ul className="space-y-2">
						{tokens.map((tok) => (
							<li
								key={tok.id}
								className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
							>
								<span className="min-w-0 truncate">
									{tok.name || t('unnamed')}{' '}
									<span className="text-muted-foreground text-xs">
										{tok.lastUsedAt
											? t('lastUsed', { date: new Date(tok.lastUsedAt).toLocaleString() })
											: t('neverUsed')}
									</span>
								</span>
								<Button type="button" variant="ghost" size="sm" onClick={() => revoke(tok.id)}>
									{t('revoke')}
								</Button>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}
