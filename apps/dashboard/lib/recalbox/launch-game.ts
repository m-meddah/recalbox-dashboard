import { getSshClient } from '@/lib/recalbox/ssh-client'

// rom paths always live under the share tree; system ids are lowercase alnum.
const SYSTEM_ID = /^[a-z0-9]+$/

// EmulationStation listens on UDP 1337 for "START|<system>|<rom>" commands and
// launches the game itself (so it releases the display, unlike an SSH-spawned
// emulator). Same mechanism as the official RecalboxHomeAssistant integration.
//
// We send the datagram *from the box* over the existing SSH connection rather
// than from the server: a fresh client-side UDP send can't reliably resolve mDNS
// names like "recalbox.local" (Node's getaddrinfo often fails where the long-lived
// SSH/HTTP connections succeed). This Python one-liner reads the message from
// stdin and fires it at ES's local listener — no shell-quoting of the rom path.
const UDP_SEND_PY =
	'import socket,sys; d=sys.stdin.buffer.read(); socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(d,("127.0.0.1",1337))'

/** Whether a system/rom pair is safe to send as a pipe-delimited launch command. */
export function isLaunchable(system: string, romPath: string): boolean {
	return (
		SYSTEM_ID.test(system) &&
		romPath.startsWith('/recalbox/share/') &&
		!romPath.includes('|') &&
		!romPath.includes('\n')
	)
}

/**
 * Ask the Recalbox's EmulationStation to launch a game via its UDP listener.
 * Throws on invalid input or SSH failure.
 */
export async function launchGame(
	recalboxId: string,
	system: string,
	romPath: string,
): Promise<void> {
	if (!isLaunchable(system, romPath)) {
		throw new Error('Invalid system or romPath')
	}
	const ssh = getSshClient(recalboxId)
	// base64 the message so the rom path (spaces, quotes, parens) needs no escaping.
	const payload = Buffer.from(`START|${system}|${romPath}`).toString('base64')
	await ssh.exec(`echo ${payload} | base64 -d | python3 -c '${UDP_SEND_PY}'`, 8000)
}
