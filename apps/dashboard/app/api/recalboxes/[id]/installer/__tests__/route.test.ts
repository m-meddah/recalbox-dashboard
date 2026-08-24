import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canControl = vi.fn()
const getRecalbox = vi.fn()
const readAgentPayload = vi.fn()
const createAgentToken = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: { getRecalbox: (...a: unknown[]) => getRecalbox(...a) },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	INSTALLER_TOKEN_NAME: 'installeur',
	createAgentToken: (...a: unknown[]) => createAgentToken(...a),
}))
vi.mock('@/lib/agent/payload', () => ({
	readAgentPayload: (...a: unknown[]) => readAgentPayload(...a),
}))

import { GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
const req = (search = '') =>
	new Request(`http://localhost/api/recalboxes/rb-1/installer${search}`) as never

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	canControl.mockResolvedValue(true)
	getRecalbox.mockReturnValue({ id: 'rb-1', name: 'Salon' })
	readAgentPayload.mockResolvedValue({
		agentPy: '# agent',
		scanRomsPy: '# scan',
		launchPy: '# launch',
		launcherSh: '#!/bin/bash\n',
		version: '1.0.0',
	})
	createAgentToken.mockResolvedValue({
		token: 'raw-token',
		row: { id: 'tok-1', name: 'installeur' },
	})
})
afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
	getRecalbox.mockReset()
	readAgentPayload.mockReset()
	createAgentToken.mockReset()
})

describe('GET /api/recalboxes/[id]/installer', () => {
	it('401 sans session', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET(req(), ctx as never)).status).toBe(401)
	})

	it('403 pour qui ne contrôle pas la box', async () => {
		canControl.mockResolvedValue(false)
		expect((await GET(req(), ctx as never)).status).toBe(403)
	})

	it('404 si la box est inconnue', async () => {
		getRecalbox.mockReturnValue(null)
		expect((await GET(req(), ctx as never)).status).toBe(404)
	})

	it('renvoie une archive zip nommée', async () => {
		const res = await GET(req(), ctx as never)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('application/zip')
		expect(res.headers.get('content-disposition')).toContain('.zip')
	})

	it('produit un zip qui contient le token frappé', async () => {
		const { unzipSync, strFromU8 } = await import('fflate')
		const res = await GET(req(), ctx as never)
		const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
		// Indexer un Unzipped donne `Uint8Array | undefined`. Un `!` tairait le
		// compilateur mais transformerait un chemin disparu en « undefined » illisible ;
		// cette garde nomme l'entrée manquante.
		const configEntry = files['system/sr-agent/config.json']
		if (!configEntry) throw new Error('zip entry manquante: system/sr-agent/config.json')
		const config = JSON.parse(strFromU8(configEntry))
		expect(config.token).toBe('raw-token')
	})

	it("neutralise un nom de box piégé dans l'entête Content-Disposition", async () => {
		// Guillemet, CRLF et caractère non-ASCII dans un seul nom : rien de tout ça ne
		// doit survivre dans l'entête, sous peine d'injection d'entête HTTP.
		getRecalbox.mockReturnValue({ id: 'rb-1', name: 'Sal"on\r\nÉté 🎮' })
		const res = await GET(req(), ctx as never)
		const header = res.headers.get('content-disposition') ?? ''
		expect(header).not.toContain('\r')
		expect(header).not.toContain('\n')
		// Seules les deux guillemets structurelles de filename="..." doivent rester —
		// aucune ne doit provenir du nom piégé.
		expect((header.match(/"/g) ?? []).length).toBe(2)
		expect(header).toMatch(/^attachment; filename="[a-z0-9-]+\.zip"$/)
	})

	describe('hygiène des tokens installeur', () => {
		it('un re-téléchargement ne révoque jamais un token installeur déjà miné', async () => {
			// La révocation au téléchargement a été retirée : minter un nouveau token
			// (un deuxième appel à cette route, simulant un re-téléchargement) ne doit
			// avoir aucun effet de bord sur les tokens existants. Le nettoyage vit
			// maintenant côté `resolveAgentToken` (voir agent-queries.test.ts), au
			// premier check-in réel de l'agent — jamais ici.
			await GET(req(), ctx as never)
			await GET(req(), ctx as never)
			expect(createAgentToken).toHaveBeenCalledTimes(2)
			// La route ne connaît même plus `listAgentTokens`/`revokeAgentToken` : rien
			// dans son module mocké ne les expose, donc il n'y a rien qu'elle puisse
			// appeler pour révoquer quoi que ce soit.
		})
	})

	describe('locale du LISEZMOI.txt', () => {
		async function readmeText(search: string): Promise<string> {
			const { unzipSync, strFromU8 } = await import('fflate')
			const res = await GET(req(search), ctx as never)
			const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
			const entry = files['LISEZMOI.txt']
			if (!entry) throw new Error('zip entry manquante: LISEZMOI.txt')
			return strFromU8(entry)
		}

		it('sans paramètre, écrit le LISEZMOI.txt en anglais par défaut', async () => {
			expect(await readmeText('')).toContain('agent install')
		})

		it('avec ?locale=fr, écrit le LISEZMOI.txt en français', async () => {
			expect(await readmeText('?locale=fr')).toContain("installation de l'agent")
		})

		it('avec une locale non supportée, retombe sur l anglais', async () => {
			expect(await readmeText('?locale=de')).toContain('agent install')
		})

		it('garde le nom de fichier LISEZMOI.txt quelle que soit la locale', async () => {
			const { unzipSync } = await import('fflate')
			const res = await GET(req('?locale=en'), ctx as never)
			const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
			expect(Object.keys(files)).toContain('LISEZMOI.txt')
		})
	})

	it('renvoie 500 avec un message JSON intelligible si la préparation échoue', async () => {
		readAgentPayload.mockRejectedValue(new Error('ENOENT: agent-payload/launch.py missing'))
		const res = await GET(req(), ctx as never)
		expect(res.status).toBe(500)
		const body = await res.json()
		expect(typeof body.error).toBe('string')
		expect(body.error.length).toBeGreaterThan(0)
		expect(body.error).not.toContain('ENOENT')
	})

	it('renvoie 500 avec le même message JSON si le zip échoue APRÈS avoir miné le token', async () => {
		// Le `try` doit couvrir tout le chemin jusqu'à la réponse, pas seulement le
		// mint du token : ici le token est minté avec succès (createAgentToken
		// répond normalement), et c'est l'assemblage du zip qui échoue ensuite
		// (`launcherSh` invalide fait planter `buildInstallerZip`). Avant l'élargissement
		// du try/catch, ce chemin laissait échapper un 500 brut au lieu du message traduit.
		readAgentPayload.mockResolvedValue({
			agentPy: '# agent',
			scanRomsPy: '# scan',
			launchPy: '# launch',
			launcherSh: null,
			version: '1.0.0',
		})
		const res = await GET(req(), ctx as never)
		expect(res.status).toBe(500)
		const body = await res.json()
		expect(typeof body.error).toBe('string')
		expect(body.error.length).toBeGreaterThan(0)
		expect(createAgentToken).toHaveBeenCalled()
	})
})
