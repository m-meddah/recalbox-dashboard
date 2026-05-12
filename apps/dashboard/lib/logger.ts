type Level = 'info' | 'warn' | 'error'

function log(level: Level, message: string, meta?: unknown): void {
	const ts = new Date().toISOString()
	const prefix = `[${level.toUpperCase()}] [${ts}]`
	if (meta !== undefined) {
		console[level](`${prefix} ${message}`, meta)
	} else {
		console[level](`${prefix} ${message}`)
	}
}

export const logger = {
	info: (msg: string, meta?: unknown) => log('info', msg, meta),
	warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
	error: (msg: string, meta?: unknown) => log('error', msg, meta),
}
