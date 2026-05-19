import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
	output: 'standalone',
	transpilePackages: ['@recalbox/scraper-core'],
	serverExternalPackages: ['better-sqlite3', 'node-ssh'],
}

export default withNextIntl(nextConfig)
