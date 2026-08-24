import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		// `next-intl`'s client navigation helpers (`createNavigation` → `Link`,
		// `useRouter`, …) import bare `next/navigation` from inside their own
		// package. `next`'s package.json has no `exports` map, so Node's native
		// ESM resolver — which Vitest defers to for externalized deps — refuses
		// the extensionless subpath ("Did you mean to import next/navigation.js?"),
		// even though Next's own bundler resolves it fine. Reproduced with plain
		// `node -e "import('next-intl/navigation')"`, so it's not Vitest-specific.
		// Forcing next-intl through Vite's own transform (which *does* resolve
		// extensionless subpaths, same as first-party source) sidesteps it.
		server: {
			deps: {
				inline: [/next-intl/],
			},
		},
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
