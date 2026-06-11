import { fileURLToPath } from 'node:url'

// The scrobbler runs under tsx, which — unlike Next.js — does NOT auto-load .env.local.
// Without this, the daemon starts with no BETTER_AUTH_SECRET/CREDENTIALS_SECRET and cannot
// decrypt the SSH/IGDB credentials encrypted at rest (Phase 4). Import this FIRST in the
// entrypoint so the key is in process.env before lib/crypto and lib/db are evaluated.
//
// In the production Docker image the env comes from the container (no .env.local on disk),
// so a missing file is expected and harmless.
try {
	process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)))
} catch {}
