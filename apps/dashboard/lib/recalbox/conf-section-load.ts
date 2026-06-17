/** Server helper: read a section's current values for the active Recalbox, with
 * a safe fallback to neutral defaults when none is configured or it's offline. */

import { getActiveRecalboxId } from '@/lib/recalbox/active'
import {
	type ConfValue,
	type FieldSpec,
	defaultConfValues,
	readConfSection,
} from '@/lib/recalbox/conf-section'

export async function loadConfSectionValues(
	specs: readonly FieldSpec[],
): Promise<Record<string, ConfValue>> {
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return defaultConfValues(specs)
	try {
		return await readConfSection(recalboxId, specs)
	} catch {
		return defaultConfValues(specs)
	}
}
