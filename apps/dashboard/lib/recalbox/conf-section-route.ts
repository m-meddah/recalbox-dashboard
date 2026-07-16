/**
 * Builds the GET/POST handlers for a recalbox.conf "section" route from a field
 * spec. GET returns the current typed values; POST validates and writes them.
 * Auth + ownership checks mirror the other Recalbox control routes.
 */

import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import {
	type FieldSpec,
	readConfSection,
	validateConfSection,
	writeConfSection,
} from '@/lib/recalbox/conf-section'
import { NextResponse } from 'next/server'

export function createConfSectionHandlers(specs: readonly FieldSpec[], name: string) {
	async function GET(): Promise<NextResponse> {
		const user = await getUser()
		if (!user) return unauthorized()

		const recalboxId = await getActiveRecalboxId()
		if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
		if (!(await canViewRecalbox(user, recalboxId))) return forbidden()

		try {
			const values = await readConfSection(recalboxId, specs)
			return NextResponse.json({ values })
		} catch (err) {
			logger.error(`${name} GET failed`, err)
			return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
		}
	}

	async function POST(req: Request): Promise<NextResponse> {
		const user = await getUser()
		if (!user) return unauthorized()

		let body: { values?: unknown }
		try {
			body = await req.json()
		} catch {
			return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
		}

		const result = validateConfSection(specs, body?.values)
		if ('error' in result) {
			return NextResponse.json({ error: result.error }, { status: 400 })
		}

		const recalboxId = await getActiveRecalboxId()
		if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
		if (!(await canControlRecalbox(user, recalboxId))) return forbidden()

		try {
			const ok = await writeConfSection(recalboxId, result.changes)
			if (!ok) return NextResponse.json({ error: 'recalbox.conf not found' }, { status: 404 })
			logger.info(`${name}: ${Object.keys(result.changes).length} key(s) updated`)
			return NextResponse.json({ ok: true })
		} catch (err) {
			logger.error(`${name} POST failed`, err)
			return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
		}
	}

	return { GET, POST }
}
