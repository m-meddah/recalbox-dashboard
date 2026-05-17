import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let cachedFont: ArrayBuffer | null = null

export async function getInterBoldFont(): Promise<ArrayBuffer> {
	if (cachedFont) return cachedFont
	const buf = await readFile(join(process.cwd(), 'assets/fonts/Inter-700.woff'))
	cachedFont = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
	return cachedFont
}
