import { installerReadme, resolveInstallerLocale } from '@/lib/agent/installer-readme'
import { describe, expect, it } from 'vitest'

describe('resolveInstallerLocale', () => {
	it('accepts a supported locale', () => {
		expect(resolveInstallerLocale('fr')).toBe('fr')
		expect(resolveInstallerLocale('en')).toBe('en')
	})

	it('defaults to English for null, missing, or unsupported locales', () => {
		expect(resolveInstallerLocale(null)).toBe('en')
		expect(resolveInstallerLocale('')).toBe('en')
		expect(resolveInstallerLocale('de')).toBe('en')
		expect(resolveInstallerLocale('fr-FR')).toBe('en')
		expect(resolveInstallerLocale('<script>')).toBe('en')
	})
})

describe('installerReadme', () => {
	it('writes French copy for the fr locale', () => {
		const text = installerReadme('fr', 'Salon', '1.2.3')
		expect(text).toContain("installation de l'agent")
		expect(text).toContain('Salon')
		expect(text).toContain('1.2.3')
	})

	it('writes English copy for the en locale', () => {
		const text = installerReadme('en', 'Living room', '1.2.3')
		expect(text).toContain('agent install')
		expect(text).toContain('Living room')
		expect(text).toContain('1.2.3')
	})

	it('warns about the old manual custom.sh install in both languages', () => {
		// The old install path isn't detected or neutralised automatically (see the
		// design doc) — a box that still has it must be cleaned up by hand, or both
		// paths start an agent and every play session gets recorded twice.
		expect(installerReadme('fr', 'Salon', '1.0.0')).toContain('custom.sh')
		expect(installerReadme('en', 'Living room', '1.0.0')).toContain('custom.sh')
	})
})
