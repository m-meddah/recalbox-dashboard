'use client'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const schema = z.object({
	name: z.string().min(1).max(64),
	iconEmoji: z.string().max(8).optional(),
	host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(0).max(128),
	sshPort: z.number().int().min(1).max(65535),
	mqttPort: z.number().int().min(1).max(65535),
})
export type RecalboxFormValues = z.infer<typeof schema>

type TestResult = {
	ssh: { success: boolean; latencyMs: number; error?: string }
	mqtt: { success: boolean; latencyMs: number; messagesReceived: number; error?: string }
	overall: 'ok' | 'partial' | 'failed'
}

type Props = {
	defaultValues?: Partial<RecalboxFormValues>
	onSubmit: (values: RecalboxFormValues) => Promise<void>
	testUrl?: string
	submitLabel?: string
	loading?: boolean
}

export function RecalboxForm({ defaultValues, onSubmit, testUrl, submitLabel, loading }: Props) {
	const t = useTranslations('recalboxes.form')
	const tc = useTranslations('common')
	const [testing, setTesting] = useState(false)
	const [testResult, setTestResult] = useState<TestResult | null>(null)
	const [showPassword, setShowPassword] = useState(false)

	const form = useForm<RecalboxFormValues>({
		resolver: zodResolver(schema),
		defaultValues: { name: '', sshUser: 'root', sshPassword: '', sshPort: 22, mqttPort: 1883, ...defaultValues },
	})

	async function handleTest() {
		const values = form.getValues()
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch(testUrl ?? '/api/settings/test-connection', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			setTestResult(await res.json())
		} finally { setTesting(false) }
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
				<div className="grid grid-cols-2 gap-4">
					<FormField control={form.control} name="name" render={({ field }) => (
						<FormItem><FormLabel>{t('name')}</FormLabel><FormControl><Input placeholder="Salon" {...field} /></FormControl><FormMessage /></FormItem>
					)} />
					<FormField control={form.control} name="iconEmoji" render={({ field }) => (
						<FormItem><FormLabel>{t('icon')}</FormLabel><FormControl><Input placeholder="🕹️" {...field} /></FormControl><FormMessage /></FormItem>
					)} />
				</div>
				<FormField control={form.control} name="host" render={({ field }) => (
					<FormItem><FormLabel>{t('host')}</FormLabel><FormControl><Input placeholder="recalbox.local" {...field} /></FormControl><FormMessage /></FormItem>
				)} />
				<div className="grid grid-cols-2 gap-4">
					<FormField control={form.control} name="sshUser" render={({ field }) => (
						<FormItem><FormLabel>{t('sshUser')}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
					)} />
					<FormField control={form.control} name="sshPassword" render={({ field }) => (
						<FormItem><FormLabel>{t('sshPassword')}</FormLabel><FormControl>
							<div className="relative">
								<Input type={showPassword ? 'text' : 'password'} {...field} />
								<button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
									{showPassword ? t('hide') : t('show')}
								</button>
							</div>
						</FormControl><FormMessage /></FormItem>
					)} />
				</div>
				<div className="grid grid-cols-2 gap-4">
					<FormField control={form.control} name="sshPort" render={({ field }) => (
						<FormItem><FormLabel>{t('sshPort')}</FormLabel><FormControl>
							<Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
						</FormControl><FormMessage /></FormItem>
					)} />
					<FormField control={form.control} name="mqttPort" render={({ field }) => (
						<FormItem><FormLabel>{t('mqttPort')}</FormLabel><FormControl>
							<Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
						</FormControl><FormMessage /></FormItem>
					)} />
				</div>
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
						{testing ? t('testing') : t('test')}
					</Button>
				</div>
				{testResult && (
					<div className="space-y-2 text-sm">
						{[{ label: 'SSH', r: testResult.ssh }, { label: 'MQTT', r: testResult.mqtt }].map(({ label, r }) => (
							<div key={label} className="flex items-center gap-2 border rounded p-2">
								<span className={r.success ? 'text-green-500' : 'text-red-500'}>{r.success ? '✓' : '✗'}</span>
								<span className="font-medium w-12">{label}</span>
								<span className="text-muted-foreground flex-1">{r.error ?? 'OK'}</span>
								<span className="text-muted-foreground">{r.latencyMs}ms</span>
							</div>
						))}
					</div>
				)}
				<Button type="submit" disabled={loading}>{submitLabel ?? tc('save')}</Button>
			</form>
		</Form>
	)
}
