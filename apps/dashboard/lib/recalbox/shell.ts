/**
 * Wrap a string in single quotes for safe shell embedding.
 * Single quotes inside the string are escaped by ending the quoted segment,
 * inserting an escaped quote, and restarting: ' → '\''
 */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`
}
