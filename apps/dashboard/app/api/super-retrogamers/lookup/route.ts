import { updateGameSrInfo } from '@/lib/db/queries'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { setCached } from '@/lib/super-retrogamers/cache'
import { srClient } from '@/lib/super-retrogamers/client'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
	slugs: z.array(z.string()).min(1).max(100),
	romPaths: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = bodySchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
	}
	const { slugs, romPaths } = parsed.data

	const [recalboxId, results] = await Promise.all([
		getActiveRecalboxId(),
		srClient.bulkLookup(slugs),
	])

	for (let i = 0; i < slugs.length; i++) {
		const slug = slugs[i] as string
		const romPath = romPaths?.[i]
		const result = results[slug] ?? { exists: false }

		setCached(`exists:${slug}`, result.exists)

		if (romPath && recalboxId) {
			updateGameSrInfo(recalboxId, romPath, slug, result.exists, result.url ?? null)
		}
	}

	return NextResponse.json({ results })
}
