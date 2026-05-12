# Recalbox Dashboard

Self-hostable dashboard for your Recalbox retrogaming console. Runs on a machine on the
same local network as the Recalbox (Pi 5), **not** on the Recalbox itself.

## Monorepo structure

```
recalbox-dashboard/
├── apps/
│   └── dashboard/       # @recalbox/dashboard — Next.js 16 web app
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

- **Next.js 16** — App Router, Turbopack
- **Drizzle ORM + better-sqlite3** — local SQLite persistence
- **Tailwind CSS v4 + shadcn/ui** — UI
- **Biome** — linting & formatting (replaces ESLint + Prettier)

## License

MIT
