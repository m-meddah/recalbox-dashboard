import { SCAN_SCRIPT_BASE64 } from './scan-script.generated'

/**
 * The on-box scan script, as source text.
 *
 * `agent/scan_roms.py` stays the single copy: it is what `agent/__tests__`
 * exercises. It is embedded here by `scripts/generate-scan-script.ts` rather
 * than read at runtime — a filesystem read works under tsx and Vitest but not
 * once the Next.js bundler takes over, and plan 2B calls this from an API route.
 *
 * `__tests__/scan-script.test.ts` fails if the generated module drifts from the
 * .py, so a forgotten regeneration surfaces in the test suite.
 */
export const SCAN_SCRIPT: string = Buffer.from(SCAN_SCRIPT_BASE64, 'base64').toString('utf-8')
