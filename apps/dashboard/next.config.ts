import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	output: 'standalone',
	transpilePackages: ['@recalbox/scraper-core'],
}

export default nextConfig
