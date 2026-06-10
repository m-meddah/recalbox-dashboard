import { describe, expect, it } from 'vitest'
import { formatMqttUrl } from '../mqtt-url'

describe('formatMqttUrl', () => {
	it('passes hostnames and IPv4 through unchanged', () => {
		expect(formatMqttUrl('recalbox.local', 1883)).toBe('mqtt://recalbox.local:1883')
		expect(formatMqttUrl('100.64.0.1', 1883)).toBe('mqtt://100.64.0.1:1883')
	})
	it('brackets IPv6 literal hosts', () => {
		expect(formatMqttUrl('fd7a:115c:a1e0::1', 1883)).toBe('mqtt://[fd7a:115c:a1e0::1]:1883')
	})
})
