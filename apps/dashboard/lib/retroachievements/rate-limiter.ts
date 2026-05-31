import PQueue from 'p-queue'

const raQueue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 })

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
	return raQueue.add(fn) as Promise<T>
}
