'use client'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import {
	registerServiceWorker,
	subscribeToPush,
	unsubscribeFromPush,
} from '@/lib/notifications/client'
import { DEFAULT_PREFERENCES, type NotificationPreferences } from '@/lib/notifications/types'
import type { AppConfig } from '@/lib/settings/schemas'
import { cn } from '@/lib/utils'
import { HOST_REGEX } from '@/lib/validation/host'
import { zodResolver } from '@hookform/resolvers/zod'
import {
	Bell,
	CheckCircle2,
	Circle,
	Clock,
	Database,
	ExternalLink,
	Loader2,
	Palette,
	Plug,
	Radio,
	Server,
	Smartphone,
	Trophy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

// ─── Schemas ────────────────────────────────────────────────────────────────

const recalboxFormSchema = z.object({
	host: z.string().min(1).regex(HOST_REGEX, 'Invalid hostname'),
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

const raFormSchema = z.object({
	enabled: z.boolean(),
	username: z.string().max(64),
	apiKey: z.string().max(256),
	autoSyncMinutes: z.number().int().min(1).max(1440),
})
type RaForm = z.infer<typeof raFormSchema>

const srFormSchema = z.object({
	enabled: z.boolean(),
	apiUrl: z.string().max(256),
	preferredRegion: z.enum(['US', 'EU', 'JP', '']),
})
type SrForm = z.infer<typeof srFormSchema>

const mqttPublishFormSchema = z.object({
	enabled: z.boolean(),
	brokerUrl: z.string().max(256),
	topicPrefix: z.string().max(64),
	homeAssistantDiscovery: z.boolean(),
})
type MqttPublishForm = z.infer<typeof mqttPublishFormSchema>

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

// ─── RetroAchievements tab ───────────────────────────────────────────────────

function RetroAchievementsTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.retroachievements')
	const tc = useTranslations('common')
	const [showApiKey, setShowApiKey] = useState(false)
	const [fetchingUsername, setFetchingUsername] = useState(false)
	const [testing, setTesting] = useState(false)
	const [testOk, setTestOk] = useState<boolean | null>(null)

	const form = useForm<RaForm>({
		resolver: zodResolver(raFormSchema),
		defaultValues: {
			enabled: config.retroachievements.enabled,
			username: config.retroachievements.username,
			apiKey: config.retroachievements.apiKey,
			autoSyncMinutes: config.retroachievements.autoSyncMinutes,
		},
	})

	const isDirty = form.formState.isDirty

	async function fetchUsername() {
		setFetchingUsername(true)
		try {
			const res = await fetch('/api/recalbox/conf?key=global.retroachievements.username')
			const data = await res.json()
			if (data.value) form.setValue('username', data.value, { shouldDirty: true })
			else toast.info(t('usernameNotFound'))
		} catch {
			toast.error(t('usernameError'))
		} finally {
			setFetchingUsername(false)
		}
	}

	async function onSave(values: RaForm) {
		const body: Record<string, unknown> = { retroachievements: values }
		if (!values.apiKey) {
			;(body.retroachievements as Record<string, unknown>).apiKey = undefined
		}
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})
			if (!res.ok) throw new Error()
			form.reset(values)
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	async function handleTestConnection() {
		setTesting(true)
		setTestOk(null)
		try {
			const res = await fetch('/api/retroachievements/test-connection', { method: 'POST' })
			const data = await res.json()
			setTestOk(data.ok)
			if (data.ok) toast.success(t('testSuccess', { user: data.user }))
			else toast.error(t('testError', { error: data.error ?? '' }))
		} catch {
			setTestOk(false)
			toast.error(t('testError', { error: 'Network error' }))
		} finally {
			setTesting(false)
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
				<FormField
					control={form.control}
					name="enabled"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<FormLabel>{t('enabled')}</FormLabel>
								<FormDescription>{t('enabledHint')}</FormDescription>
							</div>
							<FormControl>
								<Switch checked={field.value} onCheckedChange={field.onChange} />
							</FormControl>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="username"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('username')}</FormLabel>
							<FormControl>
								<div className="flex gap-2">
									<Input {...field} placeholder={t('usernamePlaceholder')} className="flex-1" />
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={fetchUsername}
										disabled={fetchingUsername}
										title={t('fetchUsernameHint')}
									>
										{fetchingUsername ? '…' : '🔄'}
									</Button>
								</div>
							</FormControl>
							<FormDescription>{t('usernameHint')}</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="apiKey"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('apiKey')}</FormLabel>
							<FormControl>
								<div className="flex gap-2">
									<Input
										{...field}
										type={showApiKey ? 'text' : 'password'}
										placeholder={t('apiKeyPlaceholder')}
										className="flex-1 font-mono text-sm"
									/>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setShowApiKey((v) => !v)}
									>
										{showApiKey ? t('hideApiKey') : t('showApiKey')}
									</Button>
								</div>
							</FormControl>
							<FormDescription>
								{t('apiKeyHint')}{' '}
								<a
									href="https://retroachievements.org/controlpanel.php"
									target="_blank"
									rel="noopener noreferrer"
									className="underline"
								>
									retroachievements.org/controlpanel.php
								</a>
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="autoSyncMinutes"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('autoSync')}</FormLabel>
							<FormControl>
								<Input
									type="number"
									min={1}
									max={1440}
									{...field}
									onChange={(e) => field.onChange(Number(e.target.value))}
								/>
							</FormControl>
							<FormDescription>{t('autoSyncHint')}</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<div className="flex gap-2 flex-wrap">
					<Button type="button" variant="outline" onClick={() => form.reset()} disabled={!isDirty}>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={handleTestConnection}
						disabled={testing}
					>
						{testing ? t('testing') : t('testConnection')}
					</Button>
				</div>
				{testOk === true && (
					<Alert>
						<AlertDescription className="text-green-600">{t('testOk')}</AlertDescription>
					</Alert>
				)}
				{testOk === false && (
					<Alert variant="destructive">
						<AlertDescription>{t('testFailed')}</AlertDescription>
					</Alert>
				)}
			</form>
		</Form>
	)
}

// ─── Integrations tab ────────────────────────────────────────────────────────

function IntegrationsTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.integrations')
	const tc = useTranslations('common')
	const [testing, setTesting] = useState(false)
	const [testResult, setTestResult] = useState<{
		ok: boolean
		latencyMs?: number
		error?: string
	} | null>(null)
	const [enriching, setEnriching] = useState(false)
	const [enrichProgress, setEnrichProgress] = useState<string | null>(null)

	const form = useForm<SrForm>({
		resolver: zodResolver(srFormSchema),
		defaultValues: {
			enabled: config.superRetrogamers.enabled,
			apiUrl: config.superRetrogamers.apiUrl,
			preferredRegion: config.superRetrogamers.preferredRegion,
		},
	})
	const isDirty = form.formState.isDirty

	async function onSave(values: SrForm) {
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ superRetrogamers: values }),
			})
			if (!res.ok) throw new Error()
			const updated: AppConfig = await res.json()
			form.reset({
				enabled: updated.superRetrogamers.enabled,
				apiUrl: updated.superRetrogamers.apiUrl,
				preferredRegion: updated.superRetrogamers.preferredRegion,
			})
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	async function handleTest() {
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch('/api/super-retrogamers/test-connection', { method: 'POST' })
			const data = await res.json()
			setTestResult(data)
		} catch {
			setTestResult({ ok: false, error: 'Network error' })
		} finally {
			setTesting(false)
		}
	}

	async function handleEnrich() {
		setEnriching(true)
		setEnrichProgress(null)
		try {
			const res = await fetch('/api/super-retrogamers/enrich-collection', { method: 'POST' })
			if (!res.body) return
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const lines = decoder.decode(value).split('\n').filter(Boolean)
				for (const line of lines) {
					try {
						const event = JSON.parse(line)
						if (event.type === 'progress') {
							setEnrichProgress(`${event.done} / ${event.total}`)
						} else if (event.type === 'complete') {
							setEnrichProgress(t('enrichDone', { matched: event.matched, total: event.total }))
						}
					} catch {}
				}
			}
		} catch {
			toast.error(t('enrichError'))
		} finally {
			setEnriching(false)
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
				<FormField
					control={form.control}
					name="enabled"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<FormLabel>{t('enabled')}</FormLabel>
								<FormDescription>{t('enabledHint')}</FormDescription>
							</div>
							<FormControl>
								<Switch checked={field.value} onCheckedChange={field.onChange} />
							</FormControl>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="preferredRegion"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('preferredRegion')}</FormLabel>
							<FormControl>
								<Select onValueChange={field.onChange} value={field.value}>
									<SelectTrigger>
										<SelectValue placeholder={t('regionDefault')} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="">{t('regionDefault')}</SelectItem>
										<SelectItem value="US">US</SelectItem>
										<SelectItem value="EU">EU</SelectItem>
										<SelectItem value="JP">JP</SelectItem>
									</SelectContent>
								</Select>
							</FormControl>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="apiUrl"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('apiUrl')}</FormLabel>
							<FormControl>
								<Input placeholder="https://super-retrogamers.com/api/v1" {...field} />
							</FormControl>
							<FormDescription>{t('apiUrlHint')}</FormDescription>
						</FormItem>
					)}
				/>
				<div className="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onClick={() => form.reset()} disabled={!isDirty}>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
					<Button type="button" variant="secondary" onClick={handleTest} disabled={testing}>
						{testing ? t('testing') : t('testConnection')}
					</Button>
					<Button type="button" variant="secondary" onClick={handleEnrich} disabled={enriching}>
						{enriching ? (enrichProgress ?? t('enriching')) : t('enrich')}
					</Button>
				</div>
				{testResult?.ok === true && (
					<Alert>
						<AlertDescription className="text-green-600">
							{t('testOk', { ms: testResult.latencyMs ?? 0 })}
						</AlertDescription>
					</Alert>
				)}
				{testResult?.ok === false && (
					<Alert variant="destructive">
						<AlertDescription>{testResult.error ?? t('testFailed')}</AlertDescription>
					</Alert>
				)}
			</form>
		</Form>
	)
}

// ─── MQTT Publish tab ────────────────────────────────────────────────────────────

function MqttPublishTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.mqttPublish')
	const tc = useTranslations('common')

	const form = useForm<MqttPublishForm>({
		resolver: zodResolver(mqttPublishFormSchema),
		defaultValues: {
			enabled: config.mqttPublish.enabled,
			brokerUrl: config.mqttPublish.brokerUrl,
			topicPrefix: config.mqttPublish.topicPrefix,
			homeAssistantDiscovery: config.mqttPublish.homeAssistantDiscovery,
		},
	})
	const isDirty = form.formState.isDirty
	const enabled = form.watch('enabled')

	async function onSave(values: MqttPublishForm) {
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mqttPublish: values }),
			})
			if (!res.ok) throw new Error()
			form.reset(values)
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
				<FormField
					control={form.control}
					name="enabled"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<FormLabel>{t('enabled')}</FormLabel>
								<FormDescription>{t('enabledHint')}</FormDescription>
							</div>
							<FormControl>
								<Switch checked={field.value} onCheckedChange={field.onChange} />
							</FormControl>
						</FormItem>
					)}
				/>
				{enabled && (
					<>
						<FormField
							control={form.control}
							name="brokerUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t('brokerUrl')}</FormLabel>
									<FormControl>
										<Input placeholder="mqtt://<recalbox-host>:1883" {...field} />
									</FormControl>
									<FormDescription>{t('brokerUrlHint')}</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="topicPrefix"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t('topicPrefix')}</FormLabel>
									<FormControl>
										<Input placeholder="RecalboxDashboard/" {...field} />
									</FormControl>
									<FormDescription>{t('topicPrefixHint')}</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="homeAssistantDiscovery"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>{t('haDiscovery')}</FormLabel>
										<FormDescription>{t('haDiscoveryHint')}</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>
					</>
				)}
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

// ─── Tab Nav ─────────────────────────────────────────────────────────────────
// Horizontal underlined tab bar, mirroring the Recalbox Web Manager settings
// (SYSTÈME / AUDIO / RÉSEAU … with a teal underline on the active tab).

type NavItem = { value: string; icon: LucideIcon; label: string; mobileLabel: string }

function SettingsTabs({
	items,
	active,
	onSelect,
}: {
	items: NavItem[]
	active: string
	onSelect: (value: string) => void
}) {
	return (
		<nav className="flex flex-wrap gap-x-1 gap-y-0 border-b border-border">
			{items.map((item) => (
				<button
					key={item.value}
					type="button"
					onClick={() => onSelect(item.value)}
					aria-current={active === item.value ? 'page' : undefined}
					className={cn(
						'relative flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors',
						'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors',
						active === item.value
							? 'text-primary after:bg-primary'
							: 'text-muted-foreground after:bg-transparent hover:text-foreground',
					)}
				>
					<item.icon className="size-4 shrink-0" />
					{item.label}
				</button>
			))}
		</nav>
	)
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
	const t = useTranslations('settings')
	const [config, setConfig] = useState<AppConfig | null>(null)
	const [loading, setLoading] = useState(true)
	const [active, setActive] = useState('recalbox')

	useEffect(() => {
		fetch('/api/settings')
			.then((r) => r.json())
			.then((data: AppConfig) => {
				setConfig(data)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	const navItems: NavItem[] = [
		{ value: 'recalbox', icon: Server, label: t('tabs.recalbox'), mobileLabel: 'Recalbox' },
		{ value: 'scrobble', icon: Clock, label: t('tabs.scrobble'), mobileLabel: 'Scrobble' },
		{ value: 'interface', icon: Palette, label: t('tabs.interface'), mobileLabel: 'UI' },
		{
			value: 'retroachievements',
			icon: Trophy,
			label: t('tabs.retroachievements'),
			mobileLabel: 'Retro',
		},
		{ value: 'integrations', icon: Plug, label: t('tabs.integrations'), mobileLabel: 'Intégr.' },
		{ value: 'mqttPublish', icon: Radio, label: t('tabs.mqttPublish'), mobileLabel: 'MQTT' },
		{ value: 'notifications', icon: Bell, label: t('tabs.notifications'), mobileLabel: 'Notifs' },
		{ value: 'igdb', icon: Database, label: t('tabs.igdb'), mobileLabel: 'IGDB' },
		{ value: 'hltb', icon: Clock, label: t('tabs.hltb'), mobileLabel: 'HLTB' },
		{ value: 'app', icon: Smartphone, label: t('tabs.app'), mobileLabel: 'App' },
	]

	if (loading) {
		return <div className="p-8 text-muted-foreground text-sm">{t('loading')}</div>
	}

	if (!config) {
		return <div className="p-8 text-destructive text-sm">{t('loadError')}</div>
	}

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground text-sm">{t('subtitle')}</p>
			</div>
			<div className="space-y-6">
				<SettingsTabs items={navItems} active={active} onSelect={setActive} />
				<div className="min-w-0">
					{active === 'recalbox' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('recalbox.cardTitle')}</CardTitle>
								<CardDescription>{t('recalbox.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<RecalboxTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'scrobble' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('scrobble.cardTitle')}</CardTitle>
								<CardDescription>{t('scrobble.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<ScrobbleTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'interface' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('interface.cardTitle')}</CardTitle>
								<CardDescription>{t('interface.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<UiTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'retroachievements' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('retroachievements.cardTitle')}</CardTitle>
								<CardDescription>{t('retroachievements.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<RetroAchievementsTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'integrations' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('integrations.cardTitle')}</CardTitle>
								<CardDescription>{t('integrations.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<IntegrationsTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'mqttPublish' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('mqttPublish.cardTitle')}</CardTitle>
								<CardDescription>{t('mqttPublish.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<MqttPublishTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'notifications' && <NotificationsTab />}
					{active === 'igdb' && <IgdbTab />}
					{active === 'hltb' && <HltbTab />}
					{active === 'app' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('app.cardTitle')}</CardTitle>
								<CardDescription>{t('app.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<AppTab />
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</div>
	)
}

// ─── IGDB Tab ────────────────────────────────────────────────────────────────

type IgdbStatus = {
	enabled: boolean
	hasCredentials: boolean
	lastTestStatus: string | null
	lastTestedAt: string | null
	mapping: { totalGames: number; matched: number; notFound: number; needsReview: number }
}

type BatchProgress = {
	total: number
	done: number
	matched: number
	notFound: number
	needsReview: number
	errors: number
	current?: string
}

function IgdbTab() {
	const t = useTranslations('settings')
	const [status, setStatus] = useState<IgdbStatus | null>(null)
	const [clientId, setClientId] = useState('')
	const [clientSecret, setClientSecret] = useState('')
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [matchProgress, setMatchProgress] = useState<BatchProgress | null>(null)

	useEffect(() => {
		refresh()
	}, [])

	async function refresh() {
		const res = await fetch('/api/igdb/status')
		setStatus(await res.json())
	}

	async function handleSave() {
		setSaving(true)
		setSaveError(null)
		const res = await fetch('/api/igdb/credentials', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientId, clientSecret }),
		})
		setSaving(false)
		if (res.ok) {
			setClientId('')
			setClientSecret('')
			await refresh()
			toast.success(t('igdb.savedSuccess'))
		} else {
			const err = await res.json()
			const errType = err.error?.type ?? err.error ?? 'unknown_error'
			setSaveError(errType)
		}
	}

	function pollProgress() {
		const interval = setInterval(async () => {
			const res = await fetch('/api/igdb/match/progress')
			const data = await res.json()
			setMatchProgress(data.progress)
			if (!data.isRunning) {
				clearInterval(interval)
				setMatchProgress(null)
				refresh()
			}
		}, 1000)
	}

	async function handleStartMatch(scope: 'played' | 'all') {
		await fetch(`/api/igdb/match/start?scope=${scope}`, { method: 'POST' })
		pollProgress()
	}

	if (!status) return null

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{t('igdb.cardTitle')}</CardTitle>
					{status.enabled ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
							<CheckCircle2 className="size-3" /> {t('igdb.active')}
						</span>
					) : (
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
							{t('igdb.inactive')}
						</span>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{!status.enabled && (
					<>
						<p className="text-sm text-muted-foreground">{t('igdb.description')}</p>

						<details className="text-sm">
							<summary className="cursor-pointer text-primary">{t('igdb.credentialsHelp')}</summary>
							<ol className="mt-2 ml-4 space-y-1 list-decimal text-muted-foreground">
								<li>
									<a
										href="https://dev.twitch.tv/console"
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary inline-flex items-center gap-0.5"
									>
										dev.twitch.tv/console <ExternalLink className="size-3" />
									</a>
								</li>
								<li>Register Your Application</li>
								<li>OAuth Redirect URL : http://localhost</li>
								<li>Category : Application Integration</li>
								<li>{t('igdb.credentialsStep5')}</li>
							</ol>
						</details>

						<div className="space-y-3">
							<div>
								<label htmlFor="igdb-client-id" className="block text-sm font-medium mb-1">
									Client ID
								</label>
								<Input
									id="igdb-client-id"
									value={clientId}
									onChange={(e) => setClientId(e.target.value)}
									placeholder="abcdef1234567890"
								/>
							</div>
							<div>
								<label htmlFor="igdb-client-secret" className="block text-sm font-medium mb-1">
									Client Secret
								</label>
								<Input
									id="igdb-client-secret"
									type="password"
									value={clientSecret}
									onChange={(e) => setClientSecret(e.target.value)}
									placeholder="••••••••••••••••"
								/>
							</div>
							{saveError && (
								<p className="text-sm text-destructive">
									{saveError === 'invalid_credentials'
										? t('igdb.errorInvalidCredentials')
										: saveError === 'network_error'
											? t('igdb.errorNetwork')
											: saveError}
								</p>
							)}
							<Button onClick={handleSave} disabled={saving || !clientId || !clientSecret}>
								{saving && <Loader2 className="size-4 mr-2 animate-spin" />}
								{t('igdb.enableButton')}
							</Button>
						</div>
					</>
				)}

				{status.enabled && (
					<>
						<div className="rounded-md bg-muted/30 p-3 space-y-2 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('igdb.matched')}</span>
								<span className="font-medium">{status.mapping.matched}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('igdb.notFound')}</span>
								<span className="font-medium">{status.mapping.notFound}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('igdb.toReview')}</span>
								<span className="font-medium">{status.mapping.needsReview}</span>
							</div>
							<p className="text-xs text-muted-foreground pt-1">
								{t('igdb.totalCollection', { count: status.mapping.totalGames })}
							</p>
						</div>

						{matchProgress ? (
							<div className="space-y-1 text-sm">
								<p className="text-muted-foreground">
									{t('igdb.matchingProgress', {
										done: matchProgress.done,
										total: matchProgress.total,
									})}
								</p>
								{matchProgress.current && (
									<p className="text-xs italic truncate">{matchProgress.current}</p>
								)}
							</div>
						) : (
							<div className="space-y-3">
								<Button onClick={() => handleStartMatch('played')}>{t('igdb.matchPlayed')}</Button>
								<p className="text-xs text-muted-foreground">{t('igdb.matchPlayedHint')}</p>
								{status.mapping.needsReview > 0 && (
									<Link
										href="/settings/igdb/review"
										className={buttonVariants({ variant: 'outline' })}
									>
										{t('igdb.reviewMatches', { count: status.mapping.needsReview })}
									</Link>
								)}
								<details className="text-xs text-muted-foreground">
									<summary className="cursor-pointer hover:text-foreground">
										{t('igdb.advancedOptions')}
									</summary>
									<div className="mt-2 space-y-2">
										<Button variant="outline" size="sm" onClick={() => handleStartMatch('all')}>
											{t('igdb.matchAll')}
										</Button>
										<p>{t('igdb.matchAllHint', { count: status.mapping.totalGames })}</p>
									</div>
								</details>
							</div>
						)}
					</>
				)}
			</CardContent>
		</Card>
	)
}

// ─── HLTB Tab ─────────────────────────────────────────────────────────────────

type HltbStatus = {
	totalGames: number
	matched: number
	notFound: number
	unmapped: number
}

function HltbTab() {
	const t = useTranslations('settings')
	const [status, setStatus] = useState<HltbStatus | null>(null)
	const [matchProgress, setMatchProgress] = useState<BatchProgress | null>(null)

	useEffect(() => {
		refreshHltb()
	}, [])

	async function refreshHltb() {
		const res = await fetch('/api/hltb/status')
		setStatus(await res.json())
	}

	function pollHltbProgress() {
		const interval = setInterval(async () => {
			const res = await fetch('/api/hltb/batch-match/progress')
			const data = await res.json()
			setMatchProgress(data.progress)
			if (!data.isRunning) {
				clearInterval(interval)
				setMatchProgress(null)
				refreshHltb()
			}
		}, 1000)
	}

	async function handleStartMatch() {
		await fetch('/api/hltb/batch-match', { method: 'POST' })
		pollHltbProgress()
	}

	if (!status) return null

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('hltb.cardTitle')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">{t('hltb.description')}</p>

				<div className="rounded-md bg-muted/30 p-3 space-y-2 text-sm">
					<div className="flex justify-between">
						<span className="text-muted-foreground">{t('hltb.matched')}</span>
						<span className="font-medium">{status.matched}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">{t('hltb.notFound')}</span>
						<span className="font-medium">{status.notFound}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">{t('hltb.unmapped')}</span>
						<span className="font-medium">{status.unmapped}</span>
					</div>
					<p className="text-xs text-muted-foreground pt-1">
						{t('hltb.totalCollection', { count: status.totalGames })}
					</p>
				</div>

				{matchProgress ? (
					<div className="space-y-1 text-sm">
						<p className="text-muted-foreground">
							{t('hltb.matchingProgress', { done: matchProgress.done, total: matchProgress.total })}
						</p>
						{matchProgress.current && (
							<p className="text-xs italic truncate">{matchProgress.current}</p>
						)}
					</div>
				) : (
					<Button onClick={handleStartMatch} disabled={status.unmapped === 0}>
						{t('hltb.startMatch')}
					</Button>
				)}
			</CardContent>
		</Card>
	)
}

// ─── Notifications Tab ───────────────────────────────────────────────────────

type PushSubscription = {
	id: number
	endpoint: string
	userAgent: string | null
	createdAt: string | Date
}

function NotificationsTab() {
	const t = useTranslations('settings')
	const tCommon = useTranslations('common')
	const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES)
	const [devices, setDevices] = useState<PushSubscription[]>([])
	const [isPushSubscribed, setIsPushSubscribed] = useState(false)
	const [vapidAvailable, setVapidAvailable] = useState(true)
	const [dirty, setDirty] = useState(false)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		fetch('/api/notifications/preferences')
			.then((r) => r.json())
			.then((p: NotificationPreferences) => setPrefs(p))
			.catch(() => {})
		fetch('/api/notifications/subscriptions')
			.then((r) => r.json())
			.then(setDevices)
			.catch(() => {})
		fetch('/api/notifications/vapid-public-key')
			.then((r) => {
				if (!r.ok) setVapidAvailable(false)
			})
			.catch(() => setVapidAvailable(false))
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.getRegistration('/sw.js')
				.then((reg) => {
					if (reg) reg.pushManager.getSubscription().then((sub) => setIsPushSubscribed(!!sub))
				})
				.catch(() => {})
		}
	}, [])

	const update = (patch: Partial<NotificationPreferences>) => {
		setPrefs((p) => ({ ...p, ...patch }))
		setDirty(true)
	}

	const updateTypes = (patch: Partial<NotificationPreferences['types']>) => {
		setPrefs((p) => ({ ...p, types: { ...p.types, ...patch } }))
		setDirty(true)
	}

	const updateQuietHours = (patch: Partial<NotificationPreferences['quietHours']>) => {
		setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, ...patch } }))
		setDirty(true)
	}

	const save = async () => {
		setSaving(true)
		await fetch('/api/notifications/preferences', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(prefs),
		})
		setDirty(false)
		setSaving(false)
		toast.success(t('notificationsTab.saved'))
	}

	const enableWebPush = async () => {
		const reg = await registerServiceWorker()
		if (!reg) {
			toast.error(t('notificationsTab.swError'))
			return
		}
		const sub = await subscribeToPush(reg)
		if (!sub) {
			toast.error(t('notificationsTab.pushDenied'))
			return
		}
		setIsPushSubscribed(true)
		update({ webPush: true })
		fetch('/api/notifications/subscriptions')
			.then((r) => r.json())
			.then(setDevices)
			.catch(() => {})
	}

	const disableWebPush = async () => {
		const reg = await navigator.serviceWorker.getRegistration('/sw.js')
		if (reg) await unsubscribeFromPush(reg)
		setIsPushSubscribed(false)
		update({ webPush: false })
		fetch('/api/notifications/subscriptions')
			.then((r) => r.json())
			.then(setDevices)
			.catch(() => {})
	}

	const removeDevice = async (endpoint: string) => {
		await fetch(`/api/notifications/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
			method: 'DELETE',
		})
		setDevices((d) => d.filter((s) => s.endpoint !== endpoint))
	}

	const testNotification = async () => {
		await fetch('/api/notifications/test', { method: 'POST' })
		toast.success(t('notificationsTab.testSent'))
	}

	const regenerateVapid = async () => {
		if (!confirm(t('notificationsTab.regenerateConfirm'))) return
		await fetch('/api/notifications/vapid', { method: 'DELETE' })
		setDevices([])
		setIsPushSubscribed(false)
		toast(t('notificationsTab.regenerated'))
	}

	return (
		<div className="space-y-6">
			{/* Global enable */}
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium text-sm">{t('notificationsTab.enabled')}</p>
					<p className="text-muted-foreground text-xs">{t('notificationsTab.enabledHint')}</p>
				</div>
				<Switch checked={prefs.enabled} onCheckedChange={(v) => update({ enabled: v })} />
			</div>

			{/* Channels */}
			<div className="space-y-3">
				<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t('notificationsTab.channels')}
				</p>
				<div className="flex items-center justify-between">
					<p className="text-sm">{t('notificationsTab.inApp')}</p>
					<Switch checked={prefs.inApp} onCheckedChange={(v) => update({ inApp: v })} />
				</div>
				<div className="flex items-center justify-between">
					<div>
						<p className="text-sm">{t('notificationsTab.webPush')}</p>
						{!vapidAvailable && (
							<p className="text-xs text-muted-foreground">
								{t('notificationsTab.vapidUnavailable')}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						{isPushSubscribed ? (
							<Button variant="outline" size="sm" onClick={disableWebPush}>
								{t('notificationsTab.disable')}
							</Button>
						) : (
							<Button
								variant="outline"
								size="sm"
								onClick={enableWebPush}
								disabled={!vapidAvailable}
							>
								{t('notificationsTab.enable')}
							</Button>
						)}
					</div>
				</div>
			</div>

			{/* Types */}
			<div className="space-y-3">
				<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t('notificationsTab.types')}
				</p>
				{(
					[
						['achievementUnlocked', t('notificationsTab.achievementUnlocked')],
						['gameStarted', t('notificationsTab.gameStarted')],
						['streakMilestone', t('notificationsTab.streakMilestone')],
						['wrappedAvailable', t('notificationsTab.wrappedAvailable')],
						['systemAlerts', t('notificationsTab.systemAlerts')],
					] as [keyof NotificationPreferences['types'], string][]
				).map(([key, label]) => (
					<div key={key} className="space-y-1">
						<div className="flex items-center justify-between">
							<p className="text-sm">{label}</p>
							<Switch
								checked={prefs.types[key]}
								onCheckedChange={(v) => updateTypes({ [key]: v })}
							/>
						</div>
						{key === 'achievementUnlocked' && prefs.types.achievementUnlocked && (
							<div className="flex items-center justify-between pl-4">
								<p className="text-xs text-muted-foreground">
									{t('notificationsTab.hardcoreOnly')}
								</p>
								<Switch
									checked={prefs.types.achievementHardcoreOnly}
									onCheckedChange={(v) => updateTypes({ achievementHardcoreOnly: v })}
								/>
							</div>
						)}
					</div>
				))}
			</div>

			{/* Quiet hours */}
			<div className="space-y-3">
				<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t('notificationsTab.quietHours')}
				</p>
				<div className="flex items-center justify-between">
					<p className="text-sm">{t('notificationsTab.quietHoursEnabled')}</p>
					<Switch
						checked={prefs.quietHours.enabled}
						onCheckedChange={(v) => updateQuietHours({ enabled: v })}
					/>
				</div>
				{prefs.quietHours.enabled && (
					<div className="flex items-center gap-3 pl-4">
						<p className="text-sm text-muted-foreground">{t('notificationsTab.from')}</p>
						<Select
							value={String(prefs.quietHours.startHour)}
							onValueChange={(v) => updateQuietHours({ startHour: Number(v) })}
						>
							<SelectTrigger className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.from({ length: 24 }, (_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: hours 0-23 are identity
									<SelectItem key={i} value={String(i)}>
										{String(i).padStart(2, '0')}h
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-sm text-muted-foreground">{t('notificationsTab.to')}</p>
						<Select
							value={String(prefs.quietHours.endHour)}
							onValueChange={(v) => updateQuietHours({ endHour: Number(v) })}
						>
							<SelectTrigger className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.from({ length: 24 }, (_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: hours 0-23 are identity
									<SelectItem key={i} value={String(i)}>
										{String(i).padStart(2, '0')}h
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</div>

			{/* Devices */}
			{devices.length > 0 && (
				<div className="space-y-3">
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{t('notificationsTab.devices')}
					</p>
					{devices.map((sub) => (
						<div key={sub.id} className="flex items-center justify-between text-sm">
							<p className="truncate text-muted-foreground max-w-xs">
								{sub.userAgent ?? `${sub.endpoint.slice(0, 40)}…`}
							</p>
							<Button variant="ghost" size="sm" onClick={() => removeDevice(sub.endpoint)}>
								✕
							</Button>
						</div>
					))}
				</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-2 flex-wrap">
				<Button onClick={save} disabled={!dirty || saving}>
					{saving ? t('notificationsTab.saving') : tCommon('save')}
				</Button>
				<Button variant="outline" onClick={testNotification}>
					{t('notificationsTab.test')}
				</Button>
				<Button variant="destructive" onClick={regenerateVapid}>
					{t('notificationsTab.regenerateVapid')}
				</Button>
			</div>
		</div>
	)
}

// ─── App Tab ──────────────────────────────────────────────────────────────────

function AppTab() {
	const t = useTranslations('settings')
	const { isInstalled, canInstall, isIOS, install } = useInstallPrompt()
	const [checkingUpdates, setCheckingUpdates] = useState(false)

	const clearCache = async () => {
		try {
			const keys = await caches.keys()
			await Promise.all(keys.map((k) => caches.delete(k)))
			toast.success(t('app.cacheClearedSuccess'))
		} catch {
			toast.error(t('app.cacheClearError'))
		}
	}

	const checkUpdates = async () => {
		setCheckingUpdates(true)
		try {
			const reg = await navigator.serviceWorker.getRegistration()
			await reg?.update()
			toast.info(t('app.updateChecked'))
		} catch {
			toast.error(t('app.updateCheckError'))
		} finally {
			setCheckingUpdates(false)
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				{isInstalled ? (
					<CheckCircle2 className="size-5 text-green-500" />
				) : (
					<Circle className="size-5 text-muted-foreground" />
				)}
				<div>
					<p className="text-sm font-medium">
						{isInstalled ? t('app.installed') : t('app.notInstalled')}
					</p>
					<p className="text-xs text-muted-foreground">{t('app.version', { version: '0.1.0' })}</p>
				</div>
			</div>

			<div className="flex gap-2 flex-wrap">
				<Button variant="outline" size="sm" onClick={clearCache}>
					{t('app.clearCache')}
				</Button>
				<Button variant="outline" size="sm" onClick={checkUpdates} disabled={checkingUpdates}>
					{checkingUpdates ? t('app.checkingUpdates') : t('app.checkUpdates')}
				</Button>
			</div>

			{!isInstalled && (
				<div className="space-y-3">
					<p className="text-sm font-semibold">{t('app.installInstructions')}</p>
					<div className="space-y-3 text-sm">
						{canInstall && (
							<Button size="sm" onClick={install}>
								{t('app.installNow')}
							</Button>
						)}
						<div>
							<p className="font-medium">iPhone / iPad Safari</p>
							<p className="text-muted-foreground">{t('app.iosInstructions')}</p>
						</div>
						<div>
							<p className="font-medium">Android Chrome</p>
							<p className="text-muted-foreground">{t('app.androidInstructions')}</p>
						</div>
						<div>
							<p className="font-medium">Desktop Chrome / Edge</p>
							<p className="text-muted-foreground">{t('app.desktopInstructions')}</p>
						</div>
					</div>
				</div>
			)}

			<div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
				{t('app.webPushNote')}
			</div>
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
