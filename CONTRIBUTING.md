# Contributing

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9
- Docker (optional, for container testing)

## Setup

```bash
git clone https://github.com/m-meddah/recalbox-dashboard
cd recalbox-dashboard
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Edit .env.local with your Recalbox IP
pnpm dev
```

## Project structure

```text
apps/dashboard/        # Next.js app (UI + API routes)
packages/scraper-core/ # Shared scraping lib (stub)
docker/                # Container support (s6 services, migrations)
```

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Next.js dev server (port 3000) |
| `pnpm dev:all` | Next.js + scrobbler together (recommended) |
| `pnpm dev:all:mobile` | Same, accessible from phones on the local network |
| `pnpm scrobbler:dev` | Scrobbler daemon with file watching |
| `pnpm test` | Run Vitest tests |
| `pnpm lint` | Biome lint check |
| `pnpm format` | Biome format (write) |
| `pnpm seed:dev` | Generate 200 fake sessions over 90 days |

## Database migrations

After modifying `apps/dashboard/lib/db/schema.ts`:

```bash
pnpm --filter @recalbox/dashboard drizzle-kit generate
pnpm --filter @recalbox/dashboard drizzle-kit migrate
```

## Testing the Docker build

```bash
docker build -t recalbox-dashboard:dev .
docker run --rm -p 3000:3000 \
  -e RECALBOX_HOST=recalbox.local \
  -e RECALBOX_SSH_USER=root \
  -e RECALBOX_SSH_PASSWORD=recalboxroot \
  recalbox-dashboard:dev
```

## Code style

Biome enforces: tabs, single quotes, no semicolons, trailing commas. Run `pnpm lint` before pushing.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(area): description`, `fix(area): description`, `docs(area): description`
