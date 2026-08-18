import path from 'node:path'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { buildSecurityHeaders } from './lib/security/headers'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
	allowedDevOrigins: ['192.168.1.76'],
	output: 'standalone',
	serverExternalPackages: ['better-sqlite3', 'node-ssh'],
	// Le dossier `agent/` vit à la racine du monorepo, hors du périmètre que Next
	// trace automatiquement. `outputFileTracingIncludes` avec un glob `../../agent/*`
	// ne fonctionne PAS sous Turbopack (le bundler par défaut de `next build` en
	// Next 16) : vérifié empiriquement — un fichier de test placé dans
	// `apps/dashboard/` était bien copié dans `.next/standalone`, un fichier
	// équivalent en dehors de `apps/dashboard/` (via `../../`) ne l'était jamais,
	// et ce même avec `outputFileTracingRoot` élargi à la racine du monorepo.
	// Repli : `scripts/copy-agent-payload.mjs` (lancé en `prebuild`) copie les
	// fichiers de l'agent dans `apps/dashboard/agent-payload/` — DANS le
	// périmètre tracé — avant que `next build` ne s'exécute. Le nom du dossier ne
	// doit PAS commencer par un point : `.agent-payload/` (testé) n'est jamais
	// tracé par Turbopack, même avec les mêmes globs. Toucher l'un de ces trois
	// éléments (script, chemins ci-dessous, `agentDir()` dans payload.ts) sans
	// les autres casse la production sans casser le local.
	outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
	outputFileTracingIncludes: {
		'/api/recalboxes/[id]/installer': [
			'agent-payload/agent.py',
			'agent-payload/scan_roms.py',
			'agent-payload/VERSION',
		],
	},
	experimental: {
		staleTimes: {
			dynamic: 0,
			// Next 16 enforces a floor of 30s for the static client-router cache; 30 is
			// the lowest allowed (was 0). Most pages are force-dynamic, so this is moot.
			static: 30,
		},
	},
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: buildSecurityHeaders(process.env),
			},
		]
	},
}

export default withNextIntl(nextConfig)
