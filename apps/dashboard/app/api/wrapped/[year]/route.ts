import { invalidateWrappedCache, writeCachedWrapped } from '@/lib/wrapped/cache'
import { generateWrapped } from '@/lib/wrapped/generator'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ year: string }> }

const LOCALES = ['en', 'fr']

export async function POST(_req: Request, { params }: Params) {
	const { year: yearStr } = await params
	const year = Number.parseInt(yearStr, 10)

	if (Number.isNaN(year) || year < 2000 || year > new Date().getFullYear() + 1) {
		return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
	}

	await Promise.all(
		LOCALES.map(async (locale) => {
			await invalidateWrappedCache(year, locale)
			const wrapped = await generateWrapped(year, locale)
			await writeCachedWrapped(wrapped, locale)
		}),
	)

	return NextResponse.json({ ok: true, year })
}
