/**
 * Wrap a string in single quotes for safe shell embedding.
 * Single quotes inside the string are escaped by ending the quoted segment,
 * inserting an escaped quote, and restarting: ' → '\''
 */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Recalbox's SSH server silently rejects very long command strings — measured
 * between 5 and 10 KB on RecalboxOS. Batching commands into one round trip is
 * still worth it, just not without a ceiling.
 */
export const MAX_SSH_COMMAND_LENGTH = 4000

/**
 * Split commands into groups whose joined length stays under the server's limit.
 * A single command longer than the limit gets its own group rather than being
 * dropped — better to let it fail loudly than to silently skip it.
 */
export function chunkShellCommands(
	commands: string[],
	maxLength = MAX_SSH_COMMAND_LENGTH,
): string[][] {
	const chunks: string[][] = []
	let current: string[] = []
	let length = 0

	for (const command of commands) {
		// +1 for the separator that will join them
		if (current.length > 0 && length + command.length + 1 > maxLength) {
			chunks.push(current)
			current = []
			length = 0
		}
		current.push(command)
		length += command.length + 1
	}
	if (current.length > 0) chunks.push(current)

	return chunks
}
