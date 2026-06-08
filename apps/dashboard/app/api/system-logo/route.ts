import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getSshClient } from '@/lib/recalbox/ssh-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Console brand logos live in the default theme on the Recalbox filesystem (outside
// the /recalbox/share/ tree the generic media proxy whitelists), so they get their
// own endpoint. Files are named <systemId>.png (with regional variants alongside).
const LOGO_DIR =
	'/recalbox/share_init/system/.emulationstation/themes/recalbox-next/data/arts/systems_logos'

// System ids are lowercase alphanumerics (e.g. neogeocd, atari2600, msx1). Anything
// else is rejected — this also prevents any path traversal into the SSH command.
const SYSTEM_ID = /^[a-z0-9]+$/

export async function GET(request: Request) {
	if (!(await getUser())) return unauthorized()
	const { searchParams } = new URL(request.url)
	const system = searchParams.get('system')

	if (!system || !SYSTEM_ID.test(system)) {
		return new Response('Invalid system', { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return new Response('No Recalbox configured', { status: 503 })
	}

	const ssh = getSshClient(recalboxId, 'media')

	// One SSH round-trip: read the Recalbox's configured theme region (eu/us/jp) and serve
	// the matching regional logo (<id>-<region>.png), falling back to the region-less
	// <id>.png when no regional variant exists. REGION comes from the box's own conf (not
	// client input); `system` is validated to [a-z0-9]+ and LOGO_DIR is a constant, so the
	// interpolated path is safe.
	const cmd = `REGION=$(grep -E '^emulationstation\\.theme\\.region=' /recalbox/share/system/recalbox.conf 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\\r'); for f in "${LOGO_DIR}/${system}-$REGION.png" "${LOGO_DIR}/${system}.png"; do if [ -f "$f" ]; then base64 -w 0 "$f"; exit 0; fi; done; printf '__NF__'`

	try {
		const result = await ssh.exec(cmd, 15_000)

		if (!result || result === '__NF__') {
			// Missing logo (unknown system or different theme) — let the client fall back to
			// the emoji. Cache the 404 briefly so we don't hammer SSH on every render.
			return new Response('Logo not found', {
				status: 404,
				headers: { 'Cache-Control': 'public, max-age=300' },
			})
		}

		const buffer = Buffer.from(result, 'base64')
		if (buffer.byteLength === 0) return new Response('Logo not found', { status: 404 })

		return new Response(buffer, {
			headers: {
				'Content-Type': 'image/png',
				// Theme assets rarely change; cache a day (not immutable — region can change).
				'Cache-Control': 'public, max-age=86400',
				'Content-Length': String(buffer.byteLength),
			},
		})
	} catch {
		// Transient error (SSH timeout/drop) — do NOT cache, allow retry.
		return new Response('Logo not found', { status: 404 })
	}
}
