import { invalidateWrappedCache, writeCachedWrapped } from '@/lib/wrapped/cache'
import { generateWrapped } from '@/lib/wrapped/generator'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ year: string }> }

export async function POST(_req: Request, { params }: Params) {
	const { year: yearStr } = await params
	const year = parseInt(yearStr, 10)

	if (isNaN(year) || year < 2000 || year > new Date().getFullYear() + 1) {
		return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
	}

	const locales = ['en', 'fr']
	await Promise.all(
		locales.map(async (locale) => {
			await invalidateWrappedCache(year, locale)
			const wrapped = await generateWrapped(year, locale)
			await writeCachedWrapped(wrapped, locale)
		}),
	)

	return NextResponse.json({ ok: true, year })
}
