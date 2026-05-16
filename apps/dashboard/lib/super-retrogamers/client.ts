export type SrGame = {
	slug: string
	name: string
	consoleSlug: string
	score: number | null
	summary: string | null
	specs: Record<string, string>
	characters: string[]
	url: string
}

export type SrSystem = {
	slug: string
	name: string
}

export type BulkLookupResult = Record<string, { exists: boolean; url?: string }>

export class SuperRetrogamersClient {
	async checkExists(_slug: string): Promise<{ exists: boolean; url?: string }> {
		return { exists: false }
	}

	async getGame(_slug: string): Promise<SrGame | null> {
		return null
	}

	async bulkLookup(_slugs: string[]): Promise<BulkLookupResult> {
		return {}
	}

	async listSystems(): Promise<SrSystem[]> {
		return []
	}
}

export const srClient = new SuperRetrogamersClient()
