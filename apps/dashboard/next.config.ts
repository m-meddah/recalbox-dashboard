import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
	allowedDevOrigins: ['192.168.1.76'],
	output: 'standalone',
	transpilePackages: ['@recalbox/scraper-core'],
	serverExternalPackages: ['better-sqlite3', 'node-ssh'],
	experimental: {
		staleTimes: {
			dynamic: 0,
			static: 0,
		},
	},
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: [
					{ key: 'X-Content-Type-Options', value: 'nosniff' },
					{ key: 'X-Frame-Options', value: 'SAMEORIGIN' },
					{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
					{ key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
				],
			},
		]
	},
}

export default withNextIntl(nextConfig)
