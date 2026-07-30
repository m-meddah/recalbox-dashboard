import { configStore } from '@/lib/config-store'
import { getSshClient } from '@/lib/recalbox/ssh-client'
async function main() {
	const rb = configStore.getRecalboxes?.() ?? []
	const id = process.argv[2]
	const cfg = configStore.getForRecalbox(id).recalbox
	console.log('host:', cfg.host, '| user:', cfg.sshUser, '| password présent:', !!cfg.sshPassword, '| longueur:', cfg.sshPassword?.length)
	try {
		const out = await getSshClient(id, 'probe').exec('echo ok', 8000)
		console.log('exec ssh ->', JSON.stringify(out))
	} catch (e) {
		console.log('exec ssh ECHEC ->', String(e))
	}
	process.exit(0)
}
main()
