# Super Retrogamers API — Integration Playbook

Cross-repo guide to wire the real Super Retrogamers (SR) API into recalbox-dashboard.

- **SR repo** (the API provider): `../super-retrogamers` — Next.js 16 + Prisma + Better Auth + Hono, deployed at `https://www.super-retrogamers.com`.
- **Dashboard repo** (the consumer): this repo — stub client in `lib/super-retrogamers/client.ts`.

Companion contract draft: [super-retrogamers-api-spec.md](super-retrogamers-api-spec.md). **Read the "Reality check" section below — it corrects that draft.**

## State of play (verified 2026-06-14)

The dashboard side is fully scaffolded; only `SuperRetrogamersClient` returns empty values:

- Types (`SrGame`, `SrSystem`, `BulkLookupResult`), cache (`sr_cache` table, TTL by prefix), slug matching (`gameToSlug`, `gameToSlugVariants`, `SR_SYSTEM_SLUGS`) — all ready.
- Proxy routes already wired to `srClient`: `/api/super-retrogamers/{lookup,game-info,games/[slug],enrich-collection,test-connection}`.
- Config exists: `superRetrogamers { enabled, apiUrl, preferredRegion }` (`lib/settings/schemas.ts`, defaults `lib/settings/defaults.ts`).

**Blocker:** SR has no API designed for the dashboard yet. There is a rich internal API, but no `/api/v1`, no game-by-slug endpoint matching the dashboard contract, and the middleware (`../super-retrogamers/proxy.ts`) blocks bot user-agents and rate-limits — a naive Node `fetch` gets 403.

So the work is **two ordered steps in two repos**: build the SR endpoint first (Prompt A), then fill the dashboard client (Prompt B).

## Reality check vs the draft spec

| Draft spec said | Verified reality | Decision |
|---|---|---|
| No auth, `Access-Control-Allow-Origin: *` | Middleware blocks bots + rate-limits | Use **`X-API-Key`** shared secret (reuse the existing `CRON_SECRET` pattern in SR) |
| `characters: ["Mario", ...]` | **No `characters` relation** in the SR Prisma schema | Always return `[]` |
| `POST /games/lookup` (bulk) | — | Either is fine; align dashboard client to whatever SR ships |
| Slug `{name}-console-{console}` | **Matches exactly** — SR's `generateGameSlug` produces the same format and stores it as `Game.slug` | No decomposition needed; `getGameBySlugCached(slug)` already handles `-console-` |

Console slugs match between the two repos (snes→`super-nintendo`, segacd→`mega-cd`, mastersystem→`master-system`, etc.).

## Verified mapping: SR `Game` → dashboard `SrGame`

Resolver: `getGameBySlugCached(slug)` in `../super-retrogamers/lib/data/game-queries.ts` (uses `GAME_INCLUDE`).

| `SrGame` field | Source | Notes |
|---|---|---|
| `slug` | `game.slug` | identical |
| `name` | regional title for `region`, else `game.title` | apply `preferredRegion` here |
| `consoleSlug` | `game.console.slug` | |
| `score` | `game.rating` (Float?, default 0) | `null` if 0/absent |
| `summary` | `game.description ?? game.aiEnhancedDescription ?? null` | |
| `specs` | `Record<string,string>` from: `playerCount`, `resolution`, `rotation`, `releaseYear`, `sizeMB`, `console.name`, `corporationDev?.name`, `corporationPub?.name`, `gameGenres[].genre.name` | include only keys with a value |
| `characters` | `[]` | no relation in schema |
| `url` | `https://www.super-retrogamers.com/games/${game.slug}` | |

---

## Prompt A — run in `../super-retrogamers` FIRST

```
Crée un endpoint d'API public versionné pour un client externe (recalbox-dashboard),
exposant jeux et consoles du catalogue. C'est un WRAPPER MINCE sur le code existant.

## Contexte vérifié
- Game.slug est DÉJÀ au format `titre-console-consoleSlug` (cf. generateGameSlug dans
  lib/screenscraper-games.ts) — ex: `super-mario-bros-console-nes`. Aucune décomposition
  nécessaire.
- Résolution existante : getGameBySlugCached (lib/data/game-queries.ts) gère déjà le
  format `-console-` et le cache Redis. Réutilise-la, ne réécris pas la couche data.
- Liste des consoles : getAllConsolesWithRegionalNames (lib/data-prisma) — déjà exposée
  par app/api/consoles/route.ts.
- Auth serveur-à-serveur : copie le pattern CRON_SECRET déjà présent (.env.example +
  bypass /api/cron/ dans proxy.ts). Ajoute RECALBOX_API_KEY, vérifié via header X-API-Key.
- URL publique d'un jeu = https://www.super-retrogamers.com/games/{game.slug}.

## Endpoints à créer (namespace /api/v1, attendu par le dashboard)
  GET /api/v1/systems
    → [{ slug, name }]   (depuis les consoles)
  GET /api/v1/games/[slug]
    Résolution : getGameBySlugCached(slug).
    Mapping Prisma Game (avec GAME_INCLUDE) → réponse :
      slug        ← game.slug
      name        ← regionalTitles correspondant à `region` (query param) sinon game.title
      consoleSlug ← game.console.slug
      score       ← game.rating ; null si 0 ou absent
      summary     ← game.description ?? game.aiEnhancedDescription ?? null
      specs       ← Record<string,string> assemblé depuis les champs présents :
                    players=playerCount, resolution, rotation, year=releaseYear,
                    sizeMB, console=console.name, developer=corporationDev?.name,
                    publisher=corporationPub?.name, genres=gameGenres.map(g=>g.genre.name).join(', ')
                    (n'inclure que les clés dont la valeur existe)
      characters  ← [] (aucune relation characters dans le schéma)
      url         ← `https://www.super-retrogamers.com/games/${game.slug}`
    Param optionnel ?region=US|EU|JP|FR (défaut FR).
    404 si jeu inconnu.
  GET /api/v1/games/exists?slugs=a,b,c
    → { [slug]: { exists: boolean, url?: string } }
    Résolution bulk via getGameBySlugCached ; accepte plusieurs slugs candidats
    pour un même jeu (le dashboard envoie des variantes "the-").

## Exigences
- Auth : 401 si X-API-Key absent/invalide.
- proxy.ts : exclure /api/v1/* du blocage user-agent ET du rate-limit browser
  (ou rate-limit dédié plus permissif). NE casse PAS la protection des autres routes.
- Réutilise withRedisCache. Valide les query params avec zod (comme les routes existantes).
- Jamais d'erreur 500 non gérée (unstable_rethrow + catch).

## Méthode
- TDD Vitest : teste surtout le MAPPING Prisma → forme de réponse, et le bulk
  (présents/absents mélangés). Regarde app/api/search/route.ts et consoles/route.ts
  pour le style.

## Vérification (montre la sortie)
- pnpm vitest run
- Appelle les 3 endpoints en local avec et sans X-API-Key ; montre les JSON.
- Donne le CONTRAT EXACT final (URLs, header, query params, forme des réponses)
  pour le reporter dans le client recalbox-dashboard.
```

---

## Prompt B — run in `recalbox-dashboard` AFTER A ships

> Replace the `## Contrat de l'API` block with the exact contract returned by Prompt A.

```
Implémente le vrai SuperRetrogamersClient dans recalbox-dashboard contre l'API
Super Retrogamers maintenant disponible.

## Contexte (déjà en place, NE PAS recréer)
- Client stub : apps/dashboard/lib/super-retrogamers/client.ts — 4 méthodes
  (checkExists, getGame, bulkLookup, listSystems) qui renvoient du vide.
  Types SrGame / SrSystem / BulkLookupResult : NE PAS changer leur forme.
- Slug : apps/dashboard/lib/super-retrogamers/slug.ts (gameToSlug → format
  `nom-console-consoleslug`, gameToSlugVariants) — réutilise tel quel.
- Cache : apps/dashboard/lib/super-retrogamers/cache.ts — réutilise.
- Config : lib/settings/schemas.ts → superRetrogamers { enabled, apiUrl, preferredRegion }.
  Lis-la via lib/config.ts / config-store.ts (PAS d'env var en dur). apiUrl = base URL
  de l'API (ex. https://www.super-retrogamers.com/api/v1).
- Routes API du dashboard déjà branchées sur srClient : ne les touche pas.

## Contrat de l'API  <<< REMPLACE par la sortie du prompt A >>>
- GET {apiUrl}/systems → ...
- GET {apiUrl}/games/{slug} → ...
- GET {apiUrl}/games/exists?slugs=... → ...
- Auth : header X-API-Key. Ajoute une clé superRetrogamers.apiKey dans
  schemas.ts + defaults.ts + l'UI réglages (app/[locale]/settings/page.tsx).

## Exigences
- Les méthodes NE DOIVENT JAMAIS throw (cf. test "checkExists never throws").
  Erreur réseau/HTTP → log + fallback (exists:false / null / {} / []).
- enabled=false OU apiUrl vide → no-op (comme le stub).
- Isole le mapping "réponse API → SrGame/SrSystem" dans une fonction pure testée.
- bulkLookup : un seul appel si l'API le permet, sinon concurrence limitée + cache `exists:`.
- getGame → cache `game:` ; listSystems → cache `systems:`. Applique preferredRegion.
- Timeout sur les fetch + User-Agent identifiable.

## Méthode
- TDD (mock fetch) dans apps/dashboard/lib/super-retrogamers/__tests__/.
  Adapte client.test.ts pour couvrir enabled=true ET enabled=false sans casser le contrat.
- Style Biome : tabs, single quotes, pas de point-virgule, trailing commas.

## Vérification (montre la sortie)
- pnpm --filter @recalbox/dashboard vitest run lib/super-retrogamers
- pnpm lint
```
