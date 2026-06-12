import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	type ConfigField,
	SECRET_SENTINEL,
	fetchConfigSection,
	fetchSystemsCatalog,
	maskSecrets,
	saveConfigSection,
} from '../web-config'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})

describe('fetchConfigSection', () => {
	it('normalizes {key:{exist,value}} into typed fields, sorted by key', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					volume: { exist: true, value: 100 },
					bgmusic: { exist: true, value: true },
					device: { exist: true, value: 'hdmi' },
				}),
				{ status: 200 },
			),
		)
		const fields = await fetchConfigSection('box', 'audio')
		expect(fields).toEqual([
			{ key: 'bgmusic', value: true, exist: true },
			{ key: 'device', value: 'hdmi', exist: true },
			{ key: 'volume', value: 100, exist: true },
		])
	})

	it('returns [] on a non-ok response', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
		expect(await fetchConfigSection('box', 'audio')).toEqual([])
	})

	it('returns [] when the box is unreachable', async () => {
		vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
		expect(await fetchConfigSection('box', 'audio')).toEqual([])
	})
})

describe('saveConfigSection', () => {
	it('POSTs a flat changes map to the section endpoint', async () => {
		const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
		await saveConfigSection('box', 'audio', { volume: 90 })
		const [url, init] = spy.mock.calls[0] ?? []
		expect(url).toBe('http://box:81/api/configuration/audio')
		expect(init?.method).toBe('POST')
		expect(JSON.parse(init?.body as string)).toEqual({ volume: 90 })
	})

	it('throws when the box rejects the write', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 400 }))
		await expect(saveConfigSection('box', 'audio', { volume: 90 })).rejects.toThrow()
	})
})

describe('fetchSystemsCatalog', () => {
	it('normalizes systems, sorts emulators by priority and drops empty ones', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					systems: [
						{
							name: 'snes',
							fullName: 'Super Nintendo',
							manufacturer: 'Nintendo',
							emulators: [
								{ emulator: 'libretro', core: 'snes9x', priority: 2, speed: 2, compatibility: 1 },
								{
									emulator: 'libretro',
									core: 'mednafen',
									priority: 1,
									speed: 1,
									compatibility: 1,
									hasNetplay: true,
								},
							],
						},
						{ name: 'empty', fullName: 'Empty', emulators: [] },
					],
				}),
				{ status: 200 },
			),
		)
		const systems = await fetchSystemsCatalog('box')
		expect(systems).toHaveLength(1)
		expect(systems[0]?.name).toBe('snes')
		// priority 1 first
		expect(systems[0]?.emulators[0]?.core).toBe('mednafen')
		expect(systems[0]?.emulators[0]?.hasNetplay).toBe(true)
	})

	it('returns [] when unreachable', async () => {
		vi.spyOn(global, 'fetch').mockRejectedValue(new Error('down'))
		expect(await fetchSystemsCatalog('box')).toEqual([])
	})
})

describe('maskSecrets', () => {
	const fields: ConfigField[] = [
		{ key: 'retroachievements.username', value: 'bob', exist: true },
		{ key: 'retroachievements.password', value: 'hunter2', exist: true },
		{ key: 'key', value: '', exist: true },
	]
	const isSecret = (k: string) => k.endsWith('password') || k === 'key'

	it('replaces non-empty secret values with the sentinel and flags them', () => {
		const out = maskSecrets(fields, isSecret)
		expect(out[1]).toEqual({
			key: 'retroachievements.password',
			value: SECRET_SENTINEL,
			exist: true,
			secret: true,
		})
	})

	it('keeps empty secrets empty (so the UI shows them as unset)', () => {
		const out = maskSecrets(fields, isSecret)
		expect(out[2]).toEqual({ key: 'key', value: '', exist: true, secret: true })
	})

	it('leaves non-secret fields untouched', () => {
		const out = maskSecrets(fields, isSecret)
		expect(out[0]).toEqual({ key: 'retroachievements.username', value: 'bob', exist: true })
	})
})
