import { describe, expect, it } from 'vitest'
import { HOST_REGEX } from '../host'

describe('HOST_REGEX', () => {
	it.each([
		'recalbox.local',
		'100.64.0.1',
		'fd7a:115c:a1e0::1',
		'fd7a:115c:a1e0:ab12:4843:cd96:6258:0102',
		'recalbox-salon',
		'recalbox-salon.tailnet-name.ts.net',
	])('accepts %s', (host) => {
		expect(HOST_REGEX.test(host)).toBe(true)
	})

	it.each(['has space', 'evil;rm -rf', 'a/b', 'quote"', 'pipe|cmd', ''])('rejects %s', (host) => {
		expect(HOST_REGEX.test(host)).toBe(false)
	})
})
