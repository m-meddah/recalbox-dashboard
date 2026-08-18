import { buildInstallerZip } from '@/lib/agent/installer-zip'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const input = {
	agentPy: '# agent',
	scanRomsPy: '# scan',
	launchPy: '# launch',
	launcherSh: '#!/bin/bash\n',
	readme: 'Bonjour',
	config: { recalbox_id: 'rb-1', token: 'secret-token', cloud_url: 'https://x/api/agent/ingest' },
}

describe('buildInstallerZip', () => {
	it('reproduit exactement l arborescence du partage Recalbox', () => {
		const files = unzipSync(buildInstallerZip(input))
		expect(Object.keys(files).sort()).toEqual([
			'LISEZMOI.txt',
			'system/sr-agent/agent.py',
			'system/sr-agent/config.json',
			'system/sr-agent/launch.py',
			'system/sr-agent/scan_roms.py',
			'userscripts/sr-agent[systembrowsing].sh',
		])
	})

	it('embarque le token et l URL dans un config.json valide', () => {
		const files = unzipSync(buildInstallerZip(input))
		const config = JSON.parse(strFromU8(files['system/sr-agent/config.json']))
		expect(config.token).toBe('secret-token')
		expect(config.recalbox_id).toBe('rb-1')
		expect(config.cloud_url).toBe('https://x/api/agent/ingest')
	})

	it('n invente pas de custom.sh', () => {
		// Le choix de userscripts/ n'a d'intérêt que si l'on ne touche jamais au
		// fichier unique et partagé qu'est custom.sh.
		const files = unzipSync(buildInstallerZip(input))
		expect(Object.keys(files).some((p) => p.includes('custom.sh'))).toBe(false)
	})

	it('recopie le contenu des fichiers Python sans le modifier', () => {
		const files = unzipSync(buildInstallerZip(input))
		expect(strFromU8(files['system/sr-agent/agent.py'])).toBe('# agent')
	})
})
