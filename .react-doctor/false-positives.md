# Faux-positifs confirmés (react-doctor)

Règles signalées par react-doctor qui ne s'appliquent pas dans ce codebase, avec la justification.

- **`nextjs-no-side-effect-in-get-handler`** — `events/route.ts:29` : `clients` est une `Map` locale au `start()` du stream, pas un cache au niveau module ; et `EventSource` n'autorise que `GET` (passer en `POST` casserait le SSE).

- **`no-adjust-state-on-prop-change`** — `pending-invitations.tsx:21` : le setter est asynchrone (`fetch().then(setItems)`), exempté par la validation de la règle.

- **`nextjs-no-redirect-in-try-catch`** — `match-game.ts:33` : `notFound()` est un helper local (retourne un `HltbMatchResult`), pas celui de Next.

- **`js-set-map-lookups` ×7** — ce sont des `string.indexOf('=')` / `string.includes()` (recherche de caractère), pas du membership de tableau.

- **`prefer-dynamic-import` ×3** — les composants `*-inner` recharts sont déjà lazy-loadés par leur parent via `dynamic(…, { ssr: false })`.

- **`label-has-associated-control`** (`label.tsx`, déjà `biome-ignore`), **`heading-has-content`** (`section-label.tsx`, `<h2 {...props}>`), **`prefer-tag-over-role` / `click-events-have-key-events`** (`input-group.tsx`) — primitives shadcn où le fix mécanique est sémantiquement faux.
