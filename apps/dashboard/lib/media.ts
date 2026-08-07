/**
 * One way to turn a game's artwork into an <img> src, for both deployment models.
 *
 * Serverless: the render resolves `url` from the `artwork` table (see
 * `resolveArtworkUrls`) and we point straight at object storage — the CDN serves
 * it and no function is invoked. Self-hosted: there are no artwork rows, `url` is
 * always null, and we fall back to the `/api/media` SSH proxy exactly as before.
 *
 * Components therefore never branch on the deployment mode; they just call this.
 */
export function mediaSrc(
	url: string | null | undefined,
	path: string | null | undefined,
): string | null {
	if (url) return url
	return path ? mediaProxyUrl(path) : null
}

/** The `/api/media` proxy URL for a box path. Prefer {@link mediaSrc}. */
export function mediaProxyUrl(path: string): string {
	return `/api/media?path=${encodeURIComponent(path)}`
}
