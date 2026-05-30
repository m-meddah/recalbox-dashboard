const HLTB_BASE = 'https://howlongtobeat.com'
const TOKEN_TTL_MS = 5 * 60 * 1000 // tokens expire; renew every 5 min

type BleedInit = { token: string; hpKey: string; hpVal: string }

type HltbApiEntry = {
	game_id: number
	game_name: string
	comp_main: number
	comp_plus: number
	comp_100: number
}

export type HltbSearchEntry = {
	id: number
	name: string
	mainStorySeconds: number | null
	mainExtrasSeconds: number | null
	completionistSeconds: number | null
	similarity: number
}

let _bleed: BleedInit | null = null
let _bleedTs = 0

const UA = 'Mozilla/5.0 (compatible; recalbox-dashboard/1.0)'

async function getBleedToken(): Promise<BleedInit> {
	if (_bleed && Date.now() - _bleedTs < TOKEN_TTL_MS) return _bleed
	const res = await fetch(`${HLTB_BASE}/api/bleed/init?t=${Date.now()}`, {
		headers: { 'User-Agent': UA, Referer: `${HLTB_BASE}/` },
	})
	if (!res.ok) throw new Error(`[hltb] bleed/init returned ${res.status}`)
	_bleed = (await res.json()) as BleedInit
	_bleedTs = Date.now()
	return _bleed
}

export async function searchHltb(query: string): Promise<HltbSearchEntry[]> {
	const { token, hpKey, hpVal } = await getBleedToken()

	const body: Record<string, unknown> = {
		searchType: 'games',
		searchTerms: query.split(' ').filter(Boolean),
		searchPage: 1,
		size: 5,
		searchOptions: {
			games: {
				userId: 0,
				platform: '',
				sortCategory: 'popular',
				rangeCategory: 'main',
				rangeTime: { min: null, max: null },
				gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
				rangeYear: { min: '', max: '' },
				modifier: '',
			},
			users: { sortCategory: 'postcount' },
			lists: { sortCategory: 'follows' },
			filter: '',
			sort: 0,
			randomizer: 0,
		},
		useCache: true,
	}
	body[hpKey] = hpVal

	const res = await fetch(`${HLTB_BASE}/api/bleed`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-auth-token': token,
			'x-hp-key': hpKey,
			'x-hp-val': hpVal,
			Referer: `${HLTB_BASE}/`,
			Origin: HLTB_BASE,
			'User-Agent': UA,
		},
		body: JSON.stringify(body),
	})

	if (res.status === 403) {
		// token expired, force refresh next call
		_bleed = null
		throw new Error('[hltb] Search token expired (403)')
	}

	if (!res.ok) throw new Error(`[hltb] Search returned HTTP ${res.status}`)

	const data = (await res.json()) as { data?: HltbApiEntry[] }
	return (data.data ?? []).map((e) => ({
		id: e.game_id,
		name: e.game_name,
		mainStorySeconds: e.comp_main > 0 ? e.comp_main : null,
		mainExtrasSeconds: e.comp_plus > 0 ? e.comp_plus : null,
		completionistSeconds: e.comp_100 > 0 ? e.comp_100 : null,
		similarity: diceSimilarity(query, e.game_name),
	}))
}

function diceSimilarity(a: string, b: string): number {
	const norm = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]/g, ' ')
			.trim()
	const s1 = norm(a)
	const s2 = norm(b)
	if (s1 === s2) return 1

	const bigrams = (s: string) => {
		const set = new Set<string>()
		for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
		return set
	}

	const b1 = bigrams(s1)
	const b2 = bigrams(s2)
	if (b1.size === 0 || b2.size === 0) return 0

	let common = 0
	for (const bg of b1) if (b2.has(bg)) common++

	return (2 * common) / (b1.size + b2.size)
}
