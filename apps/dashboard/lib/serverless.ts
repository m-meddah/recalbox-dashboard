/**
 * Serverless deployment toggle. Set `AGENT_ONLY_MEDIA=1` on the Vercel deploy
 * (see docs/serverless-deploy.md): the cloud has no SSH link to the box, so the
 * live-SSH features are turned off and superseded by the on-box agent —
 *   - media proxy → object-storage artwork
 *   - power / recalbox.conf editing → the remote-control command queue (Phase D)
 * The same flag therefore gates the SSH-only UI (PowerControls, /configuration).
 */
export function isServerlessMode(): boolean {
	return process.env.AGENT_ONLY_MEDIA === '1'
}
