import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	output: 'standalone',
	transpilePackages: ['@recalbox/scraper-core'],
	serverExternalPackages: ['better-sqlite3', 'node-ssh'],
}

export default nextConfig
