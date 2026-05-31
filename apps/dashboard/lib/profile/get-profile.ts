import { db } from '@/lib/db'
import { type UserProfile, type WeightedItem, userProfile } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Récupère le profil de goûts singleton. Lance une erreur si absent
 * (ne devrait pas arriver : la migration seed id=1).
 */
export async function getUserProfile(): Promise<UserProfile> {
	const profile = await db.select().from(userProfile).where(eq(userProfile.id, 1)).get()

	if (!profile) {
		throw new Error('User profile singleton not found — run the migration to seed it')
	}

	return profile
}

/**
 * Retourne le poids d'un item dans une dimension. 0 si absent du top.
 */
export function getWeightFor(items: WeightedItem[], key: string): number {
	return items.find((i) => i.key === key)?.weight ?? 0
}

/**
 * Indique si le profil a assez de données pour être fiable.
 * @param threshold - Seuil de maturité (0-1), défaut 0.3.
 */
export function isProfileMature(profile: UserProfile, threshold = 0.3): boolean {
	return profile.profileMaturity >= threshold
}
