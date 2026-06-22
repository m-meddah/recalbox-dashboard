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
