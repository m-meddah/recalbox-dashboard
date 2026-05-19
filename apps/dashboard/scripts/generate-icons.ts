import { mkdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const ICONS_DIR = path.join(ROOT, 'public/icons')
const PUBLIC_DIR = path.join(ROOT, 'public')
const SOURCE_SVG = path.join(ICONS_DIR, 'icon-source.svg')

mkdirSync(ICONS_DIR, { recursive: true })

async function makeIcon(outputPath: string, size: number, maskable = false) {
	// Maskable: logo fills 80% (safe zone); regular: 90%
	const logoRatio = maskable ? 0.8 : 0.9
	const logoSize = Math.round(size * logoRatio)

	const bg = await sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: { r: 10, g: 10, b: 10, alpha: 255 },
		},
	})
		.png()
		.toBuffer()

	const logo = await sharp(SOURCE_SVG)
		.resize(logoSize, logoSize, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer()

	await sharp(bg)
		.composite([{ input: logo, gravity: 'center' }])
		.png()
		.toFile(outputPath)
	console.log(`✓ ${path.relative(ROOT, outputPath)}`)
}

async function main() {
	const icons: Array<{ path: string; size: number; maskable?: boolean }> = [
		// PWA manifest icons
		{ path: path.join(ICONS_DIR, 'icon-192.png'), size: 192 },
		{ path: path.join(ICONS_DIR, 'icon-512.png'), size: 512 },
		{ path: path.join(ICONS_DIR, 'icon-maskable-192.png'), size: 192, maskable: true },
		{ path: path.join(ICONS_DIR, 'icon-maskable-512.png'), size: 512, maskable: true },
		// Apple touch icons
		{ path: path.join(ICONS_DIR, 'apple-touch-icon.png'), size: 180 },
		// Favicon sizes
		{ path: path.join(ICONS_DIR, 'favicon-32x32.png'), size: 32 },
		{ path: path.join(ICONS_DIR, 'favicon-16x16.png'), size: 16 },
		// Push notification icons (referenced in lib/notifications/web-push.ts)
		{ path: path.join(PUBLIC_DIR, 'badge-72x72.png'), size: 72 },
		{ path: path.join(PUBLIC_DIR, 'icon-192x192.png'), size: 192 },
	]

	for (const icon of icons) {
		await makeIcon(icon.path, icon.size, icon.maskable)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
