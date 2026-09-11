import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const getArtwork = vi.fn()
const markWanted = vi.fn()
const exec = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/auth/require-user', () => ({
	getUser: () => getUser(),
	unauthorized: () => new Response('Unauthorized', { status: 401 }),
}))
vi.mock('@/lib/db/artwork', () => ({
	getArtwork: (...a: unknown[]) => getArtwork(...a),
	markWanted: (...a: unknown[]) => markWanted(...a),
}))
vi.mock('@/lib/recalbox/active', () => ({
	getActiveRecalboxId: () => getActiveRecalboxId(),
}))
vi.mock('@/lib/recalbox/ssh-client', () => ({
	getSshClient: () => ({ exec: (...a: unknown[]) => exec(...a) }),
}))

import { GET } from '../route'

const VIDEO = '/recalbox/share/roms/psx/media/videos/Quack Attack 130370e8.mp4'
const COVER = '/recalbox/share/roms/psx/media/images/Quack Attack 130370e8.png'

function req(path: string) {
	return new Request(`https://dash.test/api/media?path=${encodeURIComponent(path)}`)
}

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1' })
	getActiveRecalboxId.mockResolvedValue('rb1')
	getArtwork.mockResolvedValue(undefined)
	markWanted.mockResolvedValue(undefined)
})
afterEach(() => {
	vi.clearAllMocks()
	process.env.AGENT_ONLY_MEDIA = undefined
})

/**
 * Point d'entrée de l'incident du 2026-09-07 : l'UI de recommandations demande la
 * vidéo d'un jeu par ce proxy, qui la mettait en file d'attente d'un stockage
 * n'acceptant que des images. Trois vidéos y sont restées coincées trois jours.
 */
describe('GET /api/media in serverless mode', () => {
	beforeEach(() => {
		process.env.AGENT_ONLY_MEDIA = '1'
	})

	it('refuses a video outright instead of queueing it', async () => {
		const res = await GET(req(VIDEO))
		expect(res.status).toBe(415)
		expect(markWanted).not.toHaveBeenCalled()
		expect(exec).not.toHaveBeenCalled()
	})

	// Un 404 court invite les 4 réessais de media-retry, à chaque rendu, pour un
	// fichier qui n'arrivera jamais. Le verdict est définitif : il doit être caché.
	it('lets the browser cache that refusal', async () => {
		const res = await GET(req(VIDEO))
		expect(res.headers.get('Cache-Control')).toMatch(/max-age=(?!30\b)\d{4,}/)
	})

	it('still queues a real image', async () => {
		const res = await GET(req(COVER))
		expect(res.status).toBe(404)
		expect(markWanted).toHaveBeenCalledWith({}, 'rb1', COVER)
	})
})

/**
 * Auto-hébergé : aucun stockage objet, le proxy SSH sert le fichier tel quel —
 * y compris les vidéos, qui y fonctionnent. Le garde ci-dessus ne doit pas
 * déborder sur ce mode.
 */
describe('GET /api/media self-hosted', () => {
	it('serves a video over SSH as before', async () => {
		exec.mockResolvedValue(Buffer.from('fake video bytes').toString('base64'))
		const res = await GET(req(VIDEO))
		expect(res.status).toBe(200)
		expect(exec).toHaveBeenCalled()
	})
})
