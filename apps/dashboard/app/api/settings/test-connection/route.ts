import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { formatMqttUrl } from '@/lib/recalbox/mqtt-url'
import { PASSWORD_MASK } from '@/lib/settings/schemas'
import { HOST_REGEX } from '@/lib/validation/host'
import mqtt from 'mqtt'
import { type NextRequest, NextResponse } from 'next/server'
import { NodeSSH } from 'node-ssh'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
	host: z.string().regex(HOST_REGEX).optional(),
	sshUser: z.string().optional(),
	sshPassword: z.string().optional(),
	sshPort: z.number().int().min(1).max(65535).optional(),
	mqttPort: z.number().int().min(1).max(65535).optional(),
})

async function testSsh(host: string, user: string, password: string, port: number) {
	const start = Date.now()
	const ssh = new NodeSSH()
	try {
		await ssh.connect({ host, username: user, password, port, readyTimeout: 5000 })
		await ssh.execCommand('echo ok')
		ssh.dispose()
		return { success: true, latencyMs: Date.now() - start }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { success: false, latencyMs: Date.now() - start, error: message }
	}
}

async function testMqtt(host: string, port: number) {
	const start = Date.now()
	return new Promise<{
		success: boolean
		latencyMs: number
		messagesReceived: number
		error?: string
	}>((resolve) => {
		let messagesReceived = 0
		let resolved = false
		const client = mqtt.connect(formatMqttUrl(host, port), {
			connectTimeout: 5000,
			reconnectPeriod: 0,
			clientId: `recalbox-test-${Math.random().toString(16).slice(2, 8)}`,
		})

		const done = (success: boolean, error?: string) => {
			if (resolved) return
			resolved = true
			client.end()
			resolve({ success, latencyMs: Date.now() - start, messagesReceived, error })
		}

		client.on('connect', () => {
			client.subscribe('#', { qos: 0 })
			setTimeout(() => done(true), 2000)
		})

		client.on('message', () => {
			messagesReceived++
		})

		client.on('error', (err) => {
			done(false, err.message)
		})

		setTimeout(() => done(false, 'Connection timeout'), 6000)
	})
}

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	let body: unknown = {}
	try {
		body = await req.json()
	} catch {
		// empty body is fine — use stored config
	}

	const parsed = bodySchema.safeParse(body)
	const overrides = parsed.success ? parsed.data : {}

	const stored = configStore.get().recalbox
	const host = overrides.host ?? stored.host
	const sshUser = overrides.sshUser ?? stored.sshUser
	const sshPassword =
		!overrides.sshPassword || overrides.sshPassword === PASSWORD_MASK
			? stored.sshPassword
			: overrides.sshPassword
	const sshPort = overrides.sshPort ?? stored.sshPort
	const mqttPort = overrides.mqttPort ?? stored.mqttPort

	const [sshResult, mqttResult] = await Promise.all([
		testSsh(host, sshUser, sshPassword, sshPort),
		testMqtt(host, mqttPort),
	])

	const overall =
		sshResult.success && mqttResult.success
			? 'ok'
			: sshResult.success || mqttResult.success
				? 'partial'
				: 'failed'

	return NextResponse.json({ ssh: sshResult, mqtt: mqttResult, overall })
}
