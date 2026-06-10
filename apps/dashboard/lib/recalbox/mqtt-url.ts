// Build an mqtt:// broker URL, bracketing IPv6 literal hosts ([fd7a::1]) per RFC 3986.
// Hostnames, IPv4, and MagicDNS names never contain ':' and pass through unchanged.
export function formatMqttUrl(host: string, port: number): string {
	const formattedHost = host.includes(':') ? `[${host}]` : host
	return `mqtt://${formattedHost}:${port}`
}
