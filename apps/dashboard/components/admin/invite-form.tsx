'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function InviteForm({ onCreated }: { onCreated: () => void }) {
	const t = useTranslations('invitations')
	const [email, setEmail] = useState('')
	const [link, setLink] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)
		setLink(null)
		setCopied(false)
		const res = await fetch('/api/invitations', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email }),
		})
		setLoading(false)
		if (res.status === 409) {
			setError(t('alreadyExists'))
			return
		}
		if (!res.ok) {
			setError(t('createError'))
			return
		}
		const data = (await res.json()) as { link: string }
		setLink(data.link)
		setEmail('')
		onCreated()
	}

	async function copy() {
		if (!link) return
		await navigator.clipboard.writeText(link)
		setCopied(true)
	}

	return (
		<div className="space-y-3">
			<form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
				<input
					type="email"
					required
					placeholder={t('emailPlaceholder')}
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className="flex-1 rounded border px-3 py-2"
				/>
				<button type="submit" disabled={loading} className="rounded bg-black px-3 py-2 text-white">
					{loading ? t('creating') : t('create')}
				</button>
			</form>
			{error && <p className="text-sm text-red-500">{error}</p>}
			{link && (
				<div className="space-y-1 rounded border bg-muted p-3">
					<p className="text-xs text-muted-foreground">{t('linkHeading')}</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 truncate text-xs">{link}</code>
						<button type="button" onClick={copy} className="rounded border px-2 py-1 text-xs">
							{copied ? t('copied') : t('copy')}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
