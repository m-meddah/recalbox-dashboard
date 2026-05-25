import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: 'Recalbox Dashboard',
		short_name: 'Recalbox',
		description:
			'Companion analytics dashboard for your Recalbox — playtime history, achievement progress, and an annual recap.',
		start_url: '/en/?source=pwa',
		display: 'standalone',
		background_color: '#0a0a0a',
		theme_color: '#0a0a0a',
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{
				src: '/icons/icon-maskable-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'maskable',
			},
			{
				src: '/icons/icon-maskable-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable',
			},
		],
		shortcuts: [
			{
				name: 'Collection',
				url: '/collection',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
			},
			{
				name: 'Stats',
				url: '/stats',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
			},
			{
				name: 'Achievements',
				url: '/achievements',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
			},
		],
	}
}
