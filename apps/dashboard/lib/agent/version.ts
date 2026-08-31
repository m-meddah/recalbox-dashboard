/**
 * Compare deux versions pointées (`1.10.0` vs `1.9.0`), segment par segment.
 *
 * Une comparaison de chaînes classerait `1.10.0` AVANT `1.9.0` : c'est
 * exactement l'erreur qui ferait descendre tout un parc en croyant le monter.
 * Un segment illisible vaut 0 plutôt qu'une exception — cette fonction est
 * appelée sur une valeur qui vient du réseau, et lever ici couperait la boucle
 * de commandes de la box.
 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.')
	const pb = b.split('.')
	const len = Math.max(pa.length, pb.length)
	for (let i = 0; i < len; i++) {
		const na = segment(pa[i])
		const nb = segment(pb[i])
		if (na !== nb) return na - nb
	}
	return 0
}

function segment(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? '0', 10)
	return Number.isNaN(n) ? 0 : n
}
