/**
 * Narrows a possibly-undefined value (array index access under
 * noUncheckedIndexedAccess) without a `!` non-null assertion — Biome's
 * noNonNullAssertion rule forbids those. Throws loudly instead of letting an
 * empty array/undefined slip through as a silent `undefined === undefined`
 * pass further down the assertion chain.
 */
export function defined<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('expected a defined value')
	return value
}
