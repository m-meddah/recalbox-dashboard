import type { NextRequest } from 'next/server'

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function getBearerToken(req: NextRequest): string | null {
	const header = req.headers.get('authorization') ?? ''
	const match = /^Bearer\s+(.+)$/i.exec(header)
	return match?.[1]?.trim() || null
}

/** Au plus quatre segments numériques : borne la longueur autant que la forme. */
const AGENT_VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/

/**
 * La version que l'agent déclare exécuter (`X-Agent-Version`). `null` quand
 * l'en-tête est absent — un agent antérieur au mécanisme — ou malformé.
 *
 * La valeur est écrite en base et comparée à une version cible ; un agent est
 * libre d'envoyer n'importe quoi, donc la forme est vérifiée ici, une fois,
 * plutôt qu'à chaque usage.
 */
export function getAgentVersion(req: NextRequest): string | null {
	const raw = req.headers.get('x-agent-version')?.trim()
	if (!raw) return null
	return AGENT_VERSION_RE.test(raw) ? raw : null
}
