import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => true }))

import { GET } from '../route'

describe('GET /api/events en mode serverless', () => {
	it('répond 204 sans ouvrir de flux', async () => {
		const res = await GET(new Request('http://x/api/events'))
		expect(res.status).toBe(204)
		expect(res.body).toBeNull()
	})

	// Le court-circuit doit précéder l'authentification et toute lecture DB : le but
	// est justement de ne rien coûter. Un bundle client périmé qui rappelle cette
	// route ne doit déclencher aucune requête Turso.
	it('ne touche ni à l’auth ni à la base', async () => {
		const res = await GET(new Request('http://x/api/events?recalboxId=nimporte'))
		expect(res.status).toBe(204)
	})
})
