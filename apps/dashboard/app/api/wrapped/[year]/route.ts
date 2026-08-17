import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { invalidateWrappedCache, writeCachedWrapped } from '@/lib/wrapped/cache'
import { generateWrapped } from '@/lib/wrapped/generator'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ year: string }> }

const LOCALES = ['en', 'fr']

export async function POST(_req: Request, { params }: Params) {
	const user = await getUser()
	if (!user) return unauthorized()
	// Regenerate only what this caller may see: the recap is per box set, and so is its
	// cache entry.
	const recalboxIds = await getViewableRecalboxIds(user)
	const { year: yearStr } = await params
	const year = Number.parseInt(yearStr, 10)

	if (Number.isNaN(year) || year < 2000 || year > new Date().getFullYear() + 1) {
		return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
	}

	await Promise.all(
		LOCALES.map(async (locale) => {
			await invalidateWrappedCache(year, locale, recalboxIds)
			const wrapped = await generateWrapped(year, locale, recalboxIds)
			await writeCachedWrapped(wrapped, locale, recalboxIds)
		}),
	)

	return NextResponse.json({ ok: true, year })
}
