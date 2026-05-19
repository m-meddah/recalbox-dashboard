import { SlideImage } from '@/components/wrapped/slide-image'
import { getCachedWrapped } from '@/lib/wrapped/cache'
import { getInterBoldFont } from '@/lib/wrapped/fonts'
import { ImageResponse } from 'next/og'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const FORMATS = {
	story: [1080, 1920],
	square: [1080, 1080],
	landscape: [1200, 630],
} as const

type Params = { params: Promise<{ year: string; slide: string; locale: string }> }

export async function GET(req: NextRequest, { params }: Params) {
	const { year: yearStr, slide: slideStr, locale } = await params
	const year = Number.parseInt(yearStr, 10)
	const slideIndex = Number.parseInt(slideStr, 10)

	if (Number.isNaN(year) || Number.isNaN(slideIndex)) {
		return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
	}

	const formatParam = (req.nextUrl.searchParams.get('format') ?? 'story') as keyof typeof FORMATS
	const [width, height] = FORMATS[formatParam] ?? FORMATS.story

	const wrapped = await getCachedWrapped(year, locale)
	if (!wrapped) {
		return NextResponse.json({ error: 'Wrapped not found' }, { status: 404 })
	}

	const slide = wrapped.slides[slideIndex]
	if (!slide) {
		return NextResponse.json({ error: 'Slide not found' }, { status: 404 })
	}

	const fontData = await getInterBoldFont()

	return new ImageResponse(
		<SlideImage slide={slide} wrapped={wrapped} width={width} height={height} />,
		{
			width,
			height,
			fonts: [{ name: 'Inter', data: fontData, weight: 700 }],
			headers: { 'Cache-Control': 'public, max-age=3600' },
		},
	)
}
