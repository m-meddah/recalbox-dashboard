import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import mqtt from 'mqtt'
import { type NextRequest, NextResponse } from 'next/server'
import { NodeSSH } from 'node-ssh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

async function testSsh(host: string, user: string, password: string, port: number) {
	const start = Date.now()
	const ssh = new NodeSSH()
	try {
		await ssh.connect({ host, username: user, password, port, readyTimeout: 10000 })
		await ssh.execCommand('echo ok')
		ssh.dispose()
		return { success: true, latencyMs: Date.now() - start }
	} catch (err) {
		return {
			success: false,
			latencyMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
		}
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
		let resolved = false
		let messages = 0
		const client = mqtt.connect(`mqtt://${host}:${port}`, {
			connectTimeout: 5000,
			reconnectPeriod: 0,
		})
		const done = (success: boolean, error?: string) => {
			if (resolved) return
			resolved = true
			client.end()
			resolve({ success, latencyMs: Date.now() - start, messagesReceived: messages, error })
		}
		client.on('connect', () => {
			client.subscribe('#')
			setTimeout(() => done(true), 2000)
		})
		client.on('message', () => {
			messages++
		})
		client.on('error', (err) => done(false, err.message))
		setTimeout(() => done(false, 'Connection timeout'), 6000)
	})
}

export async function POST(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canViewRecalbox(user, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	const [sshResult, mqttResult] = await Promise.all([
		testSsh(rb.host, rb.sshUser, rb.sshPassword, rb.sshPort),
		testMqtt(rb.host, rb.mqttPort),
	])
	const overall =
		sshResult.success && mqttResult.success
			? 'ok'
			: sshResult.success || mqttResult.success
				? 'partial'
				: 'failed'
	return NextResponse.json({ ssh: sshResult, mqtt: mqttResult, overall })
}
