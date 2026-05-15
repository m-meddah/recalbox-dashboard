'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LanguageSwitcher } from '@/components/language-switcher'
import type { AppConfig } from '@/lib/settings/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

// ─── Schemas ────────────────────────────────────────────────────────────────

const recalboxFormSchema = z.object({
	host: z
		.string()
		.min(1)
		.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().max(128),
	sshPort: z.number().int().min(1).max(65535),
	mqttPort: z.number().int().min(1).max(65535),
})
type RecalboxForm = z.infer<typeof recalboxFormSchema>

const scrobbleFormSchema = z.object({
	minDurationSec: z.number().int().min(0),
	maxDurationHours: z.number().min(0),
	orphanRecoveryHours: z.number().min(0),
})
type ScrobbleForm = z.infer<typeof scrobbleFormSchema>

const uiFormSchema = z.object({
	locale: z.string().min(2).max(10),
	theme: z.enum(['light', 'dark', 'system']),
	weekStartsOn: z.union([z.literal(0), z.literal(1)]),
})
type UiForm = z.infer<typeof uiFormSchema>

type TestResult = {
	ssh: { success: boolean; latencyMs: number; error?: string }
	mqtt: { success: boolean; latencyMs: number; messagesReceived: number; error?: string }
	overall: 'ok' | 'partial' | 'failed'
}

// ─── Recalbox tab ────────────────────────────────────────────────────────────

function RecalboxTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.recalbox')
	const tc = useTranslations('common')
	const [showPassword, setShowPassword] = useState(false)
	const [testing, setTesting] = useState(false)
	const [testResult, setTestResult] = useState<TestResult | null>(null)

	const form = useForm<RecalboxForm>({
		resolver: zodResolver(recalboxFormSchema),
		defaultValues: {
			host: config.recalbox.host,
			sshUser: config.recalbox.sshUser,
			sshPassword: '',
			sshPort: config.recalbox.sshPort,
			mqttPort: config.recalbox.mqttPort,
		},
	})

	const isDirty = form.formState.isDirty

	useEffect(() => {
		const handleUnload = (e: BeforeUnloadEvent) => {
			if (isDirty) e.preventDefault()
		}
		window.addEventListener('beforeunload', handleUnload)
		return () => window.removeEventListener('beforeunload', handleUnload)
	}, [isDirty])

	async function onSave(values: RecalboxForm) {
		const body = { recalbox: values }
		if (!values.sshPassword) {
			body.recalbox = { ...values, sshPassword: '***' }
		}
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})
			if (!res.ok) throw new Error()
			const updated: AppConfig = await res.json()
			form.reset({
				host: updated.recalbox.host,
				sshUser: updated.recalbox.sshUser,
				sshPassword: '',
				sshPort: updated.recalbox.sshPort,
				mqttPort: updated.recalbox.mqttPort,
			})
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	async function onTest() {
		const values = form.getValues()
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch('/api/settings/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...values,
					sshPassword: values.sshPassword || '***',
				}),
			})
			setTestResult(await res.json())
		} catch {
			toast.error(t('testError'))
		} finally {
			setTesting(false)
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
				<Alert>
					<AlertDescription>{t('passwordWarning')}</AlertDescription>
				</Alert>

				<FormField
					control={form.control}
					name="host"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('host')}</FormLabel>
							<FormControl>
								<Input placeholder="recalbox.local" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className="grid grid-cols-2 gap-4">
					<FormField
						control={form.control}
						name="sshUser"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t('sshUser')}</FormLabel>
								<FormControl>
									<Input placeholder="root" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="sshPassword"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t('sshPassword')}</FormLabel>
								<FormControl>
									<div className="relative">
										<Input
											type={showPassword ? 'text' : 'password'}
											placeholder={t('sshPasswordPlaceholder')}
											{...field}
										/>
										<button
											type="button"
											onClick={() => setShowPassword((v) => !v)}
											className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
										>
											{showPassword ? t('hidePassword') : t('showPassword')}
										</button>
									</div>
								</FormControl>
								<FormDescription>{t('sshPasswordHint')}</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<FormField
						control={form.control}
						name="sshPort"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t('sshPort')}</FormLabel>
								<FormControl>
									<Input
										type="number"
										{...field}
										onChange={(e) => field.onChange(e.target.valueAsNumber)}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="mqttPort"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t('mqttPort')}</FormLabel>
								<FormControl>
									<Input
										type="number"
										{...field}
										onChange={(e) => field.onChange(e.target.valueAsNumber)}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				{/* Test connection */}
				<div className="space-y-3">
					<Button type="button" variant="outline" onClick={onTest} disabled={testing}>
						{testing ? t('testing') : t('testConnection')}
					</Button>
					{testResult && (
						<div className="space-y-2">
							<TestResultRow
								label="SSH"
								success={testResult.ssh.success}
								latency={testResult.ssh.latencyMs}
								error={testResult.ssh.error}
							/>
							<TestResultRow
								label="MQTT"
								success={testResult.mqtt.success}
								latency={testResult.mqtt.latencyMs}
								error={testResult.mqtt.error}
							/>
						</div>
					)}
				</div>

				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() =>
							form.reset({
								host: config.recalbox.host,
								sshUser: config.recalbox.sshUser,
								sshPassword: '',
								sshPort: config.recalbox.sshPort,
								mqttPort: config.recalbox.mqttPort,
							})
						}
						disabled={!isDirty}
					>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
				</div>
			</form>
		</Form>
	)
}

// ─── Scrobble tab ────────────────────────────────────────────────────────────

function ScrobbleTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.scrobble')
	const tc = useTranslations('common')

	const form = useForm<ScrobbleForm>({
		resolver: zodResolver(scrobbleFormSchema),
		defaultValues: {
			minDurationSec: config.scrobble.minDurationSec,
			maxDurationHours: config.scrobble.maxDurationHours,
			orphanRecoveryHours: config.scrobble.orphanRecoveryHours,
		},
	})
	const isDirty = form.formState.isDirty

	async function onSave(values: ScrobbleForm) {
		try {
			await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scrobble: values }),
			})
			form.reset(values)
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
				<FormField
					control={form.control}
					name="minDurationSec"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('minDuration')}</FormLabel>
							<FormControl>
								<Input
									type="number"
									{...field}
									onChange={(e) => field.onChange(e.target.valueAsNumber)}
								/>
							</FormControl>
							<FormDescription>{t('minDurationHint')}</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="maxDurationHours"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('maxDuration')}</FormLabel>
							<FormControl>
								<Input
									type="number"
									step="0.1"
									{...field}
									onChange={(e) => field.onChange(e.target.valueAsNumber)}
								/>
							</FormControl>
							<FormDescription>{t('maxDurationHint')}</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="orphanRecoveryHours"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('orphanRecovery')}</FormLabel>
							<FormControl>
								<Input
									type="number"
									step="0.5"
									{...field}
									onChange={(e) => field.onChange(e.target.valueAsNumber)}
								/>
							</FormControl>
							<FormDescription>{t('orphanRecoveryHint')}</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={() => form.reset()} disabled={!isDirty}>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
				</div>
			</form>
		</Form>
	)
}

// ─── UI tab ──────────────────────────────────────────────────────────────────

function UiTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.interface')
	const tc = useTranslations('common')

	const form = useForm<UiForm>({
		resolver: zodResolver(uiFormSchema),
		defaultValues: {
			locale: config.ui.locale,
			theme: config.ui.theme,
			weekStartsOn: config.ui.weekStartsOn,
		},
	})
	const isDirty = form.formState.isDirty

	async function onSave(values: UiForm) {
		try {
			await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ui: values }),
			})
			form.reset(values)
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
				<div className="space-y-2">
					<p className="text-sm font-medium">{t('language')}</p>
					<LanguageSwitcher />
				</div>

				<FormField
					control={form.control}
					name="theme"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('theme')}</FormLabel>
							<FormControl>
								<Select onValueChange={(v) => v && field.onChange(v)} defaultValue={field.value}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="system">{t('themeSystem')}</SelectItem>
										<SelectItem value="light">{t('themeLight')}</SelectItem>
										<SelectItem value="dark">{t('themeDark')}</SelectItem>
									</SelectContent>
								</Select>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="weekStartsOn"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('weekStartsOn')}</FormLabel>
							<FormControl>
								<Select
									onValueChange={(v) => field.onChange(Number.parseInt(v ?? '1', 10))}
									defaultValue={String(field.value)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="1">{t('weekMonday')}</SelectItem>
										<SelectItem value="0">{t('weekSunday')}</SelectItem>
									</SelectContent>
								</Select>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={() => form.reset()} disabled={!isDirty}>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
				</div>
			</form>
		</Form>
	)
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
	const t = useTranslations('settings')
	const [config, setConfig] = useState<AppConfig | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		fetch('/api/settings')
			.then((r) => r.json())
			.then((data: AppConfig) => {
				setConfig(data)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	if (loading) {
		return <div className="p-8 text-muted-foreground text-sm">{t('loading')}</div>
	}

	if (!config) {
		return <div className="p-8 text-destructive text-sm">{t('loadError')}</div>
	}

	return (
		<div className="container max-w-2xl mx-auto p-6 space-y-6">
			<Toaster />
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground text-sm">{t('subtitle')}</p>
			</div>
			<Tabs defaultValue="recalbox">
				<TabsList className="grid w-full grid-cols-3">
					<TabsTrigger value="recalbox">{t('tabs.recalbox')}</TabsTrigger>
					<TabsTrigger value="scrobble">{t('tabs.scrobble')}</TabsTrigger>
					<TabsTrigger value="interface">{t('tabs.interface')}</TabsTrigger>
				</TabsList>
				<TabsContent value="recalbox" className="mt-6">
					<Card>
						<CardHeader>
							<CardTitle>{t('recalbox.cardTitle')}</CardTitle>
							<CardDescription>{t('recalbox.cardDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<RecalboxTab config={config} />
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value="scrobble" className="mt-6">
					<Card>
						<CardHeader>
							<CardTitle>{t('scrobble.cardTitle')}</CardTitle>
							<CardDescription>{t('scrobble.cardDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<ScrobbleTab config={config} />
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value="interface" className="mt-6">
					<Card>
						<CardHeader>
							<CardTitle>{t('interface.cardTitle')}</CardTitle>
							<CardDescription>{t('interface.cardDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<UiTab config={config} />
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}

function TestResultRow({
	label,
	success,
	latency,
	error,
}: {
	label: string
	success: boolean
	latency: number
	error?: string
}) {
	return (
		<div className="flex items-center gap-3 rounded-md border p-2 text-sm">
			<span className={success ? 'text-green-500' : 'text-red-500'}>{success ? '✓' : '✗'}</span>
			<span className="font-medium w-12">{label}</span>
			<span className="text-muted-foreground flex-1">{error ?? 'OK'}</span>
			<span className="text-muted-foreground">{latency}ms</span>
		</div>
	)
}
