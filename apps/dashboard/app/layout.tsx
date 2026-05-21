import type { Metadata } from 'next'

export const metadata: Metadata = {
	icons: {
		icon: [
			{ url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
			{ url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
		],
		apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
	},
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return children
}
