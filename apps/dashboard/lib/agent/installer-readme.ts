import { routing } from '@/i18n/routing'
import { hasLocale } from 'next-intl'

export type InstallerLocale = (typeof routing.locales)[number]

/**
 * Resolve an arbitrary, user-supplied string (typically a query parameter) to
 * a supported locale. Defaults to English on anything unexpected — missing,
 * malformed, or a locale the app doesn't ship — rather than throwing: this
 * only decides which language a plain-text readme is written in, never
 * something worth failing the whole download over.
 */
export function resolveInstallerLocale(raw: string | null): InstallerLocale {
	return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale
}

/**
 * `LISEZMOI.txt` content, in the language the wizard was running in when the
 * user downloaded the zip. The file name stays `LISEZMOI.txt` in both
 * languages — changing it would break the "drag two folders" muscle memory
 * this whole installer is designed around, and it's what the spec and tests
 * expect.
 *
 * Kept out of `messages/*.json` on purpose: this is a plain-text file
 * shipped inside a zip, not UI copy, and it contains literal backslashes
 * (`\\RECALBOX`) that JSON escaping makes error-prone to review and edit.
 */
export function installerReadme(locale: InstallerLocale, boxName: string, version: string): string {
	return locale === 'fr' ? readmeFr(boxName, version) : readmeEn(boxName, version)
}

function readmeFr(boxName: string, version: string): string {
	return [
		`Recalbox Dashboard — installation de l'agent (version ${version})`,
		`Box : ${boxName}`,
		'',
		'1. Ouvrez ce fichier zip.',
		"2. Dans l'explorateur de fichiers, tapez \\\\RECALBOX (Windows)",
		'   ou smb://recalbox (macOS), puis ouvrez le dossier "share".',
		'3. Glissez les dossiers "system" et "userscripts" dans "share".',
		'   Si Windows propose de fusionner, acceptez : rien ne sera écrasé.',
		'4. Redémarrez la Recalbox.',
		'',
		'Si vous aviez déjà installé l\'agent à l\'ancienne (un fichier "custom.sh"',
		'ajouté à la main), supprimez-le avant de glisser ce zip : sinon les deux',
		'installations démarrent chacune un agent, et vos parties sont comptées',
		'deux fois.',
		'',
		"L'agent démarre tout seul et votre box apparaît dans le dashboard.",
		'Ce fichier contient une clé propre à votre box : ne le partagez pas.',
	].join('\n')
}

function readmeEn(boxName: string, version: string): string {
	return [
		`Recalbox Dashboard — agent install (version ${version})`,
		`Box: ${boxName}`,
		'',
		'1. Open this zip file.',
		'2. In your file explorer, type \\\\RECALBOX (Windows)',
		'   or smb://recalbox (macOS), then open the "share" folder.',
		'3. Drag the "system" and "userscripts" folders into "share".',
		'   If Windows offers to merge, accept: nothing will be overwritten.',
		'4. Restart the Recalbox.',
		'',
		'If you already installed the agent the old way (a hand-added',
		'"custom.sh" file), remove it before dragging in this zip: otherwise',
		'both installs each start an agent, and your play sessions get',
		'recorded twice.',
		'',
		'The agent starts on its own and your box will show up in the dashboard.',
		"This file contains a key unique to your box: don't share it.",
	].join('\n')
}
