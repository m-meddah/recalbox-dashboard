import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { buildSecurityHeaders } from './lib/security/headers'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
	allowedDevOrigins: ['192.168.1.76'],
	output: 'standalone',
	serverExternalPackages: ['better-sqlite3', 'node-ssh'],
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
