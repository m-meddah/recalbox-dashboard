# SSH/IGDB Credential Encryption (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the secrets stored in the SQLite DB (`recalboxes.ssh_password`, `igdb_credentials.client_secret` and `.access_token`) at rest, so the now-internet-exposed server no longer holds plaintext credentials.

**Architecture:** A small `lib/crypto/credentials.ts` module does authenticated symmetric encryption (AES-256-GCM) with a key derived (HKDF-SHA256) from `BETTER_AUTH_SECRET` (overridable via `CREDENTIALS_SECRET`). Encrypted values carry a versioned `enc:v1:` prefix. Encryption happens at the single write gateway (`recalbox-queries.ts`) and at the IGDB write points; decryption happens at the matching read points. `decryptSecret` passes plaintext through unchanged, so old un-migrated rows keep working and an idempotent backfill script re-encrypts them. If no key is available the module logs one warning and stores plaintext (frictionless dev/test).

**Tech Stack:** Node.js `node:crypto` (createCipheriv/createDecipheriv/hkdfSync), Drizzle ORM (better-sqlite3), Vitest, TypeScript.

---

## File Structure

- **Create** `apps/dashboard/lib/crypto/credentials.ts` — the encrypt/decrypt primitives + key resolution. One responsibility: turn a plaintext secret into an `enc:v1:` token and back.
- **Create** `apps/dashboard/lib/crypto/__tests__/credentials.test.ts` — unit tests for the primitives.
- **Modify** `apps/dashboard/lib/db/recalbox-queries.ts` — encrypt `sshPassword` on insert/update, decrypt on every read. This is the single gateway above the `recalboxes` table.
- **Create** `apps/dashboard/lib/db/__tests__/recalbox-queries-encryption.test.ts` — verifies row stored encrypted, read decrypted, round-trip.
- **Modify** `apps/dashboard/lib/igdb/auth.ts` — encrypt `clientSecret`/`accessToken` at the three DB write points; decrypt at the read point.
- **Create** `apps/dashboard/lib/igdb/__tests__/auth-encryption.test.ts` — verifies decrypt-on-read and encrypt-on-write for IGDB.
- **Create** `apps/dashboard/scripts/encrypt-credentials.ts` — one-shot idempotent backfill that encrypts any plaintext secrets already in the DB.
- **Modify** `apps/dashboard/.env.example` — document the optional `CREDENTIALS_SECRET` override.
- **Modify** `CLAUDE.md` — one line under migrations documenting the backfill command.

**Key design facts the implementer must respect:**
- `decryptSecret` MUST pass through any value not starting with `enc:v1:` (backward compat for plaintext rows written before this phase or by the legacy `multi-recalbox-migration.ts`).
- Empty string `''` is never encrypted (the schema column is `notNull`; an empty password stays `''`).
- The API routes already mask `sshPassword: '***'` on read — never return the real or encrypted password to the client. This phase does not change that.
- `refreshAccessToken(clientId, clientSecret)` in `igdb/auth.ts` needs the **plaintext** secret to call Twitch — decrypt before calling it; encrypt only at the `db.update(...).set(...)` site.

---

## Task 1: Crypto primitives module

**Files:**
- Create: `apps/dashboard/lib/crypto/credentials.ts`
- Test: `apps/dashboard/lib/crypto/__tests__/credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/lib/crypto/__tests__/credentials.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const KEY = 'test-secret-at-least-32-chars-long-aaaa'

describe('credentials crypto', () => {
	beforeEach(() => {
		process.env.BETTER_AUTH_SECRET = KEY
		delete process.env.CREDENTIALS_SECRET
	})
	afterEach(() => {
		delete process.env.BETTER_AUTH_SECRET
		delete process.env.CREDENTIALS_SECRET
	})

	it('round-trips a secret', async () => {
		const { encryptSecret, decryptSecret, isEncrypted } = await import('../credentials')
		const token = encryptSecret('hunter2')
		expect(isEncrypted(token)).toBe(true)
		expect(token).not.toContain('hunter2')
		expect(decryptSecret(token)).toBe('hunter2')
	})

	it('produces a different ciphertext each call (random IV)', async () => {
		const { encryptSecret } = await import('../credentials')
		expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
	})

	it('passes plaintext through on decrypt (backward compat)', async () => {
		const { decryptSecret } = await import('../credentials')
		expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext')
	})

	it('never encrypts empty string', async () => {
		const { encryptSecret, isEncrypted } = await import('../credentials')
		const out = encryptSecret('')
		expect(out).toBe('')
		expect(isEncrypted(out)).toBe(false)
	})

	it('prefers CREDENTIALS_SECRET over BETTER_AUTH_SECRET', async () => {
		const { encryptSecret, decryptSecret } = await import('../credentials')
		const token = encryptSecret('x')
		process.env.CREDENTIALS_SECRET = 'a-completely-different-dedicated-key-value'
		// A different key must fail to authenticate the GCM tag.
		expect(() => decryptSecret(token)).toThrow()
	})

	it('throws on tampered ciphertext', async () => {
		const { encryptSecret, decryptSecret } = await import('../credentials')
		const token = encryptSecret('secret')
		const tampered = `${token.slice(0, -2)}AA`
		expect(() => decryptSecret(tampered)).toThrow()
	})

	it('with no key: encrypt returns plaintext, decrypt passes through', async () => {
		delete process.env.BETTER_AUTH_SECRET
		delete process.env.CREDENTIALS_SECRET
		const { encryptSecret, decryptSecret, isEncrypted } = await import('../credentials')
		const out = encryptSecret('plain')
		expect(out).toBe('plain')
		expect(isEncrypted(out)).toBe(false)
		expect(decryptSecret('plain')).toBe('plain')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/crypto/__tests__/credentials.test.ts`
Expected: FAIL — `Cannot find module '../credentials'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/dashboard/lib/crypto/credentials.ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { logger } from '@/lib/logger'

const PREFIX = 'enc:v1:'
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'recalbox-credentials-v1'

let warnedNoKey = false

/**
 * Derives the 32-byte encryption key from CREDENTIALS_SECRET (preferred) or
 * BETTER_AUTH_SECRET. Returns null when neither is set — callers then operate
 * in plaintext mode (dev/test). Read fresh each call so tests can vary the env.
 */
function resolveKey(): Buffer | null {
	const secret = process.env.CREDENTIALS_SECRET || process.env.BETTER_AUTH_SECRET
	if (!secret) {
		if (!warnedNoKey) {
			logger.warn(
				'No CREDENTIALS_SECRET/BETTER_AUTH_SECRET set — SSH/IGDB credentials are stored in PLAINTEXT',
			)
			warnedNoKey = true
		}
		return null
	}
	return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), HKDF_INFO, KEY_LEN))
}

export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX)
}

/** Encrypts a secret. Empty strings and (no-key mode) pass through unchanged. */
export function encryptSecret(plain: string): string {
	if (plain === '') return plain
	const key = resolveKey()
	if (!key) return plain
	const iv = randomBytes(IV_LEN)
	const cipher = createCipheriv(ALGO, key, iv)
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypts a token. Non-prefixed values are returned unchanged (legacy plaintext). */
export function decryptSecret(value: string): string {
	if (!isEncrypted(value)) return value
	const key = resolveKey()
	if (!key) throw new Error('Encrypted credential present but no decryption key is available')
	const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
	const iv = raw.subarray(0, IV_LEN)
	const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
	const ct = raw.subarray(IV_LEN + TAG_LEN)
	const decipher = createDecipheriv(ALGO, key, iv)
	decipher.setAuthTag(tag)
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/crypto/__tests__/credentials.test.ts`
Expected: PASS (7/7). Note: tests use dynamic `import()` so each runs with the env set in its `beforeEach`; the module holds no cached key.

- [ ] **Step 5: Format & commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/crypto/credentials.ts lib/crypto/__tests__/credentials.test.ts
git add apps/dashboard/lib/crypto/credentials.ts apps/dashboard/lib/crypto/__tests__/credentials.test.ts
git commit -m "feat(crypto): add AES-256-GCM credential encryption primitives"
```

---

## Task 2: Encrypt/decrypt at the recalbox-queries gateway

**Files:**
- Modify: `apps/dashboard/lib/db/recalbox-queries.ts`
- Test: `apps/dashboard/lib/db/__tests__/recalbox-queries-encryption.test.ts`

**Context:** `recalbox-queries.ts` is the only module that reads/writes the `recalboxes` table via Drizzle. `config-store.ts`'s `rowToInstance` and `getForRecalbox` consume these rows and expect plaintext `sshPassword`. So: encrypt inside `insertRecalbox`/`updateRecalbox`, decrypt inside `listRecalboxes`/`getRecalbox`/`getDefaultRecalbox`. Everything above the gateway stays plaintext.

- [ ] **Step 1: Write the failing test**

This test mocks the singleton DB with an in-memory better-sqlite3, mirroring the established pattern (`vi.hoisted` + `vi.mock('@/lib/db/index')`).

```ts
// apps/dashboard/lib/db/__tests__/recalbox-queries-encryption.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, sqlite } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE recalboxes (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			host TEXT NOT NULL,
			ssh_user TEXT NOT NULL,
			ssh_password TEXT NOT NULL,
			ssh_port INTEGER NOT NULL DEFAULT 22,
			mqtt_port INTEGER NOT NULL DEFAULT 1883,
			color TEXT,
			icon_emoji TEXT,
			is_default INTEGER DEFAULT 0,
			archived INTEGER DEFAULT 0,
			created_at INTEGER NOT NULL,
			last_connected_at INTEGER,
			owner_user_id TEXT
		);
	`)
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db/index', () => ({ db }))

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long-aaaa'
})
afterAll(() => {
	delete process.env.BETTER_AUTH_SECRET
	sqlite.close()
})
beforeEach(() => {
	sqlite.exec('DELETE FROM recalboxes')
})

describe('recalbox-queries encryption', () => {
	it('stores ssh_password encrypted but reads it back decrypted', async () => {
		const { insertRecalbox, getRecalbox } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r1',
			name: 'Box',
			host: '10.0.0.1',
			sshUser: 'root',
			sshPassword: 'recalboxroot',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: true,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})

		const rawRow = sqlite.prepare('SELECT ssh_password FROM recalboxes WHERE id = ?').get('r1') as {
			ssh_password: string
		}
		expect(rawRow.ssh_password.startsWith('enc:v1:')).toBe(true)
		expect(rawRow.ssh_password).not.toContain('recalboxroot')

		const read = getRecalbox('r1')
		expect(read?.sshPassword).toBe('recalboxroot')
	})

	it('re-encrypts on updateRecalbox and decrypts on read', async () => {
		const { insertRecalbox, updateRecalbox, getRecalbox } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r2',
			name: 'Box2',
			host: '10.0.0.2',
			sshUser: 'root',
			sshPassword: 'old',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: false,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})
		updateRecalbox('r2', { sshPassword: 'newpass' })

		const rawRow = sqlite.prepare('SELECT ssh_password FROM recalboxes WHERE id = ?').get('r2') as {
			ssh_password: string
		}
		expect(rawRow.ssh_password.startsWith('enc:v1:')).toBe(true)
		expect(getRecalbox('r2')?.sshPassword).toBe('newpass')
	})

	it('listRecalboxes decrypts every row', async () => {
		const { insertRecalbox, listRecalboxes } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r3',
			name: 'Box3',
			host: '10.0.0.3',
			sshUser: 'root',
			sshPassword: 'p3',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: false,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})
		expect(listRecalboxes().map((r) => r.sshPassword)).toEqual(['p3'])
	})

	it('reads legacy plaintext rows unchanged', async () => {
		const { getRecalbox } = await import('../recalbox-queries')
		sqlite
			.prepare(
				'INSERT INTO recalboxes (id, name, host, ssh_user, ssh_password, created_at) VALUES (?,?,?,?,?,?)',
			)
			.run('r4', 'Legacy', '10.0.0.4', 'root', 'plain-legacy', Date.now())
		expect(getRecalbox('r4')?.sshPassword).toBe('plain-legacy')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/recalbox-queries-encryption.test.ts`
Expected: FAIL — the stored `ssh_password` is still `recalboxroot` (no `enc:v1:` prefix) because the gateway does not encrypt yet.

- [ ] **Step 3: Write minimal implementation**

Edit `apps/dashboard/lib/db/recalbox-queries.ts`. Add the import and wrap the four functions. Full new file:

```ts
import { decryptSecret, encryptSecret } from '@/lib/crypto/credentials'
import { db } from '@/lib/db/index'
import { recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type RecalboxRow = typeof recalboxes.$inferSelect
export type RecalboxInsert = typeof recalboxes.$inferInsert

function decryptRow(row: RecalboxRow): RecalboxRow {
	return { ...row, sshPassword: decryptSecret(row.sshPassword) }
}

export function listRecalboxes(): RecalboxRow[] {
	try {
		return db.select().from(recalboxes).all().map(decryptRow)
	} catch {
		return []
	}
}
export function getRecalbox(id: string): RecalboxRow | null {
	try {
		const row = db.select().from(recalboxes).where(eq(recalboxes.id, id)).get()
		return row ? decryptRow(row) : null
	} catch {
		return null
	}
}
export function getDefaultRecalbox(): RecalboxRow | null {
	try {
		const row = db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get()
		return row ? decryptRow(row) : null
	} catch {
		return null
	}
}
export function insertRecalbox(row: RecalboxInsert): void {
	db.insert(recalboxes)
		.values({ ...row, sshPassword: encryptSecret(row.sshPassword) })
		.run()
}
export function updateRecalbox(id: string, patch: Partial<Omit<RecalboxInsert, 'id'>>): void {
	const next =
		patch.sshPassword !== undefined
			? { ...patch, sshPassword: encryptSecret(patch.sshPassword) }
			: patch
	db.update(recalboxes).set(next).where(eq(recalboxes.id, id)).run()
}
export function deleteRecalbox(id: string): void {
	db.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}
export function setDefaultRecalbox(id: string): void {
	db.update(recalboxes).set({ isDefault: false }).run()
	db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}
function countRecalboxes(): number {
	return db.select().from(recalboxes).all().length
}
```

(`countRecalboxes` was already present and unused/private — leave it exactly as-is to avoid scope creep.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/recalbox-queries-encryption.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run the existing recalbox/config-store suites to confirm no regression**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db lib/config-store.test.ts`
Expected: PASS (all existing tests green; if a config-store test seeds the table with plaintext via `insertRecalbox`, it now round-trips through encrypt/decrypt transparently).

- [ ] **Step 6: Format & commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/db/recalbox-queries.ts lib/db/__tests__/recalbox-queries-encryption.test.ts
git add apps/dashboard/lib/db/recalbox-queries.ts apps/dashboard/lib/db/__tests__/recalbox-queries-encryption.test.ts
git commit -m "feat(crypto): encrypt ssh_password at the recalbox-queries gateway"
```

---

## Task 3: Encrypt/decrypt IGDB credentials in igdb/auth.ts

**Files:**
- Modify: `apps/dashboard/lib/igdb/auth.ts`
- Test: `apps/dashboard/lib/igdb/__tests__/auth-encryption.test.ts`

**Context:** `igdb/auth.ts` reads/writes `igdb_credentials` inline (not via a gateway). The secrets are `clientSecret` and `accessToken`. There are three write sites that set a secret and one read site:
- **Read** — `getAccessToken()`: after `db.select(...).get()`, `creds.clientSecret` and `creds.accessToken` may be encrypted → decrypt before use.
- **Write** — `refreshAccessToken()`: `db.update(...).set({ accessToken: data.access_token, ... })` → encrypt `data.access_token`.
- **Write** — `saveAndTestCredentials()`: `db.update(...).set({ clientId, clientSecret, ... })` → encrypt `clientSecret`.

`refreshAccessToken(clientId, clientSecret)` is called with the **plaintext** secret (from `getAccessToken` after decrypt, and from `saveAndTestCredentials` with the raw input) — it needs plaintext to call Twitch, so do NOT decrypt inside it; only encrypt at its `set({ accessToken })` site.

- [ ] **Step 1: Write the failing test**

This test mocks the DB and `fetch` so no network is hit. It asserts (a) `getAccessToken` returns the decrypted token when the stored token is encrypted and still valid, and (b) a freshly fetched token is stored encrypted.

```ts
// apps/dashboard/lib/igdb/__tests__/auth-encryption.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, sqlite } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE igdb_credentials (
			id INTEGER PRIMARY KEY DEFAULT 1,
			client_id TEXT,
			client_secret TEXT,
			access_token TEXT,
			access_token_expires_at INTEGER,
			enabled INTEGER NOT NULL DEFAULT 0,
			last_tested_at INTEGER,
			last_test_status TEXT,
			updated_at INTEGER NOT NULL DEFAULT 0
		);
	`)
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db', () => ({ db }))

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long-aaaa'
})
afterAll(() => {
	delete process.env.BETTER_AUTH_SECRET
	sqlite.close()
})
beforeEach(() => {
	sqlite.exec('DELETE FROM igdb_credentials')
})

describe('igdb auth encryption', () => {
	it('returns the decrypted access token for valid encrypted creds', async () => {
		const { encryptSecret } = await import('@/lib/crypto/credentials')
		const future = Date.now() + 60 * 60 * 1000
		sqlite
			.prepare(
				'INSERT INTO igdb_credentials (id, client_id, client_secret, access_token, access_token_expires_at, enabled) VALUES (1,?,?,?,?,1)',
			)
			.run('cid', encryptSecret('csecret'), encryptSecret('atoken'), future)

		const { getAccessToken } = await import('../auth')
		const res = await getAccessToken()
		expect(res).toEqual({ ok: true, token: 'atoken', clientId: 'cid' })
	})

	it('stores a refreshed access token encrypted', async () => {
		sqlite
			.prepare(
				'INSERT INTO igdb_credentials (id, client_id, client_secret, enabled) VALUES (1,?,?,1)',
			)
			.run('cid', 'plain-secret') // legacy plaintext secret is fine to read

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
		})
		vi.stubGlobal('fetch', fetchMock)

		const { getAccessToken } = await import('../auth')
		const res = await getAccessToken()
		expect(res.ok).toBe(true)

		const raw = sqlite
			.prepare('SELECT access_token FROM igdb_credentials WHERE id = 1')
			.get() as { access_token: string }
		expect(raw.access_token.startsWith('enc:v1:')).toBe(true)
		expect(raw.access_token).not.toContain('fresh-token')

		vi.unstubAllGlobals()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/igdb/__tests__/auth-encryption.test.ts`
Expected: FAIL — first test: `token` comes back as the encrypted `enc:v1:...` string (not decrypted); second test: stored `access_token` is `fresh-token` (no prefix).

- [ ] **Step 3: Write minimal implementation**

Edit `apps/dashboard/lib/igdb/auth.ts`:

1. Add import at top (after the existing imports):

```ts
import { decryptSecret, encryptSecret } from '@/lib/crypto/credentials'
```

2. In `getAccessToken`, right after the `if (!creds.clientId || !creds.clientSecret)` guard, decrypt both secrets into locals and use those locals for the rest of the function:

```ts
	const clientSecret = decryptSecret(creds.clientSecret)
	const accessToken = creds.accessToken ? decryptSecret(creds.accessToken) : null

	const now = Date.now()
	const expiresAt = creds.accessTokenExpiresAt?.getTime() ?? 0

	if (accessToken && expiresAt > now + REFRESH_BUFFER_MS) {
		return { ok: true, token: accessToken, clientId: creds.clientId }
	}

	return refreshAccessToken(creds.clientId, clientSecret)
```

3. In `refreshAccessToken`, change the success `db.update(...).set({ accessToken: data.access_token, ... })` to encrypt:

```ts
			.set({
				accessToken: encryptSecret(data.access_token),
				accessTokenExpiresAt: expiresAt,
				lastTestStatus: 'ok',
				lastTestedAt: new Date(),
				updatedAt: new Date(),
			})
```

4. In `saveAndTestCredentials`, encrypt the stored `clientSecret` (but pass the plaintext to `refreshAccessToken`):

```ts
	await db
		.update(igdbCredentials)
		.set({ clientId, clientSecret: encryptSecret(clientSecret), updatedAt: new Date() })
		.where(eq(igdbCredentials.id, 1))

	const result = await refreshAccessToken(clientId, clientSecret)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/igdb/__tests__/auth-encryption.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Run existing IGDB suite to confirm no regression**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/igdb`
Expected: PASS (all existing IGDB tests green).

- [ ] **Step 6: Format & commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/igdb/auth.ts lib/igdb/__tests__/auth-encryption.test.ts
git add apps/dashboard/lib/igdb/auth.ts apps/dashboard/lib/igdb/__tests__/auth-encryption.test.ts
git commit -m "feat(crypto): encrypt IGDB client secret and access token at rest"
```

---

## Task 4: Idempotent backfill script

**Files:**
- Create: `apps/dashboard/scripts/encrypt-credentials.ts`

**Context:** Existing installs (and the legacy `multi-recalbox-migration.ts` path, which writes `ssh_password` via a direct `db.insert` bypassing the gateway) hold plaintext secrets. This script re-encrypts any plaintext secret in place. It must be idempotent: skip values already starting with `enc:v1:`, and skip empty strings. It mirrors the style of `scripts/assign-recalbox-owner.ts` (direct Drizzle, top-level `main()`, `process.exit`). No test (operational one-shot, like the other scripts); verified by manual dry-run output.

- [ ] **Step 1: Write the script**

```ts
// apps/dashboard/scripts/encrypt-credentials.ts
import { encryptSecret, isEncrypted } from '@/lib/crypto/credentials'
import { db } from '@/lib/db'
import { igdbCredentials, recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
	const dryRun = process.argv.includes('--dry-run')
	let changed = 0

	// recalboxes.ssh_password
	for (const row of db.select().from(recalboxes).all()) {
		if (row.sshPassword && !isEncrypted(row.sshPassword)) {
			console.log(`recalbox ${row.id} (${row.name}): ssh_password -> encrypt`)
			if (!dryRun) {
				db.update(recalboxes)
					.set({ sshPassword: encryptSecret(row.sshPassword) })
					.where(eq(recalboxes.id, row.id))
					.run()
			}
			changed++
		}
	}

	// igdb_credentials.client_secret / access_token (singleton row id=1)
	const creds = db.select().from(igdbCredentials).where(eq(igdbCredentials.id, 1)).get()
	if (creds) {
		const patch: { clientSecret?: string; accessToken?: string } = {}
		if (creds.clientSecret && !isEncrypted(creds.clientSecret)) {
			console.log('igdb: client_secret -> encrypt')
			patch.clientSecret = encryptSecret(creds.clientSecret)
			changed++
		}
		if (creds.accessToken && !isEncrypted(creds.accessToken)) {
			console.log('igdb: access_token -> encrypt')
			patch.accessToken = encryptSecret(creds.accessToken)
			changed++
		}
		if (!dryRun && Object.keys(patch).length > 0) {
			db.update(igdbCredentials).set(patch).where(eq(igdbCredentials.id, 1)).run()
		}
	}

	console.log(
		dryRun
			? `Dry run: ${changed} secret(s) would be encrypted.`
			: `Done: ${changed} secret(s) encrypted.`,
	)
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Dry-run against the dev DB to confirm it runs**

Run: `pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts --dry-run`
Expected: prints a per-secret line for any plaintext secret + a `Dry run: N secret(s) would be encrypted.` summary, exit 0. (If the dev DB has no plaintext secrets, `N` = 0 — still a valid pass.)

- [ ] **Step 4: Commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write scripts/encrypt-credentials.ts
git add apps/dashboard/scripts/encrypt-credentials.ts
git commit -m "feat(crypto): add idempotent backfill script for plaintext credentials"
```

---

## Task 5: Documentation — .env.example & CLAUDE.md

**Files:**
- Modify: `apps/dashboard/.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the optional env var to `.env.example`**

After the `BETTER_AUTH_URL=...` line, append:

```bash

# Credential encryption (SSH/IGDB secrets at rest).
# Optional: defaults to deriving a key from BETTER_AUTH_SECRET.
# Set only to rotate the credential key independently of the auth secret.
CREDENTIALS_SECRET=
```

- [ ] **Step 2: Document the backfill command in `CLAUDE.md`**

In the `## Commands` section, after the `pnpm seed:dev` lines, add:

```bash
pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts            # Encrypt plaintext SSH/IGDB secrets at rest
pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts --dry-run  # Preview without writing
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/.env.example CLAUDE.md
git commit -m "docs(crypto): document CREDENTIALS_SECRET and the backfill command"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all suites green, including the three new files (Tasks 1–3). Count should be the prior total + the new tests.

- [ ] **Step 3: Lint the Phase 4 files**

Run: `pnpm --filter @recalbox/dashboard exec biome check lib/crypto lib/db/recalbox-queries.ts lib/db/__tests__/recalbox-queries-encryption.test.ts lib/igdb/auth.ts lib/igdb/__tests__/auth-encryption.test.ts scripts/encrypt-credentials.ts`
Expected: no diagnostics on Phase 4 files. (Pre-existing diagnostics in untouched files are not Phase 4 regressions.)

- [ ] **Step 4: Manual round-trip smoke test**

Steps:
1. Ensure `BETTER_AUTH_SECRET` is set in `apps/dashboard/.env.local`.
2. Start `pnpm dev`, open the app, edit a Recalbox's SSH password via the UI (or add a new Recalbox), save.
3. Inspect the DB: `pnpm --filter @recalbox/dashboard exec tsx -e "const {db}=require('./lib/db');const {recalboxes}=require('./lib/db/schema');console.log(db.select().from(recalboxes).all().map(r=>r.sshPassword))"` — every `ssh_password` should start with `enc:v1:`.
4. Confirm the app still connects over SSH (Now Playing / system stats load) — proving decrypt-on-read works end to end.

Expected: stored passwords are `enc:v1:…`; SSH still works.

---

## Verification (acceptance)

- `lib/crypto/credentials.ts` round-trips secrets and passes legacy plaintext through on decrypt.
- `recalboxes.ssh_password` is stored as `enc:v1:…`; `getRecalbox`/`listRecalboxes` return plaintext; SSH connections still succeed.
- `igdb_credentials.client_secret` and `.access_token` are stored encrypted; IGDB auth still works.
- The backfill script is idempotent (re-running encrypts 0 secrets) and has a `--dry-run`.
- No key set → one warning, plaintext storage, no crash (dev/test unaffected).
- `tsc --noEmit` clean; full test suite green; Biome clean on Phase 4 files.

## Out of scope (YAGNI / follow-ups)

- Key rotation tooling (re-encrypting all secrets under a new key) — the `enc:v1:` version tag leaves room for it; defer until needed.
- Encrypting other tables (push subscription keys, RA/SR caches) — not secrets in the threat model.
- Hard-fail-on-missing-key mode — explicitly rejected in favor of plaintext+warning for dev ergonomics.
