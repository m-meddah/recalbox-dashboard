import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
	},
	resolve: {
		alias: {
			'@': resolve(__dirname, '.'),
		},
	},
	// tsconfig.json sets `jsx: "preserve"` for Next.js's own SWC compiler, but
	// Vitest transforms via esbuild directly and picks that setting up too —
	// unsupported by esbuild, so it falls back to the classic pragma and every
	// .tsx file needs `React` in scope. Force the automatic runtime (React 19,
	// no import needed) so component tests compile the same way the app does.
	// Only touches files with JSX; the 155 existing .ts tests are unaffected.
	esbuild: {
		jsx: 'automatic',
	},
})
