import { type SessionStats, getSessionStats } from '@/lib/db/queries'
import { listRecalboxes } from '@/lib/db/recalbox-queries'
import { listUsers } from '@/lib/db/user-queries'

export type AdminMachine = {
	id: string
	name: string
	iconEmoji: string | null
	archived: boolean
}

export type AdminUserOverview = {
	user: { id: string; email: string; role: string }
	machines: AdminMachine[]
	stats: SessionStats
}

export type AdminOverview = {
	users: AdminUserOverview[]
	unassigned: { machines: AdminMachine[]; stats: SessionStats } | null
}

export type AdminOverviewDeps = {
	listUsers: typeof listUsers
	listRecalboxes: typeof listRecalboxes
	getStats: (recalboxIds: string[]) => Promise<SessionStats>
}

const defaultDeps: AdminOverviewDeps = {
	listUsers,
	listRecalboxes,
	getStats: (recalboxIds) => getSessionStats({ recalboxIds }),
}

function toMachine(r: {
	id: string
	name: string
	iconEmoji: string | null
	archived: boolean | null
}): AdminMachine {
	return { id: r.id, name: r.name, iconEmoji: r.iconEmoji, archived: r.archived ?? false }
}

/** Per-user aggregated playtime + machines for the admin read-only view. Admin-gated by the caller. */
export async function getAdminOverview(
	deps: AdminOverviewDeps = defaultDeps,
): Promise<AdminOverview> {
	const users = deps.listUsers()
	const all = deps.listRecalboxes()

	const byOwner = new Map<string, AdminMachine[]>()
	const unownedMachines: AdminMachine[] = []
	for (const r of all) {
		const machine = toMachine(r)
		if (r.ownerUserId == null) {
			unownedMachines.push(machine)
		} else {
			const list = byOwner.get(r.ownerUserId) ?? []
			list.push(machine)
			byOwner.set(r.ownerUserId, list)
		}
	}

	const userOverviews = await Promise.all(
		users.map(async (u) => {
			const machines = byOwner.get(u.id) ?? []
			// getStats([]) is contracted to return zeroed stats (see session-stats-recalbox-ids.test.ts).
			const stats = await deps.getStats(machines.map((m) => m.id))
			return { user: u, machines, stats }
		}),
	)

	const unassigned =
		unownedMachines.length > 0
			? { machines: unownedMachines, stats: await deps.getStats(unownedMachines.map((m) => m.id)) }
			: null

	return { users: userOverviews, unassigned }
}
