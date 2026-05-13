'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { AppConfig } from '@/lib/settings/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const step1Schema = z.object({
	host: z
		.string()
		.min(1)
		.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(1).max(128),
	sshPort: z.number().int().min(1).max(65535),
	mqttPort: z.number().int().min(1).max(65535),
})
type Step1Values = z.infer<typeof step1Schema>

type TestResult = {
	ssh: { success: boolean; latencyMs: number; error?: string }
	mqtt: { success: boolean; latencyMs: number; messagesReceived: number; error?: string }
	overall: 'ok' | 'partial' | 'failed'
}

type Step = 1 | 2 | 3

export default function WelcomePage() {
	const router = useRouter()
	const [step, setStep] = useState<Step>(1)
	const [testResult, setTestResult] = useState<TestResult | null>(null)
	const [testing, setTesting] = useState(false)
	const [saving, setSaving] = useState(false)
	const [step1Values, setStep1Values] = useState<Step1Values | null>(null)
	const [showPassword, setShowPassword] = useState(false)

	const form = useForm<Step1Values>({
		resolver: zodResolver(step1Schema),
		defaultValues: {
			host: '',
			sshUser: 'root',
			sshPassword: '',
			sshPort: 22,
			mqttPort: 1883,
		},
	})

	useEffect(() => {
		fetch('/api/settings')
			.then((r) => r.json())
			.then((data: AppConfig) => {
				form.reset({
					host: data.recalbox.host,
					sshUser: data.recalbox.sshUser,
					sshPassword: '',
					sshPort: data.recalbox.sshPort,
					mqttPort: data.recalbox.mqttPort,
				})
			})
			.catch(() => {})
	}, [form])

	async function handleStep1(values: Step1Values) {
		setStep1Values(values)
		setStep(2)
		await runTest(values)
	}

	async function runTest(values: Step1Values) {
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch('/api/settings/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			setTestResult(await res.json())
		} catch {
			setTestResult(null)
		} finally {
			setTesting(false)
		}
	}

	async function handleFinish() {
		if (!step1Values) return
		setSaving(true)
		try {
			await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ recalbox: step1Values }),
			})
			await fetch('/api/settings/complete-setup', { method: 'POST' })
			router.push('/')
		} catch {
			setSaving(false)
		}
	}

	const stepLabels = ['Configure Recalbox', 'Test Connection', 'Confirm']

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center space-y-1">
					<h1 className="text-2xl font-bold">🕹️ Welcome to Recalbox Dashboard</h1>
					<p className="text-muted-foreground text-sm">Let's get you set up in a few steps</p>
				</div>

				{/* Stepper */}
				<div className="flex items-center justify-center gap-2">
					{stepLabels.map((label, i) => {
						const n = (i + 1) as Step
						const done = step > n
						const active = step === n
						return (
							<div key={n} className="flex items-center gap-2">
								<div
									className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
										done
											? 'bg-primary text-primary-foreground'
											: active
												? 'bg-primary text-primary-foreground'
												: 'bg-muted text-muted-foreground'
									}`}
								>
									{done ? '✓' : n}
								</div>
								<span
									className={`text-sm ${active ? 'font-medium' : 'text-muted-foreground'} hidden sm:inline`}
								>
									{label}
								</span>
								{i < stepLabels.length - 1 && <div className="h-px w-8 bg-border mx-1" />}
							</div>
						)
					})}
				</div>

				{/* Step 1: Configure */}
				{step === 1 && (
					<Card>
						<CardHeader>
							<CardTitle>Recalbox Connection</CardTitle>
							<CardDescription>Enter the network details of your Recalbox console</CardDescription>
						</CardHeader>
						<CardContent>
							<Form {...form}>
								<form onSubmit={form.handleSubmit(handleStep1)} className="space-y-4">
									<FormField
										control={form.control}
										name="host"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Host / IP address</FormLabel>
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
													<FormLabel>SSH user</FormLabel>
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
													<FormLabel>SSH password</FormLabel>
													<FormControl>
														<div className="relative">
															<Input
																type={showPassword ? 'text' : 'password'}
																placeholder="recalboxroot"
																{...field}
															/>
															<button
																type="button"
																onClick={() => setShowPassword((v) => !v)}
																className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
															>
																{showPassword ? 'Hide' : 'Show'}
															</button>
														</div>
													</FormControl>
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
													<FormLabel>SSH port</FormLabel>
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
													<FormLabel>MQTT port</FormLabel>
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
									<Button type="submit" className="w-full">
										Next: Test Connection
									</Button>
								</form>
							</Form>
						</CardContent>
					</Card>
				)}

				{/* Step 2: Test */}
				{step === 2 && (
					<Card>
						<CardHeader>
							<CardTitle>Test Connection</CardTitle>
							<CardDescription>
								Verifying SSH and MQTT connectivity to your Recalbox
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{testing && (
								<p className="text-sm text-muted-foreground animate-pulse">Testing connection...</p>
							)}
							{testResult && (
								<div className="space-y-3">
									<ResultRow
										label="SSH"
										success={testResult.ssh.success}
										latency={testResult.ssh.latencyMs}
										error={testResult.ssh.error}
									/>
									<ResultRow
										label="MQTT"
										success={testResult.mqtt.success}
										latency={testResult.mqtt.latencyMs}
										error={testResult.mqtt.error}
									/>
									{!testResult.ssh.success && (
										<p className="text-xs text-muted-foreground">
											SSH failed: check host, port, credentials. Default password is{' '}
											<code>recalboxroot</code>.
										</p>
									)}
									{!testResult.mqtt.success && (
										<p className="text-xs text-muted-foreground">
											MQTT failed: check that the MQTT broker is enabled in Recalbox settings.
										</p>
									)}
								</div>
							)}
							<div className="flex gap-2">
								<Button variant="outline" onClick={() => setStep(1)} className="flex-1">
									Back
								</Button>
								<Button
									variant="outline"
									onClick={() => step1Values && runTest(step1Values)}
									disabled={testing}
									className="flex-1"
								>
									Retry
								</Button>
								<Button
									onClick={() => setStep(3)}
									disabled={testing || !testResult}
									className="flex-1"
								>
									Continue
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Step 3: Confirm */}
				{step === 3 && (
					<Card>
						<CardHeader>
							<CardTitle>All set!</CardTitle>
							<CardDescription>
								{testResult?.overall === 'ok'
									? 'Connection successful. Your dashboard is ready.'
									: 'You can complete setup now and fix any connection issues later in Settings.'}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{step1Values && (
								<div className="rounded-md bg-muted p-3 text-sm space-y-1">
									<p>
										<span className="font-medium">Host:</span> {step1Values.host}
									</p>
									<p>
										<span className="font-medium">SSH user:</span> {step1Values.sshUser}
									</p>
									<p>
										<span className="font-medium">SSH port:</span> {step1Values.sshPort}
									</p>
									<p>
										<span className="font-medium">MQTT port:</span> {step1Values.mqttPort}
									</p>
								</div>
							)}
							<div className="flex gap-2">
								<Button variant="outline" onClick={() => setStep(2)} className="flex-1">
									Back
								</Button>
								<Button onClick={handleFinish} disabled={saving} className="flex-1">
									{saving ? 'Saving...' : 'Finish'}
								</Button>
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	)
}

function ResultRow({
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
		<div className="flex items-center gap-3 rounded-md border p-3">
			<span className={`text-lg ${success ? 'text-green-500' : 'text-red-500'}`}>
				{success ? '✓' : '✗'}
			</span>
			<div className="flex-1">
				<p className="text-sm font-medium">{label}</p>
				{error && <p className="text-xs text-muted-foreground">{error}</p>}
			</div>
			<span className="text-xs text-muted-foreground">{latency}ms</span>
		</div>
	)
}
