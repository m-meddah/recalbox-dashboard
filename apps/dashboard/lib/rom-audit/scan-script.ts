import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The on-box scan script, as source text.
 *
 * `agent/scan_roms.py` stays the single copy: it is what `agent/__tests__`
 * exercises, and a second transcription here would drift without anything
 * noticing.
 *
 * Loading it with readFileSync works under Vitest and under tsx, which is what
 * this lot needs. It will NOT survive the Next.js bundler — a `.py` is not a
 * known asset and the relative path does not outlive the build. Plan 2B, which
 * calls this from an API route, has to replace it with a generated `.ts`
 * checked by CI, or a typed text import.
 */
const SCRIPT_PATH = path.resolve(__dirname, '../../../../agent/scan_roms.py')

export const SCAN_SCRIPT: string = readFileSync(SCRIPT_PATH, 'utf-8')
