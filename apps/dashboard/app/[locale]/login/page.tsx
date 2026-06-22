'use client'

import { createAuthClient } from 'better-auth/react'
import { Eye, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const authClient = createAuthClient()

export default function LoginPage() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)
		const { error } = await authClient.signIn.email({ email, password })
		setLoading(false)
		if (error) {
			setError(error.message ?? 'Sign in failed')
			return
		}
		router.replace('/')
		router.refresh()
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-semibold">Sign in</h1>
			<form onSubmit={onSubmit} className="flex flex-col gap-3">
				<input
					type="email"
					required
					placeholder="Email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className="rounded border px-3 py-2"
				/>
				<div className="relative">
					<input
						type={showPassword ? 'text' : 'password'}
						required
						placeholder="Password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="w-full rounded border px-3 py-2 pr-10"
					/>
					<button
						type="button"
						onClick={() => setShowPassword((v) => !v)}
						aria-label={showPassword ? 'Hide password' : 'Show password'}
						aria-pressed={showPassword}
						className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-800"
					>
						{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
					</button>
				</div>
				{error && <p className="text-sm text-red-500">{error}</p>}
				<button type="submit" disabled={loading} className="rounded bg-black px-3 py-2 text-white">
					{loading ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		</main>
	)
}
