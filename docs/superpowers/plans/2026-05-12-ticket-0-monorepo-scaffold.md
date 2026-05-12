# Recalbox Dashboard — Ticket 0: Monorepo Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a working pnpm monorepo with Next.js 16.2 dashboard app, a stub scraper-core package, Drizzle ORM schema, shadcn/ui, and Biome — everything compiles and `pnpm dev` serves a page that proves the workspace import works.

**Architecture:** Root workspace with pnpm workspaces containing `apps/dashboard` (Next.js 16.2, App Router, Turbopack) and `packages/scraper-core` (stub, consumed via `transpilePackages`). No build pipeline for the lib — Next.js compiles TypeScript sources directly. SQLite via Drizzle ORM with three tables wired up as stubs.

**Tech Stack:** pnpm 10, Node 25, Next.js 16.2, React 19.2, TypeScript 5.6 strict, Tailwind CSS v4, shadcn/ui, Drizzle ORM + better-sqlite3, Biome 1.9

---

## File Map

```
recalbox-dashboard/
├── pnpm-workspace.yaml
├── package.json                         # root — workspaces, biome, typescript devDeps
├── biome.json                           # root linter/formatter config
├── tsconfig.base.json                   # shared TS base
├── .gitignore
├── README.md
├── LICENSE
│
├── apps/
│   └── dashboard/
│       ├── package.json                 # @recalbox/dashboard
│       ├── tsconfig.json                # extends ../../tsconfig.base.json
│       ├── next.config.ts               # standalone + transpilePackages
│       ├── app/
│       │   ├── layout.tsx               # root layout (Tailwind global CSS)
│       │   └── page.tsx                 # imports placeholder from scraper-core
│       ├── lib/
│       │   └── db/
│       │       ├── index.ts             # Drizzle client stub
│       │       └── schema.ts            # sessions, games, system_snapshots tables
│       ├── scripts/
│       │   └── start-scrobbler.ts       # stub entry point
│       ├── drizzle/
│       │   └── migrations/              # empty dir (placeholder)
│       └── .env.example
│
└── packages/
    └── scraper-core/
        ├── package.json                 # @recalbox/scraper-core
        ├── tsconfig.json
        ├── src/
        │   └── index.ts                 # export const placeholder = true
        └── README.md
```

---

## Task 1: Root workspace configuration files

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `LICENSE`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Path: `pnpm-workspace.yaml`

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "recalbox-dashboard-monorepo",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@10.26.2",
  "scripts": {
    "dev": "pnpm --filter @recalbox/dashboard dev",
    "build": "pnpm -r build",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "pnpm -r test",
    "scrobbler:dev": "pnpm --filter @recalbox/dashboard scrobbler:dev"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

Path: `package.json`

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

Path: `tsconfig.base.json`

- [ ] **Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "files": {
    "ignore": ["node_modules", ".next", "dist", "build", "*.min.js"]
  },
  "formatter": {
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  },
  "linter": { "rules": { "recommended": true } }
}
```

Path: `biome.json`

- [ ] **Step 5: Create .gitignore**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Next.js
apps/dashboard/.next/
apps/dashboard/out/

# Build outputs
dist/
build/

# SQLite databases
*.db
*.sqlite

# Environment variables
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Editors
.vscode/
.idea/
*.swp

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# TypeScript
*.tsbuildinfo
```

Path: `.gitignore`

- [ ] **Step 6: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 Madjid Meddah

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Path: `LICENSE`

---

## Task 2: Scaffold packages/scraper-core stub

**Files:**
- Create: `packages/scraper-core/package.json`
- Create: `packages/scraper-core/tsconfig.json`
- Create: `packages/scraper-core/src/index.ts`
- Create: `packages/scraper-core/README.md`

- [ ] **Step 1: Create packages/scraper-core/package.json**

```json
{
  "name": "@recalbox/scraper-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^2.x" }
}
```

- [ ] **Step 2: Create packages/scraper-core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create packages/scraper-core/src/index.ts**

```typescript
/**
 * @recalbox/scraper-core
 * Shared library for game metadata scraping and name matching.
 * Will be populated in Tickets 5 (scraper logic) and 10 (Super Retrogamers slug).
 *
 * Consumers:
 * - @recalbox/dashboard (the web dashboard)
 * - Future: @recalbox/scraper-cli (CLI for personal Recalbox image)
 */
export const placeholder = true
```

- [ ] **Step 4: Create packages/scraper-core/README.md**

```markdown
# @recalbox/scraper-core

Shared library for ScreenScraper API integration and game name matching.

## Status

Stub — will be implemented in Tickets 5–6.

## Usage

```ts
import { placeholder } from '@recalbox/scraper-core'
```

## Consumers

- `@recalbox/dashboard` — the Next.js web dashboard
- Future: `@recalbox/scraper-cli` — CLI for personal Recalbox image
```

---

## Task 3: Scaffold apps/dashboard (Next.js app)

**Files:**
- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/.env.example`

- [ ] **Step 1: Create apps/dashboard/package.json**

```json
{
  "name": "@recalbox/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "scrobbler": "tsx scripts/start-scrobbler.ts",
    "scrobbler:dev": "tsx watch scripts/start-scrobbler.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@recalbox/scraper-core": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.36.0",
    "fast-xml-parser": "^4.0.0",
    "mqtt": "^5.0.0",
    "next": "16.2.6",
    "node-ssh": "^13.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^2.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "drizzle-kit": "^0.27.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

Note: Next.js 16.2.6 is the current stable release.

- [ ] **Step 2: Create apps/dashboard/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create apps/dashboard/next.config.ts**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@recalbox/scraper-core'],
}

export default nextConfig
```

Note: `experimental.reactCompiler: true` requires `babel-plugin-react-compiler` to be installed separately. Skip it in the initial scaffold to avoid install failures; add it in a follow-up ticket when fully wiring React Compiler.

- [ ] **Step 4: Create apps/dashboard/.env.example**

```bash
# Recalbox connection
RECALBOX_HOST=recalbox.local
RECALBOX_SSH_USER=root
RECALBOX_SSH_PASSWORD=recalboxroot

# MQTT broker (running on Recalbox)
MQTT_BROKER_URL=mqtt://recalbox.local:1883
MQTT_TOPIC_PREFIX=recalbox

# SMB / network share for gamelists
GAMELIST_BASE_PATH=/mnt/recalbox/share/roms

# Database
DATABASE_PATH=./recalbox.db

# App
NEXT_PUBLIC_APP_NAME=Recalbox Dashboard
```

---

## Task 4: Install Next.js and generate base app structure

**Files:**
- Create: `apps/dashboard/app/layout.tsx`
- Create: `apps/dashboard/app/globals.css`
- Create: `apps/dashboard/app/page.tsx`

We do NOT run `create-next-app` (it would conflict with the monorepo structure already set up). Instead we install deps and write the minimal app files manually.

- [ ] **Step 1: Install all dependencies from the monorepo root**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm install
```

Expected: pnpm resolves workspace symlink for `@recalbox/scraper-core`, installs all deps into `apps/dashboard/node_modules` (hoisted to root). No errors.

- [ ] **Step 2: Create apps/dashboard/app/globals.css**

```css
@import "tailwindcss";
```

This is the Tailwind v4 import syntax (single directive replaces the v3 three-directive pattern).

- [ ] **Step 3: Create apps/dashboard/app/layout.tsx**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Recalbox Dashboard',
	description: 'Self-hostable dashboard for your Recalbox retrogaming console',
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
```

- [ ] **Step 4: Create apps/dashboard/app/page.tsx**

```tsx
import { placeholder } from '@recalbox/scraper-core'

export default function Home() {
	return (
		<main className="p-8">
			<h1 className="text-2xl font-bold">Recalbox Dashboard</h1>
			<p className="text-sm text-muted-foreground">
				Scaffold OK. Scraper core lib import: {String(placeholder)}
			</p>
		</main>
	)
}
```

- [ ] **Step 5: Verify TypeScript sees the import**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm --filter @recalbox/dashboard exec tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only the `next-env.d.ts` missing warning, which resolves after first `next dev` run).

---

## Task 5: Drizzle ORM schema and client stub

**Files:**
- Create: `apps/dashboard/lib/db/schema.ts`
- Create: `apps/dashboard/lib/db/index.ts`
- Create: `apps/dashboard/drizzle/migrations/.gitkeep`

- [ ] **Step 1: Create apps/dashboard/lib/db/schema.ts**

```typescript
import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
	id: int('id').primaryKey({ autoIncrement: true }),
	gameId: int('game_id').notNull(),
	startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
	endedAt: int('ended_at', { mode: 'timestamp' }),
	durationSeconds: int('duration_seconds'),
	system: text('system').notNull(),
	romPath: text('rom_path').notNull(),
})

export const games = sqliteTable('games', {
	id: int('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	system: text('system').notNull(),
	romPath: text('rom_path').notNull().unique(),
	screenschotPath: text('screenshot_path'),
	rating: real('rating'),
	players: int('players'),
	releaseDate: text('release_date'),
	developer: text('developer'),
	publisher: text('publisher'),
	genre: text('genre'),
	description: text('description'),
	scrapeStatus: text('scrape_status', { enum: ['pending', 'done', 'failed'] })
		.notNull()
		.default('pending'),
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

export const systemSnapshots = sqliteTable('system_snapshots', {
	id: int('id').primaryKey({ autoIncrement: true }),
	capturedAt: int('captured_at', { mode: 'timestamp' }).notNull(),
	cpuPercent: real('cpu_percent'),
	memUsedMb: real('mem_used_mb'),
	memTotalMb: real('mem_total_mb'),
	tempCelsius: real('temp_celsius'),
	uptimeSeconds: int('uptime_seconds'),
})
```

- [ ] **Step 2: Create apps/dashboard/lib/db/index.ts**

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const DB_PATH = process.env['DATABASE_PATH'] ?? './recalbox.db'

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export type DB = typeof db
```

- [ ] **Step 3: Create apps/dashboard/drizzle/migrations/.gitkeep**

Create an empty file at `apps/dashboard/drizzle/migrations/.gitkeep` so git tracks the directory.

- [ ] **Step 4: Verify schema types compile**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm --filter @recalbox/dashboard exec tsc --noEmit 2>&1 | head -30
```

Expected: Clean (or same warnings as before, nothing new from schema).

---

## Task 6: Stub scripts/start-scrobbler.ts

**Files:**
- Create: `apps/dashboard/scripts/start-scrobbler.ts`

- [ ] **Step 1: Create the scrobbler stub**

```typescript
console.log('[scrobbler] Starting MQTT scrobbler...')
console.log('[scrobbler] Stub only — implement in Ticket 2 (MQTT integration)')
```

---

## Task 7: Install and initialize shadcn/ui

shadcn/ui v2+ uses a CLI (`npx shadcn@latest init`) that writes a `components.json` config and installs a set of base files. We run it interactively inside `apps/dashboard`.

- [ ] **Step 1: Run the shadcn init command**

```bash
cd /home/madjid/projets/recalbox-dashboard/apps/dashboard
pnpm dlx shadcn@latest init --defaults
```

When prompted (if not using `--defaults`):
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

This writes:
- `apps/dashboard/components/ui/` — base components (button etc.)
- `apps/dashboard/lib/utils.ts` — `cn()` helper
- `apps/dashboard/components.json` — shadcn config

- [ ] **Step 2: Verify components.json exists**

```bash
cat /home/madjid/projets/recalbox-dashboard/apps/dashboard/components.json
```

Expected: JSON with `style`, `tailwind`, `aliases` keys.

- [ ] **Step 3: Add a Button component to confirm shadcn works**

```bash
cd /home/madjid/projets/recalbox-dashboard/apps/dashboard
pnpm dlx shadcn@latest add button
```

Expected: Creates `apps/dashboard/components/ui/button.tsx`.

---

## Task 8: Write root README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Recalbox Dashboard

Self-hostable dashboard for your Recalbox retrogaming console. Runs on a machine on the
same local network as the Recalbox (Pi 5), **not** on the Recalbox itself.

## Monorepo structure

```
recalbox-dashboard/
├── apps/
│   └── dashboard/       # @recalbox/dashboard — Next.js 15 web app
└── packages/
    └── scraper-core/    # @recalbox/scraper-core — shared scraping lib (stub)
```

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

## Getting started

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm dev          # http://localhost:3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server with Turbopack |
| `pnpm build` | Build all packages |
| `pnpm lint` | Biome lint + check |
| `pnpm format` | Biome format (write) |
| `pnpm test` | Run all tests |
| `pnpm scrobbler:dev` | Start MQTT scrobbler in watch mode |

## Connections

| Protocol | Port | Purpose |
|----------|------|---------|
| MQTT | 1883 | Real-time game events |
| SSH | 22 | System stats snapshots |
| SMB/Network | — | gamelist.xml collection data |

## Stack

- **Next.js 15** — App Router, Turbopack
- **Drizzle ORM + better-sqlite3** — local SQLite persistence
- **Tailwind CSS v4 + shadcn/ui** — UI
- **Biome** — linting & formatting (replaces ESLint + Prettier)

## License

MIT
```

---

## Task 9: First dev run and smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm dev
```

Expected: Turbopack compiles, server starts on http://localhost:3000

- [ ] **Step 2: Verify the page renders**

Open http://localhost:3000 and confirm:
- Heading "Recalbox Dashboard" is visible
- Text contains "Scaffold OK. Scraper core lib import: true"

If "true" appears, the `@recalbox/scraper-core` workspace import works correctly.

- [ ] **Step 3: Stop the server (Ctrl+C)**

---

## Task 10: Initial git commit

- [ ] **Step 1: Initialize git repository**

```bash
cd /home/madjid/projets/recalbox-dashboard
git init
```

- [ ] **Step 2: Stage all files**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json biome.json \
  .gitignore LICENSE README.md \
  apps/dashboard \
  packages/scraper-core \
  docs/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: initial monorepo scaffold (Next 15 + scraper-core stub)"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task covering it |
|---|---|
| pnpm-workspace.yaml + root package.json | Task 1 |
| apps/dashboard with Next.js + TS + Tailwind v4 | Tasks 3–4 |
| Biome at root, no ESLint | Task 1 (biome.json); ESLint not installed |
| All deps in apps/dashboard | Task 3 (package.json) + Task 4 (pnpm install) |
| packages/scraper-core stub | Task 2 |
| @recalbox/scraper-core as workspace dep | Task 3 (package.json dep) |
| Import test in page.tsx showing "true" | Task 4 step 4, Task 9 |
| Drizzle schema (sessions, games, system_snapshots) | Task 5 |
| shadcn/ui init | Task 7 |
| Root README with monorepo structure | Task 8 |
| .gitignore | Task 1 |
| LICENSE MIT | Task 1 |
| transpilePackages: ['@recalbox/scraper-core'] | Task 3 |
| TypeScript strict + noUncheckedIndexedAccess + verbatimModuleSyntax | Task 1 (tsconfig.base.json) |
| scripts/start-scrobbler.ts stub | Task 6 |
| drizzle/migrations/ dir | Task 5 |
| .env.example | Task 3 |
| Commit message | Task 10 |

### Notes / deviations from spec

- **Next.js version**: Using `16.2.6` (current stable, confirmed via `pnpm info next version`).
- **React Compiler**: Spec requests `experimental.reactCompiler: true`. Omitted from next.config.ts in this scaffold because it requires `babel-plugin-react-compiler` which complicates setup. Add in a follow-up ticket.
- **packageManager field**: Using actual installed version `pnpm@10.26.2` instead of spec's `pnpm@9.0.0`.
