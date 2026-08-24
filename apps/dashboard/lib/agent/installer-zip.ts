import { strToU8, zipSync } from 'fflate'

export type InstallerInput = {
	agentPy: string
	scanRomsPy: string
	launchPy: string
	launcherSh: string
	readme: string
	config: { recalbox_id: string; token: string; cloud_url: string }
}

/** Dossier de l'agent sur la box, relatif à la racine du partage. */
const AGENT_DIR = 'system/sr-agent'
/** Nom du lanceur : la partie entre crochets est l'évènement ES qui le déclenche. */
const LAUNCHER = 'userscripts/sr-agent[systembrowsing].sh'

/**
 * Assemble le zip d'installation.
 *
 * L'arborescence du zip reproduit celle du partage Recalbox pour que le geste de
 * l'utilisateur soit UNIQUE : il sélectionne `system` et `userscripts` et les dépose
 * à la racine de \\RECALBOX\share. Windows fusionne les dossiers de même nom et ne
 * remplace que les fichiers de même nom — or aucun des nôtres n'entre en collision.
 * Toute modification de ces chemins doit préserver cette propriété.
 */
export function buildInstallerZip(input: InstallerInput): Uint8Array {
	// Normalize CRLF to LF in launcher script: bash on the box fails silently with CR characters.
	const normalizedLauncherSh = input.launcherSh.replace(/\r\n/g, '\n')

	return zipSync(
		{
			[`${AGENT_DIR}/agent.py`]: strToU8(input.agentPy),
			[`${AGENT_DIR}/scan_roms.py`]: strToU8(input.scanRomsPy),
			[`${AGENT_DIR}/launch.py`]: strToU8(input.launchPy),
			[`${AGENT_DIR}/config.json`]: strToU8(`${JSON.stringify(input.config, null, 2)}\n`),
			[LAUNCHER]: strToU8(normalizedLauncherSh),
			'LISEZMOI.txt': strToU8(input.readme),
		},
		{ level: 6 },
	)
}
