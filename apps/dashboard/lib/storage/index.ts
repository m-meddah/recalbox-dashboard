import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Object storage for game artwork. The on-device agent uploads image bytes (via
 * the cloud); we store them and serve a stable public URL — replacing the live
 * SSH media proxy in serverless mode.
 *
 * Provider is env-selected:
 *  - BLOB_READ_WRITE_TOKEN set → Vercel Blob (production / deploy target).
 *  - otherwise → a local-filesystem adapter (dev/tests), served by /api/blob.
 */
export type PutResult = { url: string }

const EXT_CONTENT_TYPE: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	bmp: 'image/bmp',
}

export function contentTypeForPath(p: string): string {
	const ext = p.split('.').pop()?.toLowerCase() ?? ''
	return EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream'
}

/**
 * Content type for an artwork UPLOAD, or null when the path is not an allowed
 * image. Unlike contentTypeForPath() there is no octet-stream fallback: an upload
 * we cannot type as an image is refused rather than stored.
 *
 * Note SVG is deliberately absent — it is the one "image" format that can carry
 * script, and artwork is served from a domain we own.
 */
export function artworkContentType(boxPath: string): string | null {
	const ext = boxPath.split('.').pop()?.toLowerCase() ?? ''
	return EXT_CONTENT_TYPE[ext] ?? null
}

const MAGIC: ReadonlyArray<(b: Buffer) => boolean> = [
	// PNG
	(b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
	// JPEG (all variants start FF D8 FF)
	(b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	// GIF87a / GIF89a
	(b) => b.length >= 6 && b.subarray(0, 4).toString('latin1') === 'GIF8',
	// WebP: "RIFF" .... "WEBP"
	(b) =>
		b.length >= 12 &&
		b.subarray(0, 4).toString('latin1') === 'RIFF' &&
		b.subarray(8, 12).toString('latin1') === 'WEBP',
	// BMP
	(b) => b.length >= 2 && b.subarray(0, 2).toString('latin1') === 'BM',
]

/**
 * Whether the bytes begin with a known image signature.
 *
 * Deliberately NOT checked against the declared extension: scraped Recalbox
 * artwork is routinely mislabelled (a .png that is really a JPEG), and rejecting
 * those would break legitimate uploads for no security gain. What matters is that
 * the payload is an image at all, so the bucket cannot be used to host something
 * else under a domain we own.
 */
export function looksLikeImage(bytes: Buffer): boolean {
	return MAGIC.some((match) => match(bytes))
}

/** Stable storage key for a Recalbox file path (keeps the extension for serving). */
export function artworkKey(recalboxId: string, boxPath: string): string {
	const ext = boxPath.split('.').pop()?.toLowerCase() ?? 'bin'
	const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin'
	const hash = createHash('sha1').update(boxPath).digest('hex')
	return `artwork/${recalboxId}/${hash}.${safeExt}`
}

export function isLocalStorage(): boolean {
	return !process.env.BLOB_READ_WRITE_TOKEN
}

function localDir(): string {
	return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), '.storage'))
}

/** Local-filesystem store (dev/tests). Returns a URL served by GET /api/blob/[...key]. */
async function putLocal(key: string, bytes: Buffer): Promise<PutResult> {
	const dest = path.join(localDir(), key)
	await mkdir(path.dirname(dest), { recursive: true })
	await writeFile(dest, bytes)
	return { url: `/api/blob/${key}` }
}

/** Read a locally-stored object back (used by the dev serving route). Null if absent or escaping. */
export async function readLocal(key: string): Promise<Buffer | null> {
	const base = localDir()
	const dest = path.join(base, key)
	if (!dest.startsWith(base + path.sep)) return null // path traversal guard
	try {
		return await readFile(dest)
	} catch {
		return null
	}
}

async function putBlob(key: string, bytes: Buffer, contentType: string): Promise<PutResult> {
	const { put } = await import('@vercel/blob')
	const { url } = await put(key, bytes, {
		access: 'public',
		contentType,
		addRandomSuffix: false,
		token: process.env.BLOB_READ_WRITE_TOKEN,
	})
	return { url }
}

/** Store object bytes and return its public URL. */
export async function putObject(
	key: string,
	bytes: Buffer,
	contentType: string,
): Promise<PutResult> {
	return isLocalStorage() ? putLocal(key, bytes) : putBlob(key, bytes, contentType)
}
