'use client'

import { createAuthClient } from 'better-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const authClient = createAuthClient()

type State = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'ready'; email: string }

export default function AcceptInvitePage() {
	const t = useTranslations('acceptInvite')
	const router = useRouter()
	const params = useSearchParams()
	const token = params.get('token') ?? ''

	const [state, setState] = useState<State>({ kind: 'loading' })
	const [password, setPassword] = useState('')
	const [confirm, setConfirm] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		let active = true
		fetch(`/api/invitations/validate?token=${encodeURIComponent(token)}`)
			.then((r) => r.json())
			.then((data: { valid: boolean; email?: string }) => {
				if (!active) return
				setState(
					data.valid && data.email ? { kind: 'ready', email: data.email } : { kind: 'invalid' },
				)
			})
			.catch(() => active && setState({ kind: 'invalid' }))
		return () => {
			active = false
		}
	}, [token])

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		if (password.length < 8) {
			setError(t('passwordTooShort'))
			return
		}
		if (password !== confirm) {
			setError(t('passwordMismatch'))
			return
		}
		setSubmitting(true)
		const res = await fetch('/api/invitations/accept', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, password }),
		})
		if (!res.ok) {
			setSubmitting(false)
			setError(t('invalid'))
			return
		}
		const { email } = (await res.json()) as { email: string }
		const signIn = await authClient.signIn.email({ email, password })
		setSubmitting(false)
		if (signIn.error) {
			setError(signIn.error.message ?? t('signInFailed'))
			return
		}
		router.replace('/')
		router.refresh()
	}

	if (state.kind === 'loading') {
		return (
			<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
				<p className="text-sm text-muted-foreground">{t('loading')}</p>
			</main>
		)
	}

	if (state.kind === 'invalid') {
		return (
			<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
				<h1 className="text-2xl font-semibold">{t('invalidTitle')}</h1>
				<p className="text-sm text-muted-foreground">{t('invalidBody')}</p>
			</main>
		)
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-semibold">{t('title')}</h1>
			<p className="text-sm text-muted-foreground">{t('subtitle', { email: state.email })}</p>
			<form onSubmit={onSubmit} className="flex flex-col gap-3">
				<input
					type="email"
					value={state.email}
					readOnly
					className="rounded border bg-muted px-3 py-2"
				/>
				<input
					type="password"
					required
					placeholder={t('passwordPlaceholder')}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className="rounded border px-3 py-2"
				/>
				<input
					type="password"
					required
					placeholder={t('confirmPlaceholder')}
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					className="rounded border px-3 py-2"
				/>
				{error && <p className="text-sm text-red-500">{error}</p>}
				<button
					type="submit"
					disabled={submitting}
					className="rounded bg-black px-3 py-2 text-white"
				>
					{submitting ? t('submitting') : t('submit')}
				</button>
			</form>
		</main>
	)
}
