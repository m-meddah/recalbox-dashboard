'use client'

import { Button } from '@/components/ui/button'
import { CheckCircle2, HelpCircle, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

/** Mirrors VerifyOutcome from lib/rom-audit/deep-verify. */
type Outcome =
	| { status: 'intact'; sha1?: string }
	| { status: 'corrupt'; detail: string }
	| { status: 'verified'; crc32: string; sha1: string; datEntryName: string }
	| { status: 'mismatch'; crc32: string; sha1: string }
	| { status: 'no-catalog'; crc32: string; sha1: string }
	| { status: 'unsupported'; reason: string }
	| { status: 'tool-missing'; tool: string }
	| { status: 'failed'; reason: string }

export function DeepVerifyButton({
	recalboxId,
	entryKey,
	kind,
	toolAvailable,
}: {
	recalboxId: string
	entryKey: string
	kind: string
	/** False when the host lacks the binary, or in serverless mode. */
	toolAvailable: boolean
}) {
	const t = useTranslations('romAudit.verify')
	const [busy, setBusy] = useState(false)
	const [outcome, setOutcome] = useState<Outcome | null>(null)

	// Only a CHD or an RVZ carries anything a deep verification can check.
	if (kind !== 'chd' && kind !== 'rvz') return null
	if (!toolAvailable) return null

	async function verify() {
		setBusy(true)
		setOutcome(null)
		try {
			const res = await fetch('/api/rom-audit/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ recalboxId, entryKey }),
			})
			if (!res.ok) {
				setOutcome({ status: 'failed', reason: String(res.status) })
				return
			}
			setOutcome((await res.json()).result as Outcome)
		} catch {
			setOutcome({ status: 'failed', reason: 'network' })
		} finally {
			setBusy(false)
		}
	}

	return (
		<span className="inline-flex items-center gap-2">
			<Button size="sm" variant="outline" onClick={verify} disabled={busy}>
				{busy ? (
					<Loader2 className="mr-2 size-3 animate-spin" />
				) : (
					<ShieldCheck className="mr-2 size-3" />
				)}
				{busy ? t('running') : t('action')}
			</Button>

			{outcome && <Verdict outcome={outcome} />}
		</span>
	)
}

function Verdict({ outcome }: { outcome: Outcome }) {
	const t = useTranslations('romAudit.verify')

	switch (outcome.status) {
		case 'intact':
			return (
				<span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
					<CheckCircle2 className="size-3" />
					{t('intact')}
				</span>
			)
		case 'verified':
			return (
				<span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
					<CheckCircle2 className="size-3" />
					{t('verified', { entry: outcome.datEntryName })}
				</span>
			)
		case 'corrupt':
			return (
				<span className="inline-flex items-center gap-1 text-destructive text-xs">
					<XCircle className="size-3" />
					{t('corrupt')}
				</span>
			)
		// NOT an accusation: Redump does not list every dump, so a hash matching
		// nothing may be a damaged file OR a legitimate one it never catalogued.
		case 'mismatch':
			return (
				<span className="inline-flex items-center gap-1 text-amber-600 text-xs">
					<HelpCircle className="size-3" />
					{t('mismatch', { sha1: outcome.sha1.slice(0, 12) })}
				</span>
			)
		case 'no-catalog':
			return <span className="text-muted-foreground text-xs">{t('noCatalog')}</span>
		case 'tool-missing':
			return (
				<span className="text-muted-foreground text-xs">
					{t('toolMissing', { tool: outcome.tool })}
				</span>
			)
		case 'unsupported':
			return <span className="text-muted-foreground text-xs">{t('unsupported')}</span>
		default:
			return <span className="text-destructive text-xs">{t('failed')}</span>
	}
}
