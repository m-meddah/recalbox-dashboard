# Recalbox Dashboard - Tickets Pipeline

> Ce document rassemble tous les prompts Claude Code prévus pour le projet
> Recalbox Dashboard, dans leur ordre d'exécution.
>
> **Comment l'utiliser** : pour chaque ticket, ouvrir une nouvelle session
> Claude Code dans le dossier du projet, copier-coller le prompt complet du
> ticket, valider que le scaffold/feature tourne, puis passer au suivant.
>
> Auteur : Madjid Meddah ([@m-meddah](https://github.com/m-meddah))
> Stack : Next.js 16+, TypeScript, Drizzle, SQLite, Tailwind v4, shadcn/ui

## Vue d'ensemble du projet

**Dashboard d'analytics historique pour Recalbox**, complémentaire (pas
concurrent) du Web Manager natif Recalbox.

### Positionnement

Recalbox embarque déjà un Web Manager natif (`http://recalbox.local/`) qui
gère le live monitoring, l'édition de config et la gestion des BIOS/ROMs.
**Ce projet ne le remplace pas.** Il se greffe par-dessus pour apporter ce
que le natif ne fait pas :

- Historique long-terme des sessions de jeu (scrobble continu via MQTT)
- Analytics agrégés (heatmap, streak, top games, distribution par système)
- Intégration RetroAchievements (à venir)
- Wrapped annuel partageable (à venir)
- Multi-Recalbox (à venir)

Mental model : **Spotify (= Web Manager) vs Last.fm (= ce projet)**. Spotify
joue la musique, Last.fm enregistre l'historique et fait les stats. Pareil
ici, les deux outils coexistent sans se marcher dessus.

### Cartographie de l'écosystème Recalbox

L'écosystème d'outils Recalbox se répartit en catégories distinctes. Il est
important de savoir où notre projet se situe pour ne pas faire de doublon et
pour bien communiquer dessus.

| Outil | Catégorie | Concurrence avec nous ? |
| --- | --- | --- |
| Web Manager (natif) | Ops (monitoring, config, BIOS) | Non |
| RecalboxHomeAssistant | Contrôle / domotique | Non |
| M3U Master, Theme Gen, etc. | Utilitaires ponctuels | Non |
| **recalbox-dashboard** | **Analytics historique** | — |

Notre créneau (analytics historique : scrobble, heatmap, streak, Wrapped)
n'est couvert par AUCUN outil existant. C'est notre raison d'être.

Note technique : RecalboxHomeAssistant écoute le même broker MQTT que nous.
Cela ouvre une piste d'interopérabilité — publier nos analytics sur MQTT pour
que d'autres outils (Home Assistant, etc.) puissent les consommer. Voir le
Ticket 15 (bonus).

### Architecture technique

Tourne sur une machine tierce (Linux/macOS, NAS, autre Pi) sur le même réseau
local que la Recalbox. **NE tourne PAS sur la Recalbox elle-même.**

Connexion via :

- **MQTT** (port 1883) pour les événements temps réel (game start/stop)
- **SSH** (port 22) pour stats système et lecture de gamelist.xml
- **SMB** ou réseau pour les médias

Données traitées et persistées en SQLite local :

- Sessions de jeu (scrobble continu, daemon séparé)
- Collection enrichie (parsing gamelist.xml + userdata.ini)
- Snapshots système (time-series CPU/RAM/temp)

## Roadmap

| # | Ticket | Estimation | Valeur |
|---|--------|------------|--------|
| 0 | Scaffold initial | 2-3h | Foundation |
| 1 | Stats système (SSH) | 4-6h | ⭐⭐⭐⭐⭐ |
| 2 | Now Playing (MQTT) | 5-7h | ⭐⭐⭐⭐⭐ |
| 3 | Collection (gamelist.xml) | 6-8h | ⭐⭐⭐⭐⭐ |
| 4 | Scrobble daemon | 6-8h | ⭐⭐⭐⭐ |
| 5 | Page Stats UI | 6-8h | ⭐⭐⭐⭐⭐ |
| 6 | Settings runtime | 5-7h | ⭐⭐⭐⭐ |
| 7 | Docker self-hosting | 4-6h | ⭐⭐⭐⭐⭐ |
| 8 | Internationalisation | 4-6h | ⭐⭐⭐ |
| 9 | RetroAchievements | 8-10h | ⭐⭐⭐⭐ |
| 10 | Super Retrogamers | 6-8h | ⭐⭐⭐ |
| 11 | Wrapped annuel | 6-8h | ⭐⭐⭐⭐⭐ |
| 12 | Push notifications | 8-10h | ⭐⭐⭐ |
| 13 | PWA installable | 4-6h | ⭐⭐⭐⭐ |
| 14 | Multi-Recalbox | 15-25h | ⭐⭐ |
| 15 | Publication analytics sur MQTT (bonus) | 4-6h | ⭐⭐⭐ Interopérabilité écosystème |
| 16 | Générateur de fichiers .m3u multi-disques | 5-7h | ⭐⭐⭐⭐ Gestion de collection |
| 17 | Diagnostic de collection et statut Patron | 5-7h | ⭐⭐⭐⭐ Recommandations actionnables |

**Total estimé** : 99 à 140 heures de travail réel.
À 5h/semaine : environ 4 à 6 mois de side project.

## Conseils d'utilisation

1. **Ne pas sauter de tickets** : chaque prompt assume que les précédents sont mergés
2. **Toujours commencer par** `git log --oneline -10` dans la session Claude Code
3. **Toujours commiter** entre les tickets, et tester `pnpm build` + `pnpm dev`
4. **Mettre à jour le README** après chaque ticket (case cochée + section)
5. **Ne pas hésiter à dévier** : un prompt est une base, pas un dogme

---



## ⚠️ Mise à jour importante : architecture monorepo

Le projet utilise désormais une **architecture monorepo pnpm workspaces** dès le
Ticket 0, pour permettre le partage de code avec un futur projet annexe
(`recalbox-image-perso`) qui aura besoin d'un CLI de scraping.

Conséquences sur tous les tickets :

- **Tous les chemins de fichiers** sont préfixés par `apps/dashboard/` au lieu
  d'être à la racine. Quand un ticket dit "crée `lib/recalbox/ssh-client.ts`",
  il faut lire "crée `apps/dashboard/lib/recalbox/ssh-client.ts`".
- **Tickets 5-6 (scraper)** : la logique principale du scraper ScreenScraper va
  dans `packages/scraper-core/` au lieu de `apps/dashboard/lib/`. Le dashboard
  l'importe via `@recalbox/scraper-core`.
- **Ticket 10 (Super Retrogamers)** : la fonction `gameToSlug` et le mapping
  `SR_SYSTEM_SLUGS` vont aussi dans `packages/scraper-core/`. Réutilisés par
  le CLI image perso.
- **Commands pnpm** : `pnpm dev` devient `pnpm --filter @recalbox/dashboard dev`
  ou `pnpm dev` au root si tu ajoutes un script proxy. Tous les autres scripts
  pnpm sont scopés au workspace.

Le Ticket 0 ci-dessous a été refactoré pour cette nouvelle architecture. Les
autres tickets restent valides, juste les chemins de fichiers à adapter.

---

## Ticket 0 — Scaffold initial (version monorepo)

```markdown
# Projet : recalbox-dashboard (monorepo)

Tu vas m'aider à construire un dashboard self-hostable open-source pour Recalbox,
**structuré en monorepo pnpm workspaces dès le départ**.

Le monorepo héberge plusieurs apps qui partagent du code via des packages
internes. Au minimum :
- `apps/dashboard` : l'app Next.js principale
- `packages/scraper-core` : lib partagée de scraping ScreenScraper et matching
  (créée vide, remplie aux Tickets 5-6)

D'autres apps viendront plus tard : un CLI pour mon image Recalbox perso.

## Contexte fonctionnel

Recalbox = distribution retrogaming sur Pi5. Ce dashboard tourne sur une machine
TIERCE (Linux/macOS, NAS) sur le même réseau local que la Recalbox. NE tourne PAS sur
la Recalbox elle-même.

Connexion via :
- MQTT (port 1883) pour événements temps réel
- SSH (port 22) pour stats système
- SMB ou réseau pour gamelist.xml

Données traitées :
- Sessions de jeu via MQTT → scrobble SQLite
- Collection via parsing gamelist.xml → SQLite
- Snapshots système → time-series SQLite

## Stack technique imposée

- Next.js 16.2 (App Router, Turbopack, React 19.2)
- TypeScript strict
- Tailwind CSS v4
- shadcn/ui
- Drizzle ORM + better-sqlite3
- mqtt, node-ssh, fast-xml-parser, Recharts
- **pnpm** (obligatoire pour workspaces)
- Biome (pas ESLint)

## Architecture monorepo

```
recalbox-dashboard/
├── pnpm-workspace.yaml
├── package.json                    # root
├── biome.json
├── tsconfig.base.json
├── .gitignore
├── README.md
├── LICENSE                         # MIT
│
├── apps/
│   └── dashboard/
│       ├── package.json            # @recalbox/dashboard
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── app/...
│       ├── lib/...
│       ├── components/...
│       ├── scripts/
│       ├── drizzle/migrations/
│       └── .env.example
│
└── packages/
    └── scraper-core/
        ├── package.json            # @recalbox/scraper-core
        ├── tsconfig.json
        ├── src/index.ts            # stub
        └── README.md
```

## Configuration root

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### package.json root

```json
{
  "name": "recalbox-dashboard-monorepo",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.0.0",
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

### tsconfig.base.json

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

### biome.json (root)

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

## Configuration apps/dashboard

### apps/dashboard/package.json

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
    "next": "16.2.x",
    "react": "19.2.x",
    "react-dom": "19.2.x",
    "drizzle-orm": "^0.36.x",
    "better-sqlite3": "^11.x",
    "mqtt": "^5.x",
    "node-ssh": "^13.x",
    "fast-xml-parser": "^4.x",
    "recharts": "^2.x"
  },
  "devDependencies": {
    "@types/node": "^22.x",
    "@types/react": "^19.x",
    "tailwindcss": "^4.x",
    "tsx": "^4.x",
    "vitest": "^2.x"
  }
}
```

Note : `"@recalbox/scraper-core": "workspace:*"` lie au package interne.

### apps/dashboard/tsconfig.json

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

### apps/dashboard/next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: { reactCompiler: true },
  transpilePackages: ['@recalbox/scraper-core'],  // CRITIQUE
};

export default nextConfig;
```

## Configuration packages/scraper-core (stub)

### packages/scraper-core/package.json

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

Pas de build pipeline pour la lib : Next compile via `transpilePackages`.

### packages/scraper-core/src/index.ts

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
export const placeholder = true;
```

### packages/scraper-core/tsconfig.json

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

## Schema Drizzle (dans apps/dashboard)

Sous `apps/dashboard/lib/db/schema.ts`. 3 tables : sessions, games,
system_snapshots. (Identique à l'ancien Ticket 0, juste relocalisé.)

## .env.example

Sous `apps/dashboard/.env.example`.

## Ce que je veux pour cette première itération

1. Setup structure monorepo (pnpm-workspace.yaml + root package.json)
2. Init `apps/dashboard` avec create-next-app (Next 16.2 + TS + Tailwind v4)
3. Biome au root (pas ESLint, supprimer config ESLint générée par Next)
4. Installer toutes les deps dans apps/dashboard
5. Stub `packages/scraper-core` avec package.json + index.ts
6. Lier `@recalbox/scraper-core` comme workspace dep
7. **Tester l'import** : dans `apps/dashboard/app/page.tsx`, importer
   `placeholder` de `@recalbox/scraper-core` et l'afficher
8. Setup Drizzle dans apps/dashboard
9. Setup shadcn/ui dans apps/dashboard
10. README root avec structure monorepo expliquée
11. `.gitignore` propre
12. LICENSE MIT

## Contraintes

- **Aucune feature implémentée**, juste scaffold qui compile et tourne
- Tous fichiers `apps/dashboard/lib/` = stubs typés
- TypeScript strict + noUncheckedIndexedAccess + verbatimModuleSyntax
- Biome : tabIndent, single quotes, semicolons "asNeeded"
- React Compiler activé
- `transpilePackages: ['@recalbox/scraper-core']` CRITIQUE
- Commit : "chore: initial monorepo scaffold (Next 16 + scraper-core stub)"

## Vérification de l'import workspace

À la fin du scaffold, modifie `apps/dashboard/app/page.tsx` :

```typescript
import { placeholder } from '@recalbox/scraper-core';

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Recalbox Dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Scaffold OK. Scraper core lib import: {String(placeholder)}
      </p>
    </main>
  );
}
```

Si `pnpm dev` affiche "true", le monorepo fonctionne.

## Workflow

1. Scaffold en une fois
2. `pnpm install` (au root, installe tout)
3. `pnpm dev` → app sur :3000
4. Confirme l'import workspace ("true" affiché)
5. Récap décisions + TODO

Démarre maintenant.
```

---

## Ticket 1 — Stats système via SSH

```markdown
# Ticket 1 : Stats système Recalbox via SSH

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.

On va implémenter la première feature concrète : récupérer les stats système
de la Recalbox (CPU temp, CPU usage, RAM) via SSH, les exposer en API, les afficher
dans un composant React qui poll toutes les 5 secondes, et les persister en DB
pour faire un graphique sur la dernière heure.

## Objectifs

1. `lib/recalbox/ssh-client.ts` : wrapper node-ssh propre, singleton, gestion d'erreurs
2. `lib/recalbox/system-stats.ts` : fonctions qui lisent les stats Pi5 via SSH
3. `app/api/system-stats/route.ts` : GET qui retourne le snapshot courant
4. `lib/db/queries.ts` : query `insertSystemSnapshot` + `getRecentSnapshots(minutes)`
5. `components/system-stats-chart.tsx` : composant client qui poll + graph Recharts
6. Intégration sur `app/page.tsx`

## Détails techniques

### SSH client (lib/recalbox/ssh-client.ts)

- Singleton qui maintient UNE connexion SSH ouverte (évite la reconnexion à chaque appel)
- Lit la config depuis `lib/config.ts` (lui-même reading `process.env`)
- Méthode `exec(command: string): Promise<string>` qui retourne stdout trim
- Gestion : reconnexion auto si la connexion drop
- Timeout 5 secondes par commande
- Logs propres (pas de console.log, utilise un logger simple dans `lib/logger.ts`)

### Commandes système (lib/recalbox/system-stats.ts)

Exporter une fonction `getSystemStats(): Promise<SystemStats>` qui exécute en parallèle :

- **CPU temp** : `cat /sys/class/thermal/thermal_zone0/temp` → entier en millidegrés,
  diviser par 1000 → float en °C
- **CPU usage** : `top -bn1 | grep "Cpu(s)"` → parser le %us+%sy, ou plus simple :
  `cat /proc/stat | head -1` et calculer le diff (faire 2 reads à 200ms d'intervalle)
- **RAM** : `free -m | grep Mem` → extraire used et total en MB
- **Uptime** : `cat /proc/uptime` → premier float en secondes

Type TypeScript :

```typescript
export type SystemStats = {
  cpuTemp: number;       // °C
  cpuUsage: number;      // 0-100
  ramUsedMb: number;
  ramTotalMb: number;
  uptimeSec: number;
  takenAt: Date;
};
```

### API route (app/api/system-stats/route.ts)

- GET → appelle `getSystemStats()`, insère un snapshot en DB, retourne JSON
- En cas d'erreur SSH, retourne 503 + message clair
- Query param `?history=60` → retourne aussi les snapshots des N dernières minutes
- Pas de cache Next ici, c'est du temps réel

### Composant client (components/system-stats-chart.tsx)

- `'use client'`
- Fetch `/api/system-stats?history=60` toutes les 5 secondes via setInterval
- Affichage :
  - 3 grosses cards en haut : CPU °C (avec couleur selon seuil : vert < 60, orange 60-75, rouge > 75), RAM utilisée (barre de progression), Uptime humanisé
  - 1 LineChart Recharts en bas avec les 60 dernières minutes de CPU temp
- États : loading, error (Recalbox injoignable → message clair + retry button)
- Utilise `useEffectEvent` (React 19.2) pour la subscription au polling, pas un useEffect classique
- Composant `<Suspense>` autour pour profiter du streaming SSR

### Intégration page d'accueil

`app/page.tsx` est un Server Component qui :
- Render un layout 2 colonnes
- Colonne gauche : placeholder "Now Playing" (vide pour l'instant)
- Colonne droite : `<SystemStatsChart />` (client component)

### shadcn/ui à installer

Ajoute ces composants via `pnpm dlx shadcn@latest add` :
- card
- badge
- progress
- button
- alert

### Tests minimaux

Crée `lib/recalbox/__tests__/system-stats.test.ts` avec **vitest** (ajoute-le aux deps) :
- Mock du ssh-client
- Test du parsing de chaque commande (donne 2-3 exemples de stdout réels)

## Contraintes

- Strict TypeScript, pas de `any`
- Toutes les fonctions exportées doivent avoir une JSDoc minimale (1 ligne)
- Pas de gestion d'auth pour l'instant, on est en local
- Si une commande SSH échoue, le snapshot doit quand même retourner les valeurs disponibles (partial result), avec les manquantes à null
- Le polling côté client doit s'arrêter quand l'onglet est masqué (Page Visibility API)
- Commit à la fin : "feat(stats): SSH system stats with live chart"

## Workflow

1. Tu implémentes dans l'ordre : config → logger → ssh-client → system-stats → route API → query DB → composant React → integration page
2. À chaque étape, tu vérifies que `pnpm build` passe
3. Tu lances `pnpm dev` à la fin et tu testes avec une vraie Recalbox si possible,
   sinon avec un mock SSH que tu décris dans le README
4. Tu me résumes ce qui est fait, ce qui marche, ce qu'il reste

Si une commande système Pi5 que tu proposes ne marche pas comme prévu sur Recalbox
(ex: `top` indisponible, `/proc/stat` formaté différemment), tu me le signales
plutôt que d'inventer.

Démarre.
```

---


## Ticket 2 — Now Playing temps réel via MQTT

```markdown
# Ticket 2 : Now Playing temps réel via MQTT

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Le Ticket 1 (stats système via SSH) est mergé. On enchaîne sur le temps réel via MQTT.

Recalbox publie nativement sur un broker MQTT (mosquitto) tournant sur le Pi5 port 1883.
EmulationStation émet des événements quand un jeu démarre, se termine, quand on
navigue dans les menus, etc. On va s'y abonner pour afficher "Now Playing".

## Objectifs

1. `lib/recalbox/mqtt-client.ts` : client MQTT singleton avec reconnexion auto
2. `lib/recalbox/events.ts` : types + parser des événements Recalbox
3. Mécanisme de diffusion des events vers le client web (Server-Sent Events)
4. `app/api/events/route.ts` : endpoint SSE qui stream les events
5. `components/now-playing.tsx` : composant client qui consomme le SSE
6. Intégration sur `app/page.tsx` colonne gauche (placeholder remplacé)
7. Vérification empirique des topics MQTT réels via la Recalbox

## ⚠️ Vérification préalable indispensable

Les topics MQTT exacts de Recalbox 10 peuvent avoir changé. Avant d'implémenter,
demande-moi de lancer cette commande sur ma machine de dev :

```bash
mosquitto_sub -h recalbox.local -t '#' -v
```

Pendant que je joue à un jeu / quitte / navigue. Je te colle les sorties.
Tu en déduis les vrais topics et le format des payloads.

À défaut, base-toi sur ces topics historiques connus mais préviens-moi qu'ils
sont à confirmer :

- `Recalbox/EmulationStation/State` — état général ES
- `Recalbox/EmulationStation/Event` — événements (start/stop game, sleep, wake)

Le payload contient typiquement : `Game`, `System`, `Emulator`, `GamePath`, `ImagePath`.

Format exact à confirmer avec moi avant d'implémenter le parser.

## Détails techniques

### MQTT client (lib/recalbox/mqtt-client.ts)

- Utilise la lib `mqtt` (déjà installée au scaffold)
- Singleton qui maintient UNE connexion au broker pour toute l'app
- API en EventEmitter typé :
  ```typescript
  type RecalboxEventMap = {
    'game:start': (event: GameStartEvent) => void;
    'game:stop': (event: GameStopEvent) => void;
    'system:change': (event: SystemChangeEvent) => void;
    'connection:up': () => void;
    'connection:down': () => void;
  };
  ```
- Reconnexion auto avec backoff exponentiel (1s, 2s, 4s, 8s, max 30s)
- QoS 0 (on accepte de perdre un event si déco, c'est temps réel pas critique)
- Subscribe au topic `Recalbox/#` au connect
- Log propre via le logger existant (Ticket 1)

### Types d'events (lib/recalbox/events.ts)

```typescript
export type GameStartEvent = {
  type: 'game:start';
  system: string;
  gameName: string;
  romPath: string;
  imagePath?: string;
  emulator?: string;
  startedAt: Date;
};

export type GameStopEvent = {
  type: 'game:stop';
  system: string;
  gameName: string;
  romPath: string;
  stoppedAt: Date;
};

export type SystemChangeEvent = {
  type: 'system:change';
  system: string;
};

export type RecalboxEvent = GameStartEvent | GameStopEvent | SystemChangeEvent;
```

Et une fonction `parseRecalboxMessage(topic: string, payload: Buffer): RecalboxEvent | null`
qui transforme un message MQTT brut en event typé. Doit être robuste : retourne `null`
si le format est inattendu, sans throw.

### SSE endpoint (app/api/events/route.ts)

Pourquoi SSE et pas WebSocket : plus simple, suffisant pour du push serveur→client,
natif côté navigateur via EventSource, fonctionne bien avec Next 16 App Router.

```typescript
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';  // PAS edge, on a besoin de mqtt qui utilise tcp

export async function GET(request: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const mqttClient = getMqttClient();

      const sendEvent = (event: RecalboxEvent) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };

      mqttClient.on('game:start', sendEvent);
      mqttClient.on('game:stop', sendEvent);
      mqttClient.on('system:change', sendEvent);

      // Heartbeat toutes les 15s pour garder la connexion vivante
      const heartbeat = setInterval(() => {
        controller.enqueue(`: heartbeat\n\n`);
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        mqttClient.off('game:start', sendEvent);
        mqttClient.off('game:stop', sendEvent);
        mqttClient.off('system:change', sendEvent);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

### Composant client (components/now-playing.tsx)

- `'use client'`
- Utilise `useEffect` + `EventSource` pour se connecter à `/api/events`
- État local : `currentGame: GameStartEvent | null`
- Sur event `game:start` → set currentGame
- Sur event `game:stop` correspondant (même romPath) → clear currentGame
- Reconnexion auto si EventSource ferme (timeout, déco réseau)

**Affichage** :

- Si rien ne joue : grosse carte centrée "Aucun jeu en cours" + icône lucide-react
- Si un jeu joue :
  - Jaquette à gauche (lit l'image via une route helper `/api/media?path=...`)
  - À droite : nom du jeu, système (badge), durée écoulée depuis le start
  - Petit indicateur "live" pulsant (point vert qui pulse)
- État "connexion MQTT perdue" : badge orange "Hors ligne" en haut

### Helper médias (app/api/media/route.ts)

Petit endpoint qui sert les images de la Recalbox.
- GET `/api/media?path=<path absolu sur Recalbox>`
- Lit le fichier via SSH (`cat <path> | base64`) ou via SMB si monté
- Whitelist : path doit commencer par `/recalbox/share/` (sécurité anti-path-traversal)
- Cache HTTP 1h (`Cache-Control: public, max-age=3600`)
- Content-Type détecté depuis l'extension

### Intégration page d'accueil

`app/page.tsx` :
- Layout 2 colonnes : `<NowPlaying />` à gauche (1/2 largeur), `<SystemStatsChart />` à droite
- Sur mobile : stack vertical, NowPlaying en haut

### shadcn/ui à installer

- avatar
- skeleton (pour le loading)

## Tests

`lib/recalbox/__tests__/events.test.ts` :
- Test du parseur avec plusieurs payloads MQTT bruts
- Cas nominaux + cas dégénérés (payload vide, JSON invalide, topic inconnu)

## Contraintes

- Strict TypeScript, pas de `any`
- L'API MQTT doit pouvoir tourner sans Recalbox accessible
- Pas de polling côté client, c'est du push uniquement
- Ne touche pas au DB schema dans ce ticket
- Commit final : "feat(events): live Now Playing via MQTT + SSE"

## Workflow

1. **Étape 0** : Tu me demandes de lancer `mosquitto_sub` et tu attends ma réponse
   avant d'écrire le parser. Ne commence pas à coder en aveugle.
2. Tu implémentes : mqtt-client → events parser → SSE endpoint → media helper → composant → intégration
3. Tu vérifies `pnpm build`
4. Tu tests `pnpm dev` avec une vraie Recalbox
5. Tu mets à jour le README : coche Ticket 2, section "Architecture > Real-time events"
6. Tu me résumes ce qui marche

Démarre par l'étape 0 : demande-moi la sortie `mosquitto_sub`.
```

---


## Ticket 3 — Collection (gamelist.xml)

```markdown
# Ticket 3 : Collection de jeux (parsing gamelist.xml)

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Tickets 1 (stats SSH) et 2 (Now Playing MQTT) sont mergés. On attaque la collection.

Recalbox stocke les métadonnées de chaque jeu dans des fichiers `gamelist.xml`,
un par système, dans `/recalbox/share/roms/<system>/gamelist.xml`. Ces fichiers
sont remplis par le scraper Recalbox (ScreenScraper) ou à la main.

Format typique d'un gamelist.xml :

```xml
<?xml version="1.0"?>
<gameList>
  <game>
    <path>./Super Mario World (Europe).sfc</path>
    <name>Super Mario World</name>
    <desc>Super Mario World est un jeu de plateforme...</desc>
    <image>./media/images/Super Mario World (Europe).png</image>
    <video>./media/videos/Super Mario World (Europe).mp4</video>
    <thumbnail>./media/thumbnails/...</thumbnail>
    <rating>0.95</rating>
    <releasedate>19921011T000000</releasedate>
    <developer>Nintendo EAD</developer>
    <publisher>Nintendo</publisher>
    <genre>Plateforme</genre>
    <players>1-2</players>
    <favorite>true</favorite>
    <hidden>false</hidden>
    <playcount>12</playcount>
    <lastplayed>20260315T204512</lastplayed>
  </game>
</gameList>
```

## Objectifs

1. `lib/recalbox/gamelist-parser.ts` : parser fast-xml-parser, robuste
2. `lib/recalbox/gamelist-reader.ts` : lecture des fichiers via SSH
3. `lib/recalbox/systems.ts` : liste des systèmes Recalbox + détection auto
4. `lib/db/queries.ts` : queries upsert games, list games avec filtres
5. `app/api/collection/sync/route.ts` : POST déclenche un import complet
6. `app/api/collection/route.ts` : GET liste paginée + filtres
7. `app/collection/page.tsx` : vue globale (tous systèmes)
8. `app/collection/[system]/page.tsx` : vue par système
9. `components/collection-grid.tsx` : grille de cartes jeu
10. `components/game-card.tsx` : carte individuelle
11. `components/collection-filters.tsx` : filtres (favoris, jamais joués, par dev...)
12. Lien dans le layout principal vers `/collection`

## Détails techniques

### Détection des systèmes (lib/recalbox/systems.ts)

- Fonction `listSystems(): Promise<string[]>` qui SSH sur la Recalbox et fait :
  `ls -1 /recalbox/share/roms/`
- Retourne uniquement les dossiers qui contiennent un `gamelist.xml`
- Cache en mémoire 5 minutes
- Mapping système → nom affichable + emoji/icône

### Lecture des fichiers (lib/recalbox/gamelist-reader.ts)

- `readGamelist(system: string): Promise<string>` qui exécute via SSH :
  `cat /recalbox/share/roms/<system>/gamelist.xml`
- Retourne le XML brut
- Si le fichier n'existe pas → retourne null sans throw
- Timeout généreux (30s)

### Parser (lib/recalbox/gamelist-parser.ts)

Utilise `fast-xml-parser` avec ces options :

```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'game',
});
```

Type de sortie :

```typescript
export type ParsedGame = {
  romPath: string;
  name: string;
  description?: string;
  imagePath?: string;
  videoPath?: string;
  thumbnailPath?: string;
  rating?: number;
  releaseDate?: Date;
  developer?: string;
  publisher?: string;
  genre?: string;
  players?: string;
  favorite: boolean;
  hidden: boolean;
  playCount?: number;
  lastPlayed?: Date;
};

export function parseGamelist(xml: string, system: string): ParsedGame[];
```

Points d'attention :
- Paths relatifs → reconstruire absolus en préfixant `/recalbox/share/roms/<system>/`
- `<releasedate>` au format `YYYYMMDDTHHMMSS` → helper `parseRecalboxDate`
- `<favorite>` et `<hidden>` sont `"true"` / `"false"` → boolean
- Robuste : si un game n'a pas de `<name>` ou de `<path>`, on le skip avec un warn

### DB queries

```typescript
export async function upsertGames(games: ParsedGame[], system: string): Promise<number>;

export type CollectionFilters = {
  system?: string;
  favoritesOnly?: boolean;
  neverPlayed?: boolean;
  developer?: string;
  search?: string;
  sortBy?: 'name' | 'rating' | 'lastPlayed' | 'releaseDate';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export async function listGames(filters: CollectionFilters): Promise<{
  games: Game[];
  total: number;
}>;

export async function getCollectionStats(): Promise<{
  totalGames: number;
  bySystem: Record<string, number>;
  favorites: number;
  neverPlayed: number;
}>;
```

ID du jeu : `crypto.createHash('sha1').update(romPath).digest('hex').slice(0, 16)`.

### API routes

**`POST /api/collection/sync`** :
- Trigger un import complet
- Retourne du JSON streamé (NDJSON) pour montrer la progression
- Query param `?system=snes` pour ne sync qu'un seul système

**`GET /api/collection`** :
- Query params mappent vers CollectionFilters
- Réponse : `{ games: Game[]; total: number; page: number; pageSize: number; }`

### Pages

**`app/collection/page.tsx`** (Server Component) :
- Lit `getCollectionStats()` côté serveur
- Affiche : total jeux, nb favoris, nb jamais joués, par système (badges cliquables)
- Bouton "Synchroniser depuis Recalbox"
- En bas : `<CollectionGrid>`

**`app/collection/[system]/page.tsx`** :
- Mêmes composants mais filtre fixé sur `system`
- Breadcrumb : Collection > <Système>

**`use cache` directive** sur les fonctions de lecture stats / list.

### shadcn/ui à installer

- input, select, toggle, tooltip, tabs, navigation-menu, skeleton, separator

## Tests

`lib/recalbox/__tests__/gamelist-parser.test.ts` :
- Fixtures XML dans `__fixtures__/` :
  - `snes.gamelist.xml`, `minimal.gamelist.xml`, `empty.gamelist.xml`
  - `malformed.gamelist.xml`, `partial.gamelist.xml`
- Test du parsing de date Recalbox
- Test de la reconstruction de paths absolus

## Performance

- Sur 10k+ jeux, l'import doit rester rapide
- Utilise `db.batch()` ou transaction Drizzle pour insérer 500 jeux d'un coup
- Vise < 5 secondes pour 5000 jeux sur 15 systèmes

## Contraintes

- Strict TypeScript
- Sync DOIT être idempotent
- L'app doit tourner même si aucun système n'a encore été sync
- Commit final : "feat(collection): gamelist.xml parser + collection views"

## Workflow

1. Commence par me demander un échantillon de `gamelist.xml` réel depuis ma Recalbox
   (commande : `cat /recalbox/share/roms/snes/gamelist.xml | head -200`)
2. Implémente dans l'ordre : systems → gamelist-reader → parser (avec tests) →
   queries → routes API → composants → pages → intégration nav
3. Vérifie `pnpm build`
4. Test final `pnpm dev` :
   - Va sur /collection
   - Clique "Synchroniser"
   - Vérifie la barre de progression streamée
   - Teste les filtres
5. Update README : coche Ticket 3, ajoute screenshot placeholder, documente API
6. Résume-moi ce qui marche, perfs constatées, surprises éventuelles

Démarre par demander un échantillon réel de gamelist.xml.
```

---


## Ticket 4 — Scrobble daemon

```markdown
# Ticket 4 : Scrobble des sessions de jeu

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Tickets 1 à 3 sont mergés.

On va exploiter le flux MQTT du Ticket 2 pour enregistrer chaque session de jeu
en DB. C'est un "Last.fm pour retrogaming" : on capture quand l'utilisateur joue,
à quoi, pendant combien de temps.

Particularité critique : le scrobble doit tourner EN PERMANENCE, même quand
personne n'a le dashboard web ouvert. Donc on a besoin d'un PROCESS DAEMON séparé.

## Objectifs

1. `scripts/start-scrobbler.ts` : process daemon Node standalone
2. `lib/scrobbler/index.ts` : logique métier du scrobbling
3. `lib/scrobbler/session-manager.ts` : ouverture/fermeture de sessions
4. `lib/db/queries.ts` (extend) : queries sessions
5. `app/api/sessions/route.ts` : GET sessions paginées + filtres
6. `app/api/sessions/stats/route.ts` : agrégats (temps total, top jeux, etc.)
7. Documentation : comment lancer le daemon en parallèle du dashboard

## Architecture du daemon

Pi5 Recalbox (MQTT broker) → MQTT vers :
- Dashboard Next.js (pnpm dev/start) → SSE → UI temps réel
- Scrobbler daemon (pnpm scrobbler) → MQTT → SQLite

Les deux process partagent la même DB SQLite (WAL mode activé).

## Détails techniques

### Process daemon (scripts/start-scrobbler.ts)

```typescript
#!/usr/bin/env tsx
import { startScrobbler } from '../lib/scrobbler';
import { logger } from '../lib/logger';

async function main() {
  logger.info('Starting Recalbox scrobbler daemon...');
  const scrobbler = await startScrobbler();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await scrobbler.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error in scrobbler');
  process.exit(1);
});
```

Scripts package.json :
```json
"scripts": {
  "scrobbler": "tsx scripts/start-scrobbler.ts",
  "scrobbler:dev": "tsx watch scripts/start-scrobbler.ts"
}
```

### Session manager (lib/scrobbler/session-manager.ts)

```typescript
export class SessionManager {
  async openSession(event: GameStartEvent): Promise<void>;
  async closeSession(event: GameStopEvent): Promise<Session | null>;
  async recoverOrphanSessions(maxAgeHours?: number): Promise<number>;
  async closeAllOpenSessions(reason: string): Promise<number>;
}
```

Règles métier :

- **Session minimum** : si < 10s, supprimer au close (config `SCROBBLE_MIN_DURATION_SEC=10`)
- **Session maximum** : si > 12h sans stop, considérer oubliée → cap à médiane ou 1h
- **Pas de double session** : si on reçoit un start alors qu'une session est déjà
  ouverte, fermer l'ancienne (flag `auto_closed=true`)

### Extension du schema

```typescript
export const sessions = sqliteTable('sessions', {
  // ... existant
  autoClosed: integer('auto_closed', { mode: 'boolean' }).default(false),
  closedReason: text('closed_reason'),
});

export const sessionsRomPathIdx = index('idx_sessions_rom_path').on(sessions.romPath);
export const sessionsStartedAtIdx = index('idx_sessions_started_at').on(sessions.startedAt);
export const sessionsEndedAtIdx = index('idx_sessions_ended_at').on(sessions.endedAt);
```

### DB queries

```typescript
export type SessionFilters = { ... };
export async function listSessions(filters: SessionFilters): Promise<{ sessions: Session[]; total: number }>;
export async function getOpenSessions(): Promise<Session[]>;

export type SessionStats = {
  totalPlaytimeSec: number;
  totalSessions: number;
  uniqueGames: number;
  avgSessionSec: number;
  byDay: Array<{ date: string; playtimeSec: number; sessionCount: number }>;
  bySystem: Array<{ system: string; playtimeSec: number; sessionCount: number }>;
  topGames: Array<{ romPath: string; gameName: string; system: string; playtimeSec: number; sessionCount: number; lastPlayed: Date }>;
};

export async function getSessionStats(opts: { fromDate?: Date; toDate?: Date; topGamesLimit?: number }): Promise<SessionStats>;
```

### API routes

- `GET /api/sessions` : pagination classique, filtres
- `GET /api/sessions/stats` : agrégats, pas de cache (calculs SQL rapides)
- `GET /api/scrobbler/health` : healthcheck (last event, sessions ouvertes)

### Documentation

README, nouvelle section "Running the scrobbler" :

```markdown
The scrobbler is a separate daemon that listens to MQTT events.

### Development
pnpm dev              # Dashboard
pnpm scrobbler:dev    # Scrobbler with auto-reload

### Production (PM2)
pm2 start npm --name "recalbox-dashboard" -- start
pm2 start tsx --name "recalbox-scrobbler" -- scripts/start-scrobbler.ts
pm2 save && pm2 startup
```

Crée aussi `docs/systemd-examples/recalbox-scrobbler.service`.

## Tests

`lib/scrobbler/__tests__/session-manager.test.ts` :
- Start puis stop normal
- Start sans stop, puis 2e start → 1ère auto-closed
- Stop sans start préalable → ignoré
- Session < 10s → supprimée
- recoverOrphanSessions
- Crash simulé + recovery

DB SQLite in-memory : `drizzle(new Database(':memory:'))`.

## Contraintes

- Strict TypeScript, aucun `any`
- WAL mode activé sur SQLite (`db.pragma('journal_mode = WAL')`)
- Le daemon doit logguer chaque open/close avec niveau info
- Le daemon doit logguer les erreurs MQTT sans crasher
- Commit final : "feat(scrobbler): session tracking daemon with crash recovery"

## Workflow

1. Implémente dans l'ordre :
   - Schema migration + indexes
   - WAL mode
   - SessionManager + tests
   - lib/scrobbler/index.ts
   - scripts/start-scrobbler.ts
   - queries (sessions + stats)
   - routes API + health
   - docs systemd
   - README update
2. Vérifie `pnpm build`
3. Tests :
   - `pnpm test` doit passer
   - Lance scrobbler + dashboard en parallèle
   - Joue 30s → arrête → vérifie session en DB
   - `/api/scrobbler/health` retourne isHealthy: true
   - Kill daemon + relance → aucun orphan
4. Update README
5. Résume-moi : ce qui marche, perfs, points d'attention pour Ticket 5

Note : pas d'UI dans ce ticket. La page Stats viendra au Ticket 5.

Démarre.
```

---


## Ticket 5 — Page Stats avec graphiques et heatmap

> **Points d'attention issus du Ticket 4**
>
> - **`gameId` est nullable** dans la table `sessions` : le scrobbler enregistre
>   sans avoir besoin que le jeu soit présent dans la collection. La page Stats
>   doit gérer le cas où `gameId` est null — utiliser `gameName` via LEFT JOIN
>   sur `games.romPath`, comme c'est déjà fait dans `getSessionStats()`.
> - **`pnpm test` à la racine échoue** sur `scraper-core` (aucun fichier de test
>   — problème pré-existant). Lancer les tests avec
>   `pnpm --filter @recalbox/dashboard test` pour voir le vrai résultat (50/50).
> - **Migration 0002 corrigée manuellement** : Drizzle-kit avait généré un
>   `INSERT … SELECT` qui référençait `auto_closed`/`closed_reason` depuis
>   l'ancienne table. Corrigé avec des littéraux `0, NULL`. Si une future
>   migration ajoute des colonnes à `sessions`, vérifier le SQL généré avant
>   de commiter.
> - **Architecture dual-process** : dashboard et scrobbler partagent
>   `recalbox.db` via WAL (safe). En dev, les deux process créent chacun leur
>   propre singleton MQTT — les logs `game:start`/`game:stop` apparaissent dans
>   les deux terminaux, c'est normal.

```markdown
# Ticket 5 : Page Stats avec graphiques et heatmap

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Tickets 1 à 4 sont mergés. Le scrobbler daemon accumule des sessions.

Inspiration : Last.fm + GitHub contributions graph + Spotify Wrapped.

## Objectifs

1. `app/stats/page.tsx` : page Stats globale
2. `app/stats/[period]/page.tsx` : vues filtrées (week/month/year/all)
3. `components/stats/playtime-chart.tsx` : courbe temps de jeu par jour
4. `components/stats/system-distribution.tsx` : répartition par système
5. `components/stats/top-games.tsx` : top jeux joués
6. `components/stats/activity-heatmap.tsx` : heatmap style GitHub
7. `components/stats/streak-card.tsx` : série de jours consécutifs
8. `components/stats/session-timeline.tsx` : timeline des dernières sessions
9. `lib/stats/calculators.ts` : agrégats côté serveur
10. `lib/stats/formatters.ts` : formatage durées, dates, etc.

## Détails techniques

### Layout général

Tabs en haut : Cette semaine | Mois | Année | Tout
Sections empilées :
- KPI cards (Total, Games, Sessions, Streak)
- Heatmap GitHub-style (365 jours)
- Temps de jeu par jour (line chart Recharts)
- Top jeux + Par système (2 colonnes)
- Dernières sessions (timeline)

### Calculs (lib/stats/calculators.ts)

```typescript
export type Period = 'week' | 'month' | 'year' | 'all';

export type DashboardStats = {
  period: PeriodRange;
  kpi: {
    totalPlaytimeSec: number;
    uniqueGames: number;
    totalSessions: number;
    currentStreak: number;
    longestStreak: number;
  };
  playtimeByDay: Array<{ date: string; playtimeSec: number }>;
  topGames: Array<{ ... }>;
  bySystem: Array<{ system: string; playtimeSec: number; sessionCount: number; percentage: number }>;
  recentSessions: Session[];
};

export async function getDashboardStats(period: Period): Promise<DashboardStats>;
```

Streak : jours consécutifs avec au moins 1 minute jouée. Pas de jeu hier mais
oui aujourd'hui → streak = 1. Pas de jeu aujourd'hui → streak = 0.

### Formatters

```typescript
export function formatDuration(seconds: number): string;       // "47h12" ou "12m"
export function formatRelativeDate(date: Date, locale?: string): string;
export function toDateKey(date: Date): string;
```

Utilise `Intl.RelativeTimeFormat` natif. Locale par défaut : 'fr-FR'.

### KPI cards

```typescript
type KpiCardProps = {
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' | 'neutral' };
  icon: LucideIcon;
};
```

Delta vs période précédente. Pas de delta pour "Tout".

### Heatmap d'activité

**N'utilise PAS une lib externe**. CSS grid à la main.

```typescript
type HeatmapCell = {
  date: Date;
  dateKey: string;
  playtimeSec: number;
  sessionCount: number;
  intensity: 0 | 1 | 2 | 3 | 4;
};

function generateHeatmap(
  playtimeByDay: ...,
  endDate: Date = new Date(),
  daysBack: number = 365,
): HeatmapCell[][];
```

Couleurs Tailwind dark-friendly :
- 0 : `bg-muted`
- 1 : `bg-emerald-900/30`
- 2 : `bg-emerald-700/50`
- 3 : `bg-emerald-500/70`
- 4 : `bg-emerald-400`

### Playtime chart

Recharts `<AreaChart>` :
- Couleur dégradée
- Tooltip custom avec `formatDuration`
- Pas de grid moche
- Pour year/all : group par semaine

### System distribution

Recharts `<PieChart>` (donut) :
- Top 6 + "Autres"
- Couleurs cohérentes par système
- Click → `/collection/<system>`

### Top games

Liste verticale (pas de chart), top 10 par défaut.
Bouton "Voir plus" → top 50.

### Session timeline

20 dernières sessions, chronologique inverse.
Format : heure + jour relatif + nom + système + durée.

### Streak card

```
🔥 12 jours
consécutifs
Record : 47 jours
```

Si streak en cours : couleur orange/rouge, sinon gris.
Si streak = 0 : "Commence une nouvelle série aujourd'hui !"

### Routing par période

`app/stats/page.tsx` redirige vers `/stats/week`.
`app/stats/[period]/page.tsx` valide period ∈ {week, month, year, all}.

### Cache strategy

```typescript
async function getDashboardStats(period: Period) {
  'use cache';
  cacheTag('dashboard-stats');
  cacheLife('minutes');
  return calculators.getDashboardStats(period);
}
```

### shadcn/ui à installer

- chart, hover-card, scroll-area

### Empty states

Si pas de sessions en DB :
- Heatmap entièrement grise + message "Joue à des jeux pour voir ton activité"
- KPIs à 0 (pas NaN, pas "Infinity%")
- Pas de crash

Ajoute `scripts/seed-fake-sessions.ts` qui génère 200 sessions aléatoires
sur les 90 derniers jours. Flag `--clear` pour wipe le seed.

```json
"scripts": {
  "seed:dev": "tsx scripts/seed-fake-sessions.ts"
}
```

## Tests

`lib/stats/__tests__/calculators.test.ts` :
- formatDuration : 0s, 59s, 60s, 3600s, 86400s, négatifs
- formatRelativeDate : il y a 1 min, 1h, hier, etc.
- calcul streak : edge cases
- getPeriodRange : début/fin de semaine, mois, année

## Performance

- Page Stats < 500ms avec 10k sessions
- Heatmap 365 cells → OK en React. Si > 700 (2 ans), passe en SVG
- Recharts > 365 points : group par semaine

## Contraintes

- Strict TypeScript
- Mode dark ET light
- Mobile-first (375×667 minimum)
- Locale fr-FR par défaut
- Commit final : "feat(stats): playtime dashboard with heatmap and aggregates"

## Workflow

1. Lance le seed pour avoir des données :
   ```bash
   pnpm seed:dev
   ```
2. Implémente dans l'ordre :
   - formatters + tests
   - seed script
   - calculators + tests
   - composants individuels
   - page + sous-routes
   - cache
3. Test sur mobile via DevTools responsive
4. Test des 4 périodes
5. Test du empty state
6. `pnpm build` + Lighthouse rapide
7. Update README : coche Ticket 5, ajoute "Screenshots" section
8. Résume-moi : composants candidats screenshots LinkedIn, soucis de perf, suggestions Ticket 6

Démarre.
```

---


## Ticket 6 — Settings runtime + hot reload

```markdown
# Ticket 6 : Page Settings (configuration runtime sans .env)

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Tickets 1 à 5 sont mergés. Toute la config passe par .env. Inacceptable pour
une app self-hostable : on ne peut pas demander d'éditer un .env et redémarrer.

## Objectifs

1. Table `settings` en DB pour stocker la config persistante
2. `lib/config.ts` refactor : merge .env (defaults) + DB (override) + reactive
3. `app/settings/page.tsx` : UI de configuration
4. `app/api/settings/route.ts` : GET/PUT settings
5. `app/api/settings/test-connection/route.ts` : test live des credentials
6. Reload à chaud des singletons SSH et MQTT
7. Setup wizard au premier lancement

## Architecture de la config

Sources par ordre de priorité :
1. DB settings table (modifié via UI)
2. .env (defaults au premier démarrage)
3. Hardcoded fallbacks

→ ConfigStore (singleton) → SSH/MQTT clients réagissent aux changements

## Détails techniques

### Schema DB

```typescript
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

### Config store

```typescript
export type AppConfig = {
  recalbox: { host, sshUser, sshPassword, sshPort, mqttPort };
  scrobble: { minDurationSec, maxDurationHours, orphanRecoveryHours };
  ui: { locale, theme, weekStartsOn };
};

class ConfigStore extends EventEmitter {
  async init(): Promise<void>;
  get(): AppConfig;
  async update(partial: DeepPartial<AppConfig>): Promise<AppConfig>;
  async reset(scope?: keyof AppConfig): Promise<AppConfig>;
}

export const configStore = new ConfigStore();
```

Events émis : `changed`, `changed:recalbox`, `changed:scrobble`, `changed:ui`.

### Reload à chaud

SSH client et MQTT client subscribent aux events `changed:recalbox` et
reconnectent avec les nouvelles credentials.

⚠️ **Limitation scrobbler** : le daemon tourne dans un process séparé. Polling
DB toutes les 30s pour détecter un changement via `settings.updatedAt`.

```typescript
setInterval(async () => {
  const dbConfig = await loadConfigFromDb();
  if (hasRelevantChange(dbConfig, currentConfig)) {
    await configStore.reload();
  }
}, 30_000);
```

### API routes

**`GET /api/settings`** : retourne config, **masque le password** (`"***"`).

**`PUT /api/settings`** : body Zod-validated. Si `sshPassword === "***"` →
ne pas update (l'utilisateur n'a pas modifié le champ).

**`POST /api/settings/test-connection`** :
- Test SSH : connexion + `echo ok`
- Test MQTT : connexion + subscribe 2 secondes
- Réponse : `{ ssh: {success, latencyMs}, mqtt: {success, latencyMs, messagesReceived}, overall: 'ok'|'partial'|'failed' }`
- Toujours retourne 200, détail dans le body

**`POST /api/settings/reset`** : reset au défaut.

### Validation Zod

```typescript
export const recalboxConfigSchema = z.object({
  host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/),
  sshUser: z.string().min(1).max(32),
  sshPassword: z.string().min(1).max(128),
  sshPort: z.number().int().min(1).max(65535),
  mqttPort: z.number().int().min(1).max(65535),
});
```

### Page Settings

Client Component, tabs : Recalbox | Scrobble | Interface.

Tab Recalbox :
- Host, SSH user, SSH password (avec show/hide), SSH port, MQTT port
- Bouton "Tester la connexion" + résultats
- Boutons Annuler / Enregistrer
- Dirty state : confirmation si navigation

### Wizard premier lancement

Si la table `settings` est vide, middleware Next redirige vers `/welcome`.

`app/welcome/page.tsx` :
- Stepper 3 étapes
- 1. Config Recalbox (champs pré-remplis avec defaults)
- 2. Test connection (avec aide si échec : "vérifier MQTT activé", etc.)
- 3. Confirmation + bouton "Terminer"

Critère "setup done" : row `__setup_completed__ = "true"` dans settings.

### Middleware

`middleware.ts` (ou `proxy.ts` en Next 16+) :
- Vérifie isSetupComplete()
- Routes API toujours accessibles
- Si !setup && pathname !== '/welcome' → redirect /welcome
- Si setup && pathname === '/welcome' → redirect /

⚠️ Note Next 16 : `middleware.ts` peut s'appeler `proxy.ts`. Vérifie la doc.

### shadcn/ui à installer

- form, label, switch, radio-group, sonner (toast), alert-dialog

```bash
pnpm add react-hook-form @hookform/resolvers
```

## Sécurité

Password SSH stocké en clair en DB. Acceptable si :
1. Fichier DB en permissions 600
2. Doc README : app pour réseau local de confiance, pas internet public
3. Avertissement UI

Pas d'auth dashboard dans ce ticket (LAN only).

## Tests

`lib/__tests__/config.test.ts` :
- Init DB vide → defaults .env
- Init avec rows → override
- update() partial garde les non touchés
- update() émet les bons events
- reset() restore defaults
- Password masqué dans GET

## Contraintes

- Strict TypeScript
- Zod schemas SOURCE OF TRUTH
- Hot reload testé
- Scrobbler détecte changements en < 30s
- Wizard ne JAMAIS réapparaître après setup
- Commit final : "feat(settings): runtime configuration with UI and hot-reload"

## Workflow

1. Implémente dans l'ordre :
   - schema settings + migration
   - refactor lib/config.ts en store réactif
   - SSH/MQTT subscribers
   - DB polling scrobbler
   - Zod schemas
   - routes API
   - page settings (3 tabs)
   - middleware + page welcome
2. Tests unitaires (config store, masquage, polling)
3. Vérifie `pnpm build`
4. Tests E2E manuels :
   - Wipe DB → wizard apparaît
   - Complète le wizard
   - Modifie host → enregistre → logs SSH/MQTT reconnexion
   - Démarre scrobbler en parallèle → change config → attends 30s → logs détection
   - Test connection valides puis invalides
5. Update README (sections Configuration et Security)
6. Coche Ticket 6
7. Résume-moi : naming middleware.ts vs proxy.ts en Next 16, alternative au EventEmitter, suggestions Ticket 7

Démarre.
```

---


## Ticket 7 — Docker Compose self-hosting

```markdown
# Ticket 7 : Docker Compose pour self-hosting facile

## Contexte

Lis d'abord README.md et fais `git log --oneline -10` pour te remettre dans le projet.
Tickets 1 à 6 sont mergés. Objectif : installation en 2 commandes max.

```bash
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
docker compose up -d
```

## Objectifs

1. `Dockerfile` multi-stage optimisé pour Next.js 16
2. `docker-compose.yml` à la racine, prêt user final
3. Image qui run dashboard + scrobbler dans le même container (s6-overlay)
4. Volume persistant pour DB SQLite
5. Healthcheck Docker
6. Image multi-arch (amd64 + arm64)
7. GitHub Actions pour build + publier sur ghcr.io
8. Documentation complète

## Architecture container

**Un seul container avec 2 process** (dashboard + scrobbler) gérés par s6-overlay.

Pourquoi un container :
- Partage DB SQLite (file-based)
- Même config
- User-friendly pour le self-hosting

Process manager : **s6-overlay** (standard de fait, utilisé par LinuxServer.io).

## Dockerfile

Multi-stage : deps → builder → runner.

Runner basé sur `node:22-alpine`.

```dockerfile
# Standalone Next.js
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# s6-overlay install (multi-arch via TARGETARCH)
ARG S6_OVERLAY_VERSION=3.2.0.0

# Non-root user (dashboard, UID 1001)

# Copy from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle

# s6 services
COPY docker/s6-rc.d /etc/s6-overlay/s6-rc.d
COPY docker/init.sh /init.sh

ENV DATABASE_URL=/data/recalbox-dashboard.db
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/init"]
```

## s6 services

`docker/s6-rc.d/user/contents.d/` contient :
- `dashboard`
- `scrobbler`

Chaque service a un dossier `run` qui lance le process avec `s6-setuidgid dashboard`.

Dépendance : `scrobbler → dashboard` (le dashboard run les migrations DB au boot).

## docker-compose.yml (user-facing)

```yaml
services:
  recalbox-dashboard:
    image: ghcr.io/m-meddah/recalbox-dashboard:latest
    container_name: recalbox-dashboard
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - recalbox-data:/data
    environment:
      RECALBOX_HOST: recalbox.local
      RECALBOX_SSH_USER: root
      RECALBOX_SSH_PASSWORD: recalboxroot
      RECALBOX_SSH_PORT: 22
      RECALBOX_MQTT_PORT: 1883
      TZ: Europe/Paris

volumes:
  recalbox-data:
```

## docker-compose.dev.yml

Pour contributeurs, avec hot reload :
```yaml
services:
  recalbox-dashboard-dev:
    build:
      context: .
      target: builder
    ports: ["3000:3000"]
    volumes:
      - .:/app
      - /app/node_modules
      - /app/.next
    command: pnpm dev
```

## .dockerignore

```
node_modules
.next
.git
.env
.env.local
data/
*.log
.DS_Store
.idea
.vscode
coverage/
docs/
.github/
docker-compose*.yml
Dockerfile
.dockerignore
```

## next.config.ts

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
  // ...
};
```

Sans `standalone`, l'image fait 800 MB+. Avec, ~250 MB.

## Healthcheck endpoint

`app/api/health/route.ts` :
```typescript
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
  });
}
```

Simple : si Next répond, c'est OK. Diagnostics plus profonds dans `/api/scrobbler/health`.

## GitHub Actions

`.github/workflows/docker-build.yml` :
- Triggers : push main, push tags v*, PR main
- Buildx + QEMU pour multi-arch
- Tags :
  - `latest` depuis main
  - `vX.Y.Z` depuis git tags semver
- Publish sur ghcr.io
- Cache GitHub Actions

## Documentation README

```markdown
## Installation

### With Docker (recommended)

curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
nano docker-compose.yml  # Edit RECALBOX_HOST if needed
docker compose up -d

Open http://localhost:3000 and follow the setup wizard.

Works on: x86_64, ARM64 (Pi 4/5, Apple Silicon, ARM NAS).

### Updating
docker compose pull && docker compose up -d

### Backup
docker run --rm -v recalbox-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-$(date +%Y%m%d).tar.gz /data
```

Crée `CONTRIBUTING.md` minimaliste + `docs/deployment.md` (Synology, Unraid, Traefik).

## Sécurité

- Run non-root (UID 1001)
- Pas de capabilities ajoutées
- Pas d'expose autre que 3000
- Healthcheck pour restart auto

## Targets de performance

- Image finale < 250 MB compressée
- Boot < 10s
- Mémoire idle < 150 MB

## Tests

Tests manuels obligatoires :
1. `docker build -t test .` succès
2. `docker compose up` < 30s, healthcheck < 60s
3. Wizard premier lancement
4. Toutes les pages fonctionnent
5. `docker compose restart` → DB persiste
6. Multi-arch : `docker buildx build --platform linux/amd64,linux/arm64 .`

## Contraintes

- Alpine sauf si better-sqlite3 ne compile pas (alors debian-slim)
- Pas de secrets dans l'image
- Pas de modification du host
- Multi-arch obligatoire
- Tags `latest` uniquement depuis main
- Commit final : "feat(docker): containerized deployment with s6 + multi-arch CI"

## Workflow

1. Vérifie `output: 'standalone'` dans next.config.ts
2. Crée Dockerfile + .dockerignore
3. Crée tree docker/s6-rc.d/ + docker/init.sh
4. Crée docker-compose.yml et docker-compose.dev.yml
5. Test local : `docker build -t recalbox-dashboard:dev .`
   Erreurs courantes :
   - better-sqlite3 ne compile pas alpine → `apk add python3 make g++`
   - s6 ne démarre pas → permissions scripts run
6. Test runtime : vérifier les 2 services + healthcheck + wizard browser
7. GitHub Actions workflow
8. Push branche feature/docker → workflow OK ?
9. Update README + CONTRIBUTING + docs/deployment
10. Merge sur main → publication `:latest`
11. Coche Ticket 7
12. Résume-moi : taille image, boot time, mémoire idle, surprises s6/better-sqlite3/multi-arch

Démarre.
```

---


## Ticket 8 — Internationalisation (FR + EN)

```markdown
# Ticket 8 : Internationalisation FR/EN

## Contexte

Lis d'abord README.md et fais `git log --oneline -10`.
Tickets 1 à 7 mergés. Dashboard 100% français hardcodé.

Stratégie : FR + EN. Archi qui permet d'ajouter ES/DE/IT/PT par PR sans refactor.

## Objectifs

1. `next-intl` (mature pour Next 16 App Router)
2. Détection auto via `Accept-Language`
3. Override manuel via Settings (Ticket 6)
4. Catalogue FR + EN complets
5. Routing localisé `/fr/...` et `/en/...`
6. Formatage dates/nombres/durées selon locale
7. Doc contributeurs pour ajouter une langue

## Décisions

- **next-intl** : maintenu, App Router first, type-safe
- **Préfixe URL** plutôt que cookie : SEO + cohérence des liens partagés
- **EN par défaut** : audience cible majoritaire anglophone

## Détails techniques

### Installation

```bash
pnpm add next-intl
```

### Structure

```
recalbox-dashboard/
├── messages/
│   ├── en.json
│   └── fr.json
├── i18n/
│   ├── routing.ts
│   ├── request.ts
│   └── navigation.ts
└── app/[locale]/
    ├── layout.tsx
    └── ... (toutes les pages migrées)
```

⚠️ Migration majeure : toutes les pages sous `app/[locale]/`. Les routes
`api/` restent à la racine, non localisées.

### i18n/routing.ts

```typescript
export const routing = defineRouting({
  locales: ['en', 'fr'] as const,
  defaultLocale: 'en',
  localePrefix: 'always',
});
```

### i18n/request.ts

```typescript
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: 'Europe/Paris',
    now: new Date(),
  };
});
```

### Wrappers navigation (i18n/navigation.ts)

```typescript
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

Tous les `Link from 'next/link'` → `Link from '@/i18n/navigation'`.

### next.config.ts

```typescript
import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(nextConfig);
```

### Middleware (combine i18n + setup wizard)

Le middleware doit gérer les deux : i18n routing + redirect setup wizard.

```typescript
import createMiddleware from 'next-intl/middleware';
const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) {
    return NextResponse.next();
  }
  const response = intlMiddleware(request);
  // ... logique setup wizard adaptée à la locale
  return response;
}
```

### Catalogue de traductions

Structure organisée par feature :

```json
{
  "common": { "save": "Save", "cancel": "Cancel", ... },
  "nav": { "dashboard": "Dashboard", ... },
  "dashboard": { "nowPlaying": { "title": "Now Playing", ... } },
  "collection": {
    "stats": {
      "totalGames": "{count, plural, =0 {No games} one {1 game} other {# games}}",
    }
  },
  "stats": { ... },
  "settings": { ... },
  "welcome": { ... },
  "time": {
    "minutesAgo": "{minutes, plural, one {1 minute ago} other {# minutes ago}}",
    "duration": {
      "seconds": "{seconds}s",
      "hoursMinutes": "{hours}h{minutes}"
    }
  }
}
```

ICU plural syntax obligatoire.

### Utilisation

Server Component :
```typescript
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('stats');
return <h1>{t('title')}</h1>;
```

Client Component :
```typescript
'use client';
import { useTranslations } from 'next-intl';
const t = useTranslations('stats.kpi');
```

Interpolation :
```typescript
t('streak.days', { count: 12 })
```

### Formatage

Refactor `lib/stats/formatters.ts` pour utiliser next-intl :

```typescript
const format = useFormatter();
format.dateTime(date, { dateStyle: 'long' });
format.relativeTime(date);
format.number(1234.5);
```

### Language switcher

```typescript
'use client';
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select value={locale} onValueChange={(loc) => router.replace(pathname, { locale: loc })}>
      <SelectItem value="en">🇬🇧 English</SelectItem>
      <SelectItem value="fr">🇫🇷 Français</SelectItem>
    </Select>
  );
}
```

Override dans Settings > UI tab.

### Migration des composants

Tous les composants des Tickets 1-7 doivent être migrés :
1. Strings hardcodées → `t('clé')`
2. `Link from 'next/link'` → `Link from '@/i18n/navigation'`
3. `useRouter from 'next/navigation'` → `useRouter from '@/i18n/navigation'`
4. Adapter à `useTranslations` (client) ou `await getTranslations()` (server)

Procède feature par feature.

### Type safety

```typescript
// types/i18n.d.ts
import type messages from '../messages/en.json';
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof messages;
    Locale: 'en' | 'fr';
  }
}
```

## Doc contributeurs

`docs/contributing-translations.md` :

1. Copier `messages/en.json` → `messages/<locale>.json`
2. Traduire toutes les strings (garder ICU + placeholders)
3. Ajouter la locale dans `i18n/routing.ts`
4. Ajouter le flag dans le language switcher
5. Tester `http://localhost:3000/<locale>`
6. PR avec screenshots

## Tests

`__tests__/i18n.test.ts` :
- Toutes les locales ont les mêmes clés
- Aucune string vide
- Placeholders préservés entre locales

## Contraintes

- Strict TypeScript
- Aucun string hardcodé restant (sauf logs serveur)
- Routes API non localisées
- Wizard premier lancement fonctionne FR + EN
- Commit final : "feat(i18n): English + French support with next-intl"

## Workflow

1. `pnpm add next-intl`
2. Setup base : i18n/routing.ts, request.ts, navigation.ts
3. Migration structure : pages → `app/[locale]/`, garder `app/api/`
4. Middleware merge
5. Catalogue en.json complet (extraire toutes les strings)
6. Migration composants : simples → pages → formulaires
7. Traduction fr.json
8. Language switcher + Settings UI tab
9. Tests intégrité
10. Doc contributeurs + README badge
11. Vérifs :
    - `pnpm build`
    - `pnpm dev` : test `/`, `/fr/`, `/en/`
    - Wizard FR et EN
    - `Accept-Language: fr-FR` → redirect /fr/
12. Update README + coche Ticket 8
13. Résume-moi : nb strings, soucis next-intl + Next 16, langues prioritaires Ticket 8.1

Démarre.
```

---


## Ticket 9 — RetroAchievements integration

```markdown
# Ticket 9 : Intégration RetroAchievements

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-8 mergés.

## ⚠️ Info critique : credentials

- **Recalbox** stocke username + password dans `/recalbox/share/system/recalbox.conf`
  (clés `global.retroachievements.username` et `.password`)
- **L'API RA** n'utilise PAS le password user. Elle utilise une **web API key**
  que l'utilisateur génère sur https://retroachievements.org/controlpanel.php

Donc :
- ✅ Auto-récupérer le `username` depuis `recalbox.conf` via SSH
- ❌ Le password recalbox.conf ne sert pas pour l'API
- 🔑 L'utilisateur DEVRA fournir sa web API key une fois

UX : pré-remplir username, demander API key avec lien direct vers la page RA.

## Objectifs

1. Auto-détection du username RA depuis `recalbox.conf` via SSH
2. Configuration de l'API key dans Settings (nouvel onglet "RetroAchievements")
3. Client API RA (`@retroachievements/api` officiel)
4. Page `/achievements` (profil, derniers unlocks, heatmap, top jeux)
5. Intégration dans la collection (badges sur jaquettes)
6. Polling périodique (background job dans scrobbler)
7. Cache aggressive

## Détails techniques

### Lecture recalbox.conf

`lib/recalbox/conf-reader.ts` :
```typescript
export async function readRecalboxConfValue(key: string): Promise<string | null>;
export async function readRecalboxConfValues(keys: string[]): Promise<Record<string, string | null>>;
```

**Whitelist stricte** des clés autorisées (sécurité) :
```typescript
const ALLOWED_CONF_KEYS = [
  'global.retroachievements.username',
  'global.retroachievements',
  'global.retroachievements.hardcore',
  // PAS de password, JAMAIS
] as const;
```

Route API :
**`GET /api/recalbox/conf?key=global.retroachievements.username`** :
- 403 si pas whitelistée
- Cache 60s

### Stockage API key

Étend le settings store :
```typescript
retroachievements: {
  enabled: boolean;
  username: string;
  apiKey: string;          // masqué dans GET /api/settings
  autoSyncMinutes: number;
};
```

### Client API RA

```bash
pnpm add @retroachievements/api
```

```typescript
import { buildAuthorization } from '@retroachievements/api';

let cachedAuth: ReturnType<typeof buildAuthorization> | null = null;
export function getAuth() {
  const config = configStore.get();
  if (!cachedAuth) {
    cachedAuth = buildAuthorization({
      username: config.retroachievements.username,
      webApiKey: config.retroachievements.apiKey,
    });
  }
  return cachedAuth;
}

configStore.on('changed:retroachievements', () => { cachedAuth = null; });
```

### Rate limiting

```typescript
import PQueue from 'p-queue';
export const raQueue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 });
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  return raQueue.add(fn) as Promise<T>;
}
```

### Cache en DB

```typescript
export const raCache = sqliteTable('ra_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});
```

TTL différenciés :
- userProfile : 1h
- recentAchievements : 5 min
- gameProgress : 30 min
- gameMetadata : 24h

### Service layer

```typescript
export async function getProfile(): Promise<RaProfile>;
export async function getRecentAchievements(count?: number): Promise<RaAchievement[]>;
export async function getAllGameProgress(): Promise<RaGameProgress[]>;
export async function getGameProgress(gameId: number): Promise<RaGameProgress | null>;
export async function findRaGameForRom(romPath: string, system: string): Promise<number | null>;
```

### Matching ROM → RA game

**Stratégie : fuzzy match titre + console** (best effort, 80-90%).

```typescript
const SYSTEM_TO_RA_CONSOLE_ID: Record<string, number> = {
  snes: 3,
  megadrive: 1,
  nes: 7,
  gba: 5,
  // ...
};
```

Levenshtein normalisée sur les titres. Liste complète des console IDs via
`getConsoleIds()` de l'API RA.

Bouton "Lier manuellement" pour les 10-20% non matchés.

### Background sync

**Intégré au scrobbler daemon** (Ticket 4) :

```typescript
setInterval(async () => {
  if (!configStore.get().retroachievements.enabled) return;
  try { await syncRetroAchievements(); }
  catch (err) { logger.error({ err }, 'RA sync failed'); }
}, configStore.get().retroachievements.autoSyncMinutes * 60 * 1000);
```

### Schema DB

```typescript
export const raAchievements = sqliteTable('ra_achievements', {
  id: integer('id').primaryKey(),
  gameId: integer('game_id').notNull(),
  title: text('title').notNull(),
  points: integer('points').notNull(),
  imageUrl: text('image_url').notNull(),
  unlockedAt: integer('unlocked_at', { mode: 'timestamp' }).notNull(),
  isHardcore: integer('is_hardcore', { mode: 'boolean' }).default(false),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

export const raGameProgress = sqliteTable('ra_game_progress', { ... });
export const raGameMapping = sqliteTable('ra_game_mapping', {
  romPath: text('rom_path').primaryKey(),
  raGameId: integer('ra_game_id').notNull(),
  matchKind: text('match_kind').notNull(),  // 'auto' | 'manual'
});
```

### Page Achievements

- Header : avatar, points, rang, motto
- Heatmap unlock par jour (365 jours)
- Derniers succès débloqués (20)
- Top jeux par progression
- États : pas configuré / pas syncé / erreur / OK

### Settings tab "RetroAchievements"

- ☐ Activer
- Username (auto-rempli depuis recalbox.conf, bouton 🔄 refetch)
- Web API key (avec show/hide + lien direct vers control panel RA)
- Intervalle de sync
- Bouton "Tester la connexion"

### Integration collection

Badge sur coin jaquette si succès débloqués pour ce jeu.

### Routes API

- `GET /api/retroachievements/profile`
- `GET /api/retroachievements/recent?count=20`
- `GET /api/retroachievements/progress`
- `GET /api/retroachievements/game/:id`
- `POST /api/retroachievements/sync` (force)
- `POST /api/retroachievements/test-connection`
- `POST /api/retroachievements/match/:romPath`

### Traductions

Section `retroachievements` complète dans en.json + fr.json.

## Sécurité

- API key en clair en DB (comme password SSH)
- Password recalbox.conf JAMAIS lu (whitelist)
- API key jamais loggée
- GET /api/settings masque l'API key

## Tests

`lib/retroachievements/__tests__/service.test.ts` :
- Mock client RA
- Test matching ROM → game
- Test cache (TTL, invalidation)
- Test rate limiter

`lib/recalbox/__tests__/conf-reader.test.ts` :
- Parsing différents formats
- Whitelist (refus clés non autorisées)

## Contraintes

- Strict TypeScript
- App fonctionne sans RA configuré (état "désactivé" propre)
- Sync ne bloque jamais le scrobbler
- Si API down, dégrader gracieusement (cache stale)
- Commit final : "feat(ra): RetroAchievements integration with auto-username detection"

## Workflow

1. Demande-moi sortie de `grep retroachievements /recalbox/share/system/recalbox.conf`
   (sans le password, juste username + autres clés)
2. Implémente dans l'ordre :
   - conf-reader + whitelist + route API
   - Schema DB + migrations
   - Config store extension
   - Client RA + rate limiter + cache
   - Service layer
   - Routes API
   - Settings tab UI
   - Page Achievements
   - Integration scrobbler (sync periodique)
   - Integration collection
   - Traductions FR + EN
3. Vérifie `pnpm build`
4. Tests manuels avec ta vraie API key
5. Update README : section "RetroAchievements integration"
6. Coche Ticket 9
7. Résume-moi : % réussite fuzzy match, soucis rate limiting, suggestions matching

Démarre par demander la sortie `grep retroachievements`.
```

---


## Ticket 10 — Super Retrogamers integration

```markdown
# Ticket 10 : Intégration Super Retrogamers (cross-projet)

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-9 mergés.

Pont entre ce dashboard et **Super Retrogamers** (super-retrogamers.com) :
encyclopédie de jeux rétro. Depuis le dashboard, on peut consulter la fiche
encyclopédique de chaque jeu.

⚠️ Ce ticket dépend d'une **API côté Super Retrogamers qui n'existe pas encore**.
On désigne l'API ici, à implémenter ensuite côté SR.

## Stratégie

Deux niveaux :

**Niveau 1** : Lien externe (90% du gain, 10% du travail)
- Bouton "Voir sur Super Retrogamers"
- URL `https://super-retrogamers.com/games/<slug>`

**Niveau 2** : Preview enrichie dans le dashboard
- API publique sur SR retourne JSON
- Dashboard fetche et affiche specs/verdict en preview
- Cache local Drizzle

Niveau 1 garanti, Niveau 2 "best effort" (fallback au lien si API indispo).

## Objectifs

1. Slug matching algorithm (partageable entre projets)
2. Composant `<SuperRetrogamersLink>` réutilisable
3. Spécification API SR (markdown)
4. Client API côté dashboard avec fallback gracieux
5. Composant preview de fiche jeu
6. Indicateur "fiche disponible" dans la grille
7. Page settings pour activer/désactiver

## Détails techniques

### Slug matching

`lib/super-retrogamers/slug.ts` :
```typescript
export function gameToSlug(name: string, system: string): string;
export function slugToParts(slug: string): { system: string; name: string };
export const SR_SYSTEM_SLUGS: Record<string, string> = {
  snes: 'super-famicom',
  megadrive: 'mega-drive',
  // ...
};
```

⚠️ Demande-moi le mapping exact des slugs système utilisés sur SR
avant d'implémenter (snes vs super-famicom vs sfc).

Règles :
1. Lowercase
2. Remplace caractères spéciaux (é → e)
3. Retire region tags ((U), (E), (J), [!])
4. Retire version markers (v1.0, Rev A)
5. Espaces/underscores → dashes
6. Collapse multiple dashes
7. Préfixe avec system slug

### Spec API SR

Crée `docs/super-retrogamers-api-spec.md` qui décrit l'API que SR doit exposer.

Endpoints :
- `GET /api/v1/games/exists?slug=...` : check existence sans payload
- `GET /api/v1/games/:slug` : full data
- `POST /api/v1/games/lookup` : bulk lookup (max 100 slugs)
- `GET /api/v1/systems` : liste des systèmes covered

CORS `*` requis. Caching avec Cache-Control.

### Client API

`lib/super-retrogamers/client.ts` :
```typescript
const BASE_URL = process.env.SUPER_RETROGAMERS_API_URL
  ?? 'https://super-retrogamers.com/api/v1';

export class SuperRetrogamersClient {
  async checkExists(slug: string): Promise<{ exists: boolean; url?: string }>;
  async getGame(slug: string): Promise<SrGame | null>;
  async bulkLookup(slugs: string[]): Promise<...>;
  async listSystems(): Promise<SrSystem[]>;
}
```

- Timeout 5s
- Retry 1 fois avec backoff 500ms
- Erreur définitive → return null/false (graceful degradation)

### Cache DB

```typescript
export const srCache = sqliteTable('sr_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});
```

TTL :
- exists:* : 24h
- game:* : 12h
- systems:* : 7 jours

### Population table games

Étend la table `games` :
```sql
ALTER TABLE games ADD COLUMN sr_slug TEXT;
ALTER TABLE games ADD COLUMN sr_has_page INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN sr_url TEXT;
ALTER TABLE games ADD COLUMN sr_checked_at INTEGER;
```

Lors du sync collection :
1. Génère `sr_slug` avec `gameToSlug()`
2. Bulk lookup sur SR API (batch 100)
3. Update `sr_has_page` / `sr_url`

Mode "background enrich" : si 5000 jeux, lance en arrière-plan après sync.

### Composant SuperRetrogamersLink

```typescript
type Props = {
  romPath: string;
  gameName: string;
  system: string;
  variant?: 'button' | 'icon' | 'badge';
};
```

- Si `sr_has_page === true` → lien direct
- Si false → désactivé avec tooltip
- Si null (jamais checked) → bouton "Vérifier"

### Preview enrichie

`components/super-retrogamers-preview.tsx` (client) :
- Fetch via route Next proxy
- États : loading / error / not-found / loaded
- Affiche : verdict (score + résumé), specs, characters
- CTA "Lire l'article complet ↗"

### Routes API (proxy)

**`GET /api/super-retrogamers/games/:slug`** :
- Vérifie cache local sr_cache
- Si miss : fetch SR, store, retourne
- Si SR down : retourne cache même expiré + flag `stale: true`

**`POST /api/super-retrogamers/lookup`** :
- Bulk lookup
- Update sr_* dans table games

**`POST /api/super-retrogamers/enrich-collection`** :
- Job streamé NDJSON
- Idempotent (skip jeux déjà vérifiés)

### Settings tab "Intégrations"

Nouveau 5ème tab :
- ☑ Activer l'intégration
- URL API (override optionnel)
- Bouton "Tester la connexion"
- Bouton "Enrichir la collection maintenant"
- Stats : "X jeux • Y référencés sur SR"

### Intégrations dans pages existantes

- **Collection grid** : badge SR coin jaquette si page disponible
- **Fiche jeu modal** : onglet "Super Retrogamers" avec preview
- **Stats > TopGames** : mini lien SR sous chaque entrée
- **Now Playing** : bouton "Lire la fiche du jeu" si dispo

## Stratégie de rollout

**Phase 1 (ce ticket)** : tout côté dashboard. Client en mode mock retourne
toujours `{ exists: false }`. UI en place mais inopérante.

**Phase 2 (après)** : implémentation API côté super-retrogamers.com selon spec.

**Phase 3 (bonus)** : extraction `gameToSlug()` en package npm `@super-retrogamers/slug`.

## Tests

`lib/super-retrogamers/__tests__/slug.test.ts` :
- 20+ cas réels (Mario, Final Fantasy VI, Castlevania SOTN [!], caractères
  accentués, japonais, apostrophes, chiffres en tête)
- Réversibilité partielle slugToParts

`lib/super-retrogamers/__tests__/client.test.ts` :
- Mock fetch : success / 404 / 500 / timeout / network error
- Retry logic
- Graceful degradation

### Traductions

Section `superRetrogamers` dans en.json + fr.json.

## Contraintes

- Intégration totalement désactivable sans casser le reste
- Si API SR down, AUCUNE page ne casse ou ralentit
- Slug matching déterministe et idempotent
- Aucun appel SR depuis le client browser (toujours via proxy Next)
- Strict TypeScript
- Commit final : "feat(integration): Super Retrogamers cross-project linking"

## Workflow

1. Demande-moi :
   - Mapping exact slugs système SR
   - Exemples URLs SR existantes pour calibrer gameToSlug()
2. Implémente :
   - gameToSlug() + tests
   - Schema DB extensions (sr_*, sr_cache)
   - Mode mock du client (hardcoded `{ exists: false }`)
   - Service + routes API proxy
   - Composant SuperRetrogamersLink (3 variantes)
   - Composant SuperRetrogamersPreview
   - Intégrations (collection, modal, stats, now playing)
   - Settings tab "Intégrations"
   - Job enrichissement NDJSON
   - Spec API en markdown
   - Traductions FR + EN
3. Vérifie `pnpm build`
4. Tests : active, lance enrichissement (0% en mock), force exists=true côté
   mock pour tester rendu UI, désactive et vérifie nettoyage
5. Update README + lien vers `docs/super-retrogamers-api-spec.md`
6. Coche Ticket 10
7. Résume-moi : mapping système final, edge cases gameToSlug, suggestions Phase 2

Démarre par demander le mapping système.
```

---


## Ticket 11 — Recalbox Wrapped (résumé annuel)

```markdown
# Ticket 11 : Recalbox Wrapped (résumé annuel partageable)

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-10 mergés.

Feature la plus "fun" et viralisable : un résumé annuel style Spotify Wrapped,
parcourable en mode story, partageable en images PNG.

Triple objectif : UX engageante / viralité / démonstration technique.

Inspiration : Spotify Wrapped + Letterboxd Year in Review + WakaTime.

## Objectifs

1. Page `/wrapped/:year` accessible toute l'année
2. 8-11 slides narratives
3. Animations View Transitions React 19.2
4. Mode story mobile-first : tap pour avancer, swipe pour reculer
5. Génération PNG partageable via `next/og`
6. Bouton "Partager" sur chaque slide
7. Page d'archive `/wrapped`
8. Easter egg unlocks selon stats

## Détails techniques

### Stack

- **`next/og`** (built-in Next.js) pour images PNG via React/Satori
- Ultra-léger ~50ms par image, marche sur ARM64
- Limitations : subset CSS, polices à charger explicitement

### Architecture des slides

```
app/[locale]/wrapped/
├── page.tsx                    # /wrapped : archive
├── [year]/
│   ├── page.tsx                # viewer story-mode
│   ├── layout.tsx              # fullscreen
│   └── share/[slide]/route.tsx # PNG slide
```

### Structure Wrapped

```typescript
export type Wrapped = {
  year: number;
  generatedAt: Date;
  user: { pseudo?: string };
  slides: WrappedSlide[];
  unlocks: WrappedUnlock[];
};

export type WrappedSlideType =
  | 'intro' | 'total-time' | 'most-played-game'
  | 'top-system' | 'top-games-list' | 'longest-session'
  | 'busiest-day' | 'streak' | 'achievements-summary'
  | 'comparison-vs-others' | 'outro';
```

### Slides détaillées

1. **Intro** : "Voici ton année 2026"
2. **Total Time** : "127h de jeu" + compteur animé + comparaison rigolote
3. **Most Played Game** : jaquette + nom + temps + sessions
4. **Top System** : logo + % temps + donut breakdown
5. **Top 5 Games** : podium animé
6. **Longest Session** : "Ta plus longue partie : 4h12 sur Zelda OoT"
7. **Busiest Day** : "Ton jour le plus actif : Samedi 14 février"
8. **Streak** : record + mini-heatmap
9. **Achievements** (si RA activé) : nb débloqués, score, plus rare
10. **Comparison** : "Top X% les plus actifs" (moyennes hardcodées, pas de télémétrie)
11. **Outro** : merci + share + archive

### Easter eggs / Unlocks

```typescript
type WrappedUnlock = {
  id: string;
  title: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
};
```

Exemples :
- **Insomniaque** (uncommon) : > 10% playtime entre 0h-4h
- **Speedrunner** (rare) : > 30 sessions < 15 min
- **Marathon Man** (rare) : ≥ 1 session > 5h
- **Diversifié** (uncommon) : > 15 systèmes différents
- **Monogame** (legendary) : > 50% temps sur 1 jeu
- **Touche-à-tout** (uncommon) : > 100 jeux différents
- **Lève-tôt** (uncommon) : > 30% playtime 5h-9h
- **Weekend Warrior** (common) : > 70% playtime sam/dim
- **Throwback Thursday** (uncommon) : régulier sur jeux > 20 ans
- **Achievement Hunter** (rare) : > 100 succès RA dans l'année
- **Hardcore** (legendary) : > 80% succès RA en hardcore

### Calcul

`lib/wrapped/generator.ts` :
```typescript
export async function generateWrapped(year: number, locale: string): Promise<Wrapped>;
```

Pure function. Queries SQL agrégées en parallèle (Promise.all).

Cache en DB :
```typescript
export const wrappedCache = sqliteTable('wrapped_cache', {
  year: integer('year'),
  locale: text('locale'),
  data: text('data').notNull(),
  generatedAt: integer('generated_at', { mode: 'timestamp' }).notNull(),
});
```

Recalcule auto :
- Année courante ET vieille de > 24h
- Sur clic "Régénérer"
- Années passées : jamais (figées)

### Story-mode viewer

Client Component :
- Plein écran no nav
- Tap droite = next, gauche = previous
- Swipe mobile
- Auto-advance optionnel (5s)
- Indicateurs progression style Instagram

Animations :
- View Transitions API (React 19.2)
- Anim d'entrée différente par slide
- Compteur incrémental sur total-time
- Heatmap qui se remplit jour par jour

```bash
pnpm add motion
```

### Génération image PNG

```typescript
import { ImageResponse } from 'next/og';

export async function GET(req, { params }) {
  const wrapped = await getWrapped(parseInt(params.year));
  const slide = wrapped.slides[parseInt(params.slide)];
  return new ImageResponse(
    <SlideImage slide={slide} wrapped={wrapped} />,
    { width: 1080, height: 1920 },
  );
}
```

Formats supportés via query param :
- `?format=story` → 1080×1920 (Instagram/TikTok story)
- `?format=square` → 1080×1080 (Instagram post)
- `?format=landscape` → 1200×630 (Twitter/LinkedIn)

Design :
- Watermark "github.com/m-meddah/recalbox-dashboard"
- Palette cohérente avec dashboard
- Police custom (Inter ou similaire dans `/assets/fonts/`)

### Composant ShareDialog

- Format selector (story/square/landscape)
- Preview pré-chargée
- Web Share API si dispo, sinon download
- File via `navigator.share({ files: [file] })`

### Animation compteur (exemple emblématique)

```typescript
function AnimatedHours({ target }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const duration = 2000, steps = 60;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setCurrent(Math.min(target, target / steps * i));
      if (i >= steps) clearInterval(interval);
    }, duration / steps);
    return () => clearInterval(interval);
  }, [target]);
  return <span className="text-9xl font-black">{Math.floor(current)}</span>;
}
```

### Page archive /wrapped

Liste années disponibles :
- Année + KPI principal "127h jouées"
- Date génération
- Bouton "Revoir"

Année "disponible" si :
- ≥ 1 session ET (année passée OU après 1er décembre année en cours)

### Preview /stats

Petit composant en haut de /stats :
"📊 Ton Wrapped 2026 prend forme - 127h • 23 jeux • Mario en tête → Voir mon Wrapped en cours"

### Vie privée

Slide Comparison : **moyennes hardcodées** (pas de télémétrie).
Documenter dans le code : "Chiffres estimés, pas de tracking".

### Traductions

Section `wrapped` complète FR + EN (beaucoup de strings).

## Performance

- Génération Wrapped : < 1s
- Image PNG : < 200ms
- Cache navigateur 1h
- Pré-génération images en background au premier accès

## Tests

`lib/wrapped/__tests__/generator.test.ts` :
- Tous les unlocks avec données mockées
- Edge cases : 0 session, 1 session, 1 seul jeu joué
- Toutes les slides retournent data valide même avec collection partielle
- Fallbacks : RA pas activé → slide achievements skippée

## Contraintes

- Strict TypeScript
- Mobile-first
- 60 FPS sur mobile bas-de-gamme
- Mode dark obligatoire
- Toutes localisées
- Skip propre des slides sans data
- Si 0 sessions année : page fallback "Aucune donnée, joue et reviens !"
- Unlocks déterministes
- Commit final : "feat(wrapped): annual recap with shareable images"

## Polices custom

`lib/wrapped/fonts.ts` :
```typescript
export async function getInterFont() {
  return readFile(path.join(process.cwd(), 'assets/fonts/Inter-Bold.ttf'));
}
```

## Workflow

1. Install `motion`, vérifier `next/og` dispo
2. Implémente :
   - Schema DB (wrapped_cache)
   - generator.ts + tests unitaires
   - Unlocks logic + tests
   - Routes API
   - Page archive
   - Layout fullscreen
   - Page story-mode + composants slide
   - Animations
   - Route image PNG
   - ShareDialog
   - Preview /stats
   - Polices
   - Traductions FR + EN
3. Vérifie `pnpm build`
4. Tests manuels :
   - Génère ta wrapped 2026 (partielle)
   - Navigation 11 slides
   - 3 formats PNG → ouvre, vérifie joli
   - "Partager" → Web Share API ou download
   - Mobile 375×667 nav par tap/swipe
   - Désactive RA → slide achievements skippée
   - Wipe DB sessions → fallback no data
5. Update README : section "Wrapped" + screenshot/GIF
6. Coche Ticket 11
7. Résume-moi : slides candidates LinkedIn, perfs, soucis next/og, unlocks supplémentaires

Démarre.
```

---


## Ticket 12 — Push notifications temps réel

```markdown
# Ticket 12 : Notifications push temps réel pour les achievements

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-11 mergés.

Quand l'utilisateur joue et débloque un succès RA, son téléphone/laptop sonne
avec une notification, même si dashboard fermé. Effet "PlayStation trophy popup".

## Stratégie

Deux niveaux :

**Niveau 1 - In-page (dashboard ouvert)** : toast via SSE existant.
**Niveau 2 - Web Push (dashboard fermé)** : Web Push API avec permission.

Ce ticket fait les 2.

## Objectifs

1. Détection nouveaux achievements dans sync RA (Ticket 9)
2. Système événements `notifications.created`
3. Push in-page via SSE existant
4. Web Push API server-side (VAPID, subscriptions DB)
5. Service Worker pour réception push background
6. UI gestion notifications dans Settings
7. Centre notifications (cloche header)
8. Préférences par type

## Détails techniques

### Types d'événements

```typescript
export type NotificationEvent =
  | { type: 'achievement.unlocked'; data: AchievementUnlockedData }
  | { type: 'game.started'; data: GameStartedData }
  | { type: 'streak.milestone'; data: StreakMilestoneData }
  | { type: 'wrapped.available'; data: WrappedAvailableData }
  | { type: 'system.alert'; data: SystemAlertData };
```

### Préférences

```typescript
export type NotificationPreferences = {
  enabled: boolean;
  inApp: boolean;
  webPush: boolean;
  types: {
    achievementUnlocked: boolean;       // défaut: true
    achievementHardcoreOnly: boolean;
    gameStarted: boolean;                // défaut: false (verbeux)
    streakMilestone: boolean;            // défaut: true
    wrappedAvailable: boolean;           // défaut: true
    systemAlerts: boolean;               // défaut: true
  };
  quietHours: { enabled: boolean; startHour: number; endHour: number };
};
```

### Schema DB

```typescript
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  data: text('data').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  readAt: integer('read_at', { mode: 'timestamp' }),
  pushedInApp: integer('pushed_in_app', { mode: 'boolean' }).default(false),
  pushedWeb: integer('pushed_web', { mode: 'boolean' }).default(false),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }).notNull(),
});
```

### Détection achievements

Étend `lib/scrobbler/ra-sync.ts` (Ticket 9) :
```typescript
for (const ach of newAchievements) {
  await db.insert(raAchievements).values(ach);
  if (ach.unlockedAt > lastSyncedAt) {
    await notificationService.create({
      type: 'achievement.unlocked',
      data: { ... },
    });
  }
}
```

### Service notification

```typescript
class NotificationService extends EventEmitter {
  async create(event: NotificationEvent): Promise<Notification> {
    const prefs = await getPreferences();
    if (!shouldNotify(event, prefs)) return null;
    if (isInQuietHours(prefs)) {
      // stocke mais pas push
    }
    const notif = await db.insert(notifications).values({ ... }).returning();
    this.emit('created', notif);
    return notif;
  }
  async markRead(id: number): Promise<void>;
  async markAllRead(): Promise<void>;
  async getUnreadCount(): Promise<number>;
}
```

### Push in-page (SSE)

Étend `/api/events` du Ticket 2 :
```typescript
notificationService.on('created', (notif) => {
  controller.enqueue(`event: notification\ndata: ${JSON.stringify(notif)}\n\n`);
});
```

Côté client `NotificationListener` écoute et affiche toast custom :
- Achievement → AchievementToast avec icône, points, badge hardcore
- Streak → "🔥 12 jours consécutifs !"
- etc.

Max 3 toasts simultanés (queue).

### Web Push - VAPID

```bash
pnpm add web-push
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Stockage VAPID :
- En DB (table settings)
- Auto-générées au premier boot si absentes
- Régénérables dans Settings (invalide subscriptions)

### Routes API

**`POST /api/notifications/subscribe`** :
```typescript
const subscription = await req.json();
const parsed = pushSubscriptionSchema.parse(subscription);
await db.insert(pushSubscriptions).values({...}).onConflictDoUpdate({...});
```

**`POST /api/notifications/unsubscribe`** : delete by endpoint.

### Push service

```typescript
import webpush from 'web-push';

export async function sendWebPush(notification: Notification) {
  webpush.setVapidDetails('mailto:noreply@...', publicKey, privateKey);
  const subs = await db.select().from(pushSubscriptions);
  const payload = JSON.stringify(buildPushPayload(notification));

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ ... }, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Cleanup sub expirée
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        }
      }
    })
  );
}
```

### Service Worker

`public/sw.js` :
```javascript
self.addEventListener('push', (event) => {
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: payload.data,
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
```

### Registration côté client

```typescript
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function subscribeToPush(reg, vapidPublicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await fetch('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
  return subscription;
}
```

### UI Settings tab "Notifications"

- ☑ Activer notifications
- Channels : in-app / web push (avec bouton "Activer")
- Types (chaque type cochable, sous-option hardcore only pour achievements)
- Quiet hours (entre HH et HH)
- Liste appareils connectés (User-Agent + remove)
- Bouton "Tester les notifications"

### Centre notifications (Bell)

```typescript
<Popover>
  <PopoverTrigger>
    <Button variant="ghost" size="icon" className="relative">
      <Bell />
      {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    {notifications.map(n => <NotificationItem key={n.id} notification={n} />)}
  </PopoverContent>
</Popover>
```

### Sons (optionnel)

`public/sounds/achievement.mp3` (~50 KB).
Setting "Sons activés" par défaut **OFF**.

### Streak milestones

```typescript
const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
// Sur closeSession, recalcule streak. Si milestone → notification.
```

### Wrapped notification

Cron interne au scrobbler :
```typescript
new CronJob('0 9 1 12 *', async () => {
  // 1er décembre 9h
  await notificationService.create({ type: 'wrapped.available', data: { year } });
});
```

```bash
pnpm add cron
```

### Traductions

Section `notifications` FR + EN.

## Sécurité

- VAPID privée jamais exposée par API
- Payload Web Push : chiffrement standard P-256 du protocole
- Pas d'envoi à tiers (push services natifs Apple/Google/Mozilla)
- Subscriptions locales à l'instance
- L'utilisateur peut révoquer depuis Settings

## Limitations à documenter

⚠️ **iOS Safari** : Web Push uniquement si PWA installée (lien Ticket 13).
⚠️ **HTTPS requis** : sauf localhost. Recommander Caddy / Tailscale / Nginx.

## Performance

- Envoi parallèle (Promise.allSettled)
- Cleanup 410 Gone automatique
- Limite : 100 subscriptions max

## Tests

`lib/notifications/__tests__/service.test.ts` :
- Filter par prefs
- Persist + émission
- markRead, markAllRead

`lib/notifications/__tests__/web-push.test.ts` :
- Mock web-push
- Cleanup 410
- Payload selon type

## Contraintes

- Strict TypeScript
- Aucune notif ne bloque le scrobbler
- Quiet hours strictes
- VAPID absentes → tab désactivé avec message
- Compatible Chrome/Firefox/Edge/Safari (avec limitations)
- Toast in-app : max 3 (queue)
- Commit final : "feat(notifications): real-time push for achievements and milestones"

## Workflow

1. Génère VAPID keys initiales
2. Implémente :
   - Schema DB + migrations
   - Service notification + tests
   - SSE extension
   - NotificationListener + toasts
   - Bell + popover
   - Service Worker
   - registerServiceWorker + subscribeToPush
   - Routes API subscribe/unsubscribe
   - Lib web-push + cleanup 410
   - Plug dans service
   - Détection achievements
   - Streak milestones
   - Cron Wrapped notifications
   - Settings tab
   - Sons
   - Traductions FR + EN
3. Vérifie `pnpm build`
4. Tests : in-app, web push, quiet hours, désactivation type, mobile Chrome
5. Update README : section "Notifications" + limitations HTTPS/iOS PWA
6. Coche Ticket 12
7. Résume-moi : browsers testés, VAPID auto-générée, perfs envoi 10/100 notifs

Démarre.
```

---


## Ticket 13 — PWA installable

```markdown
# Ticket 13 : PWA installable (Progressive Web App)

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-12 mergés.

Le dashboard a déjà un service worker (Ticket 12). On le rend installable
sur écran d'accueil iOS/Android/desktop. **Active enfin Web Push iOS**.

## Stratégie

PWA classique minimaliste, **sans** transformer en SPA offline-first.
Mode offline complet = trop complexe pour peu de valeur.

Cible :
- ✅ Installation propre
- ✅ Splashscreen + icônes
- ✅ Page offline propre
- ✅ Cache assets statiques
- ❌ PAS de cache des données dynamiques

## Objectifs

1. `manifest.webmanifest` complet
2. Icônes app toutes tailles (192, 512, maskable, Apple touch)
3. Splash screens iOS
4. Service Worker étendu (cache assets + offline fallback)
5. Banner d'installation custom discret
6. Page `/offline` propre
7. Meta tags PWA complets
8. Doc utilisateur

## Détails techniques

### Manifest

`app/manifest.ts` (Next 16 supporte manifest typé) :
```typescript
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Recalbox Dashboard',
    short_name: 'Recalbox',
    description: '...',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshots/dashboard-wide.png', sizes: '1280x720', form_factor: 'wide' },
      { src: '/screenshots/stats-narrow.png', sizes: '750x1334', form_factor: 'narrow' },
    ],
    shortcuts: [
      { name: 'Collection', url: '/collection', icons: [...] },
      { name: 'Stats', url: '/stats', icons: [...] },
      { name: 'Achievements', url: '/achievements', icons: [...] },
    ],
  };
}
```

### Icônes

Tailles obligatoires : 192, 512 (any + maskable).
Apple : 180, 152, 120 (apple-touch-icon).
Favicon : 32, 16, ico.

⚠️ Demande-moi quel design d'icône (3 options : logo, lettre R gradient, sprite manette).

Script `scripts/generate-icons.ts` :
```typescript
import sharp from 'sharp';

const sizes = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  // ...
];

for (const { name, size, maskable } of sizes) {
  const padding = maskable ? Math.round(size * 0.1) : 0;
  await sharp(svg)
    .resize(size - padding * 2, size - padding * 2)
    .extend({ top: padding, ... })
    .png()
    .toFile(path.join(ICONS_DIR, name));
}
```

Lance via `pnpm icons:generate`.

### Splash screens iOS

`pwa-asset-generator` :
```bash
pnpm add -D pwa-asset-generator
pnpm exec pwa-asset-generator public/icons/icon-source.svg public/icons \
  --background "#0a0a0a" --splash-only \
  --manifest public/icons/manifest-splash.json
```

### Meta tags

`app/[locale]/layout.tsx` :
```typescript
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Recalbox',
    startupImage: [/* tous les splash */],
  },
  icons: {
    icon: [{ url: '/favicon.ico' }, ...],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }, ...],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  viewportFit: 'cover',
};
```

### Service Worker étendu

Stratégie cache :
- HTML pages : network-first → fallback cache → fallback /offline
- Static assets : cache-first
- API calls : **network-only** (jamais de cache !)
- SSE : pas d'interception

```javascript
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `recalbox-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `recalbox-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = ['/offline', '/icons/icon-192.png', '/icons/icon-512.png', '/fonts/Inter-Regular.woff2', '/fonts/Inter-Bold.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(handleHtmlRequest(request));
  } else if (/* static asset */) {
    event.respondWith(handleStaticRequest(request));
  }
});
```

### Page offline

`app/[locale]/offline/page.tsx` :
```typescript
export const dynamic = 'force-static';  // CRITIQUE pour cachable

export default async function OfflinePage() {
  const t = await getTranslations('offline');
  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Button onClick={() => window.location.reload()}>{t('retry')}</Button>
    </div>
  );
}
```

### Hook use-install-prompt

```typescript
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true); return;
    }
    if ((window.navigator as any).standalone === true) {
      setIsInstalled(true); return;
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    });
    window.addEventListener('appinstalled', () => setIsInstalled(true));
  }, []);

  return { canInstall: installPrompt !== null, isInstalled, install: async () => {...}, isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) };
}
```

### Banner d'installation custom

Discret, dismissable 14 jours :
```typescript
const DISMISS_KEY = 'install-banner-dismissed-at';
const DISMISS_DAYS = 14;

// Affiche en bas droit, avec icône + nom + bouton install
// Sur iOS : instructions textuelles "Tap Share then Add to Home Screen"
// Sur Android/desktop : utilise beforeinstallprompt
```

### Settings : option "App"

```
État : ✓ Installée sur cet appareil
Version : 1.0.0
[Vider le cache] [Vérifier mises à jour]

Sur autres appareils :
- iPhone Safari : "Sur l'écran d'accueil" depuis Partager
- Android Chrome : "Installer l'app"
- Desktop : icône d'install dans barre d'adresse
```

### Mise à jour SW

```typescript
export function ServiceWorkerUpdater() {
  useEffect(() => {
    navigator.serviceWorker.ready.then((reg) => {
      setInterval(() => reg.update(), 60 * 60 * 1000);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            toast.info('Nouvelle version', {
              action: { label: 'MAJ', onClick: () => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              }},
              duration: Infinity,
            });
          }
        });
      });
    });
  }, []);
  return null;
}
```

SW écoute :
```javascript
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

### Tests Lighthouse

Score PWA doit être 100/100 :
- Manifest valide
- Icônes 192 + 512
- theme_color + background_color
- start_url atteignable
- display: standalone
- SW enregistré
- HTTPS (sauf localhost)
- Page offline répond
- Viewport meta tag
- Apple touch icon

### Doc

README, section "Install as an app" avec instructions iPhone/Android/Desktop.

⚠️ **Web Push iOS** ne fonctionne QUE si app installée. Mentionner clairement.

### Limitation HTTPS

Solutions documentées dans `docs/https-setup.md` :
- Caddy avec mkcert (cert local)
- Tailscale (HTTPS natif)
- Nginx Proxy Manager + Let's Encrypt
- Cloudflare Tunnel

### Traductions

Section `pwa` et `offline` FR + EN.

## Performance

- Cache statique < 5 MB
- Install SW < 2s
- Première nav après install : instant
- Update check 1×/h

## Contraintes

- SW ne bloque pas le rendu initial
- Banner discret, 14 jours dismiss
- Mode standalone détecté correctement
- API calls JAMAIS cachées
- Compatible Chrome 90+, Firefox 90+, Safari 14+, Edge 90+
- Commit final : "feat(pwa): installable progressive web app with offline fallback"

## Workflow

1. Demande-moi design d'icône (option A/B/C)
2. Génère SVG source ou demande à moi
3. Implémente :
   - Script generate-icons.ts + PNG
   - Splash screens iOS (pwa-asset-generator)
   - app/manifest.ts
   - Meta tags layout.tsx
   - Extension SW (cache + offline)
   - Page /offline
   - Hook use-install-prompt
   - InstallBanner
   - ServiceWorkerUpdater
   - Settings tab "App"
   - Doc README + docs/https-setup.md
   - Traductions FR + EN
4. Vérifie `pnpm build`
5. Test Lighthouse en local (100/100 attendu)
6. Tests manuels Chrome desktop / Chrome Android / Safari iOS
7. Update README : section "Install as an app"
8. Coche Ticket 13
9. Résume-moi : score Lighthouse, browsers OK, Web Push iOS fonctionne, taille cache, suggestions

Démarre par demander le design d'icône.
```

---


## Ticket 14 — Multi-Recalbox (gestion de plusieurs instances)

```markdown
# Ticket 14 : Gestion de plusieurs instances Recalbox

## Contexte

Lis d'abord README.md et `git log --oneline -10`. Tickets 1-13 mergés.

⚠️ **Ce ticket est plus complexe que les précédents** : il refactore l'hypothèse
"single Recalbox" portée pendant 13 tickets. Toutes les couches s'adaptent.

Use-cases :
- Pi5 salon + bartop
- Famille avec Recalbox par pièce
- Cybercafé / association

## Stratégie

Refactor incrémental. "Single Recalbox" = cas où N=1. On généralise à N>=1.

Toutes les tables qui référencent "la Recalbox" gagnent une colonne `recalbox_id`.

On garde une "Recalbox active" que l'utilisateur switch, plutôt que tout
afficher en agrégé. Multi-tenant simple.

## Objectifs

1. Schema DB refactoré : table `recalboxes` + foreign keys
2. Migration sans perte des données existantes
3. Config refactorée : tableau de configs
4. Switcher dans le header
5. Concept "Recalbox active" (cookie)
6. Pools SSH/MQTT pour N connexions
7. Scrobbler multi-subscriber
8. Page `/recalboxes` (CRUD)
9. Vue agrégée `/all-recalboxes`
10. Wizard adapté

## Détails techniques

### Schema DB

```typescript
export const recalboxes = sqliteTable('recalboxes', {
  id: text('id').primaryKey(),                  // UUID
  name: text('name').notNull(),                 // "Salon", "Bartop"
  host: text('host').notNull(),
  sshUser: text('ssh_user').notNull(),
  sshPassword: text('ssh_password').notNull(),
  sshPort: integer('ssh_port').notNull().default(22),
  mqttPort: integer('mqtt_port').notNull().default(1883),
  color: text('color'),
  iconEmoji: text('icon_emoji'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  archived: integer('archived', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastConnectedAt: integer('last_connected_at', { mode: 'timestamp' }),
});
```

Migrations ajout `recalbox_id` :
- sessions
- games (game_id = hash(recalbox_id + romPath), pas juste hash(romPath) !)
- system_snapshots
- ra_game_mapping
- notifications

RA achievements / game_progress : **pas** de recalbox_id (échelle compte RA).

### Migration auto au boot

Si `recalboxes` vide ET données existantes :
1. Créer Recalbox par défaut depuis config existante (UUID)
2. Backfill : toutes rows pointent vers cette Recalbox
3. Flag `__multi_recalbox_migrated__ = "true"`

Idempotente : skip si déjà migré.

### Refactor config

```typescript
export type AppConfig = {
  recalboxes: RecalboxConfig[];
  activeRecalboxId: string | null;
  scrobble: { ... };
  // ...
};

class ConfigStore {
  async addRecalbox(config): Promise<RecalboxConfig>;
  async updateRecalbox(id, partial): Promise<void>;
  async removeRecalbox(id): Promise<void>;
  async setDefault(id): Promise<void>;
  getRecalboxes(): RecalboxConfig[];
  getRecalbox(id): RecalboxConfig | null;
  async getActiveRecalboxId(req?: Request): Promise<string>;
}
```

Events : `recalbox:added`, `recalbox:updated`, `recalbox:removed`, `recalbox:active-changed`.

### Pools clients

```typescript
class SshPool {
  private clients = new Map<string, SshClient>();
  getClient(recalboxId: string): SshClient { ... }
  async closeAll(): Promise<void>;
}
export const sshPool = new SshPool();
```

Listeners :
```typescript
configStore.on('recalbox:removed', ({ id }) => {
  sshPool.getClient(id)?.disconnect();
  sshPool.clients.delete(id);
});
```

Idem `MqttPool`.

### Active Recalbox côté serveur

Via cookie HttpOnly :
```typescript
import { cookies } from 'next/headers';

export async function getActiveRecalboxId(): Promise<string> {
  const id = (await cookies()).get('active_recalbox_id')?.value;
  if (id && configStore.getRecalbox(id)) return id;
  return configStore.getDefaultRecalbox()?.id ?? configStore.getRecalboxes()[0]?.id;
}

export async function setActiveRecalboxId(id: string): Promise<void> {
  (await cookies()).set('active_recalbox_id', id, { httpOnly: true, sameSite: 'lax', maxAge: 60*60*24*365 });
}
```

Route :
**`PUT /api/recalboxes/active`** : `{ id }` → setActiveRecalboxId.

### Queries adaptées

Toutes les queries acceptent un `recalboxId` optionnel (default: active) :
```typescript
export async function listSessions(filters, recalboxId?: string) {
  const targetId = recalboxId ?? await getActiveRecalboxId();
  return db.select().from(sessions).where(and(eq(sessions.recalboxId, targetId), ...));
}

export async function listAllSessionsAcrossRecalboxes(filters);
```

### Scrobbler multi-instance

Subscribe à TOUS les brokers MQTT :
```typescript
const subscriptions = new Map<string, () => void>();
for (const rb of configStore.getRecalboxes()) {
  subscriptions.set(rb.id, subscribeToRecalbox(rb, sessionManager));
}

configStore.on('recalbox:added', ({ recalbox }) => {
  subscriptions.set(recalbox.id, subscribeToRecalbox(recalbox, sessionManager));
});
configStore.on('recalbox:removed', ({ id }) => {
  subscriptions.get(id)?.();
  subscriptions.delete(id);
});
```

Hot-reload, sans restart.

### SSE multi-source

`/api/events` filtre par `?recalboxId=...` :
```typescript
const handleEvent = (event) => {
  if (recalboxIdFilter && event.recalboxId !== recalboxIdFilter) return;
  controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
};

for (const rb of configStore.getRecalboxes()) {
  mqttPool.getClient(rb.id).on('game:start', (e) => handleEvent({ ...e, recalboxId: rb.id }));
}
```

### Switcher UI

Dans le header (masqué si 1 seule Recalbox) :
```typescript
<DropdownMenu>
  <DropdownMenuTrigger>
    <Button>
      {active.iconEmoji} {active.name} ▼
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuLabel>Switch Recalbox</DropdownMenuLabel>
    {recalboxes.map(rb => (
      <DropdownMenuItem onClick={() => switchRecalbox(rb.id)}>
        {rb.iconEmoji} {rb.name}
        {rb.id === activeRecalboxId && <Check />}
        <ConnectionStatusDot recalboxId={rb.id} />
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem href="/recalboxes">Manage Recalboxes</DropdownMenuItem>
    <DropdownMenuItem href="/recalboxes/add">+ Add a Recalbox</DropdownMenuItem>
    <DropdownMenuItem href="/all-recalboxes">View all combined</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Page /recalboxes

Liste avec card par Recalbox :
- Icon + nom + badge Default + connection dot
- Host + stats (jeux, temps joué)
- Menu ⋮ : Edit, Set as default, Test connection, View as active, Delete

### Pages /recalboxes/add + /recalboxes/[id]/edit

Réutilise logique du wizard Welcome :
- Name (custom label)
- Icon emoji picker
- Color picker
- Host, SSH user, password, port, MQTT port
- Test connection
- À la création : "Sync games from this Recalbox now?"

### Page /all-recalboxes (vue agrégée)

KPIs cumulés + bar chart par Recalbox + top games tous-Recalboxes + live activity.

Read-only. Pas d'action depuis cette page.

### Cas spéciaux

**Suppression dernière Recalbox** :
- Confirmation forte
- Si tout supprimé → wizard premier démarrage réapparaît

**Suppression avec données** :
- Option soft : archive (garde data, plus de scrobble)
- Option hard : supprime tout

Recalbox archivée :
- Section dédiée en bas de /recalboxes
- Consultable mais ne reçoit plus

**Switch vers Recalbox sans données** :
- Empty state propre + bouton "Sync games" visible

**Conflit ROM entre Recalboxes** :
- Game ID = hash(recalbox_id + romPath) garantit séparation
- Agrégation cross-Recalbox par fuzzy match titre (best effort)

### Tests

`lib/recalbox/__tests__/active.test.ts` : fallback default, cookie inexistant, set/get.

`lib/db/__tests__/multi-tenant-queries.test.ts` : filter par recalboxId, cross-aggregation.

`scripts/__tests__/migration-multi-recalbox.test.ts` :
- Migration single → multi, données préservées
- Idempotence

### Traductions

Section `recalboxes` FR + EN.

## Performance et limites

- Limite raisonnable : 10 Recalboxes max
- Memory : ~10 MB par connexion MQTT → ~100 MB max
- DB queries : indexes sur `recalbox_id` partout
- SSE : un seul EventSource côté client

## Contraintes

- Strict TypeScript
- Migration data 100% safe (zero loss)
- Scrobbler gère add/remove à chaud sans restart
- 0 Recalbox → wizard
- 1 Recalbox → UI minimaliste, switcher masqué
- 2+ Recalboxes → switcher visible + /all-recalboxes
- Toutes les pages existantes continuent via cookie active
- Commit final : "feat(multi): support for multiple Recalbox instances"

## Workflow

1. Lis CAREFULLY tous les fichiers existants mentionnant "the Recalbox" :
   ```bash
   grep -r "recalbox" --include="*.ts" --include="*.tsx" lib/ app/ components/
   ```
2. Liste-moi les fichiers identifiés (30-50) avec diagnostic
3. Implémente dans l'ordre :
   - Schema DB + migration data
   - Config store refactor
   - Pools SSH et MQTT
   - Active Recalbox via cookie
   - Refactor queries
   - Scrobbler multi-instance
   - SSE multi-source
   - Switcher UI
   - Pages /recalboxes
   - Page /all-recalboxes
   - Cas spéciaux (archived, empty, etc.)
   - Refactor welcome wizard
   - Traductions FR + EN
4. Vérifie `pnpm build`
5. Tests CRITIQUES :
   - Backup DB avant tout
   - Migration auto sur copie : aucune perte
   - Ajoute 2ème Recalbox fictive
   - Switche : data changent
   - /all-recalboxes : cumuls bons
   - Archive : data visible mais plus de scrobble
   - Hard-delete : données effacées
   - Live test : joue sur A pendant nav B → events filtrés
6. Update README : section "Multiple Recalboxes" + screenshots switcher
7. Coche Ticket 14
8. Résume-moi : fichiers touchés, migration lossless, perfs 2-3 Recalboxes simultanées, opportunités futures

Démarre par l'analyse d'impact.
```

---

## Ticket 15 — Publication des analytics sur MQTT (bonus / optionnel / interopérabilité)

```markdown
# Ticket 15 : Publier les analytics du dashboard sur MQTT

## Contexte

Lis d'abord README.md et fais `git log --oneline -10`.

Le dashboard CONSOMME déjà les événements MQTT de Recalbox (Ticket 2). Ce ticket
ajoute la capacité de PUBLIER nos propres données analytics sur le broker MQTT,
pour que d'autres outils de l'écosystème (Home Assistant via la custom component
RecalboxHomeAssistant, ou n'importe quel client MQTT) puissent les consommer.

C'est une feature d'interopérabilité : le dashboard devient une SOURCE de
données analytics pour l'écosystème, pas seulement un consommateur.

Cas d'usage concret : un utilisateur qui a Home Assistant peut afficher sur son
dashboard domotique "Temps de jeu aujourd'hui : 2h34" ou "Série en cours :
12 jours", données que SEUL notre dashboard sait calculer.

## Objectifs

1. Un publisher MQTT qui pousse les analytics clés sur des topics dédiés
2. Configuration : activable/désactivable, broker configurable (par défaut le
   même que Recalbox, mais peut être un broker tiers)
3. Topics documentés et stables (contrat d'API)
4. Publication déclenchée par événement (fin de session) + refresh périodique
5. Discovery Home Assistant optionnel (auto-configuration des entités HA)

## Topics MQTT proposés

Préfixe configurable, par défaut `RecalboxDashboard/`.

| Topic | Payload | Quand publié |
| --- | --- | --- |
| `RecalboxDashboard/status` | `online` / `offline` | Au démarrage / LWT |
| `RecalboxDashboard/playtime/today` | secondes (int) | Fin de session + toutes les 5 min |
| `RecalboxDashboard/playtime/week` | secondes (int) | Idem |
| `RecalboxDashboard/streak/current` | jours (int) | Fin de session |
| `RecalboxDashboard/streak/longest` | jours (int) | Fin de session |
| `RecalboxDashboard/sessions/today` | nombre (int) | Fin de session |
| `RecalboxDashboard/topgame/week` | titre du jeu (string) | Fin de session |
| `RecalboxDashboard/lastgame` | JSON {name, system, durationSec} | Fin de session |

Tous en `retained: true` pour qu'un client qui se connecte ait l'état immédiat.

## Détails techniques

### Publisher

`apps/dashboard/lib/recalbox/mqtt-publisher.ts` :
- Réutilise la connexion / config MQTT existante (Ticket 2)
- Méthode `publishAnalytics(snapshot: AnalyticsSnapshot)`
- LWT (Last Will and Testament) : `RecalboxDashboard/status` → `offline`
- Tous les messages `retained`

### Calcul du snapshot

Réutilise les calculateurs de stats existants (Ticket 5). Un
`AnalyticsSnapshot` agrège : playtime today/week, streak, sessions today,
top game week, last game.

### Déclenchement

Intégré au scrobbler daemon (Ticket 4) :
- À chaque `closeSession` → recalcule et publie
- Timer toutes les 5 min → republie (pour le playtime "today" qui avance)

### Configuration

Nouveau bloc dans le settings store (Ticket 6) :

    mqttPublish: {
      enabled: boolean;          // défaut: false (opt-in)
      brokerUrl: string;         // défaut: même broker que Recalbox
      topicPrefix: string;       // défaut: "RecalboxDashboard/"
      homeAssistantDiscovery: boolean;  // défaut: false
    }

Nouveau tab ou section dans la page Settings pour configurer ça.

### Home Assistant Discovery (optionnel)

Si `homeAssistantDiscovery` activé, publier des messages de discovery sur
`homeassistant/sensor/recalbox_dashboard_*/config` pour que Home Assistant
crée automatiquement les entités (sensors). Format standard HA MQTT Discovery.

Ça permet à un utilisateur HA de voir les analytics du dashboard apparaître
automatiquement comme des sensors, sans config manuelle.

### Documentation

Crée `docs/mqtt-api.md` qui documente tous les topics, leur payload, leur
fréquence de publication. C'est un contrat d'API : une fois publié, on évite
de casser ces topics.

Mentionne dans le README (section écosystème) que le dashboard peut publier
ses analytics sur MQTT pour interopérer avec Home Assistant et autres.

## Contraintes

- Feature OPT-IN (désactivée par défaut — on ne publie pas sans consentement)
- Ne doit jamais bloquer le scrobbler si le broker de publication est down
- Réutiliser au maximum le code MQTT existant (Ticket 2)
- Strict TypeScript
- Commit final : "feat(mqtt): publish analytics to MQTT for ecosystem interop"

## Workflow

1. Lis le code MQTT existant (lib/recalbox/mqtt-client.ts) pour réutiliser
2. Crée le publisher
3. Définis AnalyticsSnapshot + le calcul (réutilise stats du Ticket 5)
4. Intègre au scrobbler (publication sur closeSession + timer)
5. Ajoute la config dans le settings store + UI
6. Implémente le HA Discovery (optionnel mais recommandé)
7. Crée docs/mqtt-api.md
8. Vérifie pnpm build
9. Test : active la feature, utilise un client MQTT (mosquitto_sub) pour voir
   les topics publiés ; si tu as Home Assistant, vérifie le discovery
10. Update README + roadmap
11. Résume-moi ce qui marche et si le HA Discovery a pu être testé

Démarre.
```

---

## Ticket 16 — Générateur de fichiers .m3u multi-disques

```markdown
# Ticket 16 : Générateur de fichiers .m3u

## Contexte

Lis d'abord README.md et fais `git log --oneline -10`.

Les jeux multi-disques nécessitent un fichier .m3u listant les disques. Le
dashboard parse déjà les gamelist.xml et les ROMs par système. On ajoute la
capacité de détecter les jeux multi-disques et de générer/déployer leurs .m3u.

## Format .m3u

Un .m3u est un fichier texte brut :
- Nom : le nom du jeu SANS la mention de disque
  Ex: jeu "Final Fantasy VII (France) (Disc 1).cue" → m3u "Final Fantasy VII (France).m3u"
- Contenu : un fichier disque par ligne, dans l'ordre
- Fins de ligne UNIX (LF), JAMAIS Windows (CRLF) — sinon Recalbox refuse
- Fonctionne avec n'importe quelle extension : .cue, .chd, .ccd, .cdi, .pbp, etc.
- NE fonctionne PAS avec des fichiers compressés (.zip)

Exemple de contenu pour "Final Fantasy VII (France).m3u" :

    Final Fantasy VII (France) (Disc 1).cue
    Final Fantasy VII (France) (Disc 2).cue
    Final Fantasy VII (France) (Disc 3).cue

## Objectifs

- `lib/recalbox/multidisc-detector.ts` : détection des jeux multi-disques
- `lib/recalbox/m3u-generator.ts` : génération du contenu .m3u
- Route API pour lister les candidats + générer + déployer
- UI dans la section collection
- Déploiement des .m3u sur la Recalbox via SSH

## Détails techniques

### Détection des multi-disques (multidisc-detector.ts)

Parser les noms de fichiers ROM pour repérer les patterns de disque. Patterns
courants à gérer :

- `(Disc 1)`, `(Disc 2)` ... — le plus courant
- `(Disc 1 of 3)`, `(CD 1 of 3)`
- `(CD 1)`, `(CD1)`
- `(Disk 1)` (orthographe alternative)
- variations de casse et d'espaces

Algorithme :

1. Pour chaque système supportant le multi-disque (psx, saturn, segacd, pcenginecd,
   3do, dreamcast, amiga, pc98, etc. — liste à définir)
2. Lister les fichiers ROM
3. Normaliser : retirer le pattern de disque du nom → "nom de base"
4. Grouper les fichiers par nom de base
5. Un groupe avec 2+ fichiers = un jeu multi-disque candidat

Type de sortie :

    export type MultiDiscGame = {
      system: string;
      baseName: string;              // "Final Fantasy VII (France)"
      m3uFileName: string;           // "Final Fantasy VII (France).m3u"
      discs: Array<{
        fileName: string;            // "Final Fantasy VII (France) (Disc 1).cue"
        discNumber: number;          // 1
      }>;
      m3uAlreadyExists: boolean;     // un .m3u existe-t-il déjà ?
    };

    export async function detectMultiDiscGames(system?: string): Promise<MultiDiscGame[]>;

Trie les disques par numéro. Gère le cas où un .m3u existe déjà (ne pas écraser
sans confirmation).

### Génération (m3u-generator.ts)

    // Lines are joined with LF (never CRLF) — Recalbox requires UNIX line endings.
    export function generateM3uContent(game: MultiDiscGame): string;

Trivial : joindre les noms de disques avec `\n`, terminer par `\n`.

### Option "cacher les disques individuels"

Astuce communautaire importante : pour éviter que le scraper Recalbox scrape
chaque disque séparément, on préfixe les fichiers disque individuels avec un
point (`.`) ce qui les rend cachés. Seul le .m3u reste visible et scrapable.

Ex: `"Final Fantasy VII (Disc 1).cue"` devient `".Final Fantasy VII (Disc 1).cue"`

Ça doit être une OPTION (checkbox dans l'UI), pas automatique, car ça renomme
des fichiers — action plus intrusive. Pour un `.cue`/`.bin`, attention : si on
cache le `.cue` il faut aussi cacher le `.bin` associé, et le `.cue` référence le
`.bin` par son nom donc renommer le `.bin` casserait le `.cue`. À gérer avec soin,
ou limiter l'option de masquage aux formats mono-fichier (`.chd`, `.pbp`).

⚠️ Demande-moi confirmation sur ce point avant d'implémenter le masquage :
c'est la partie la plus délicate, on peut très bien livrer le ticket SANS
le masquage dans une v1 et l'ajouter après.

### Routes API

`GET /api/m3u/candidates` :
- Query param optionnel `?system=psx`
- Retourne la liste des `MultiDiscGame` détectés

`POST /api/m3u/generate` :
- Body : liste de `baseNames` à traiter + option `hideDiscs`
- Génère les .m3u et les déploie via SSH dans le bon dossier système
- Si masquage activé : renomme les fichiers disque
- Retourne un résumé (créés, déjà existants ignorés, erreurs)
- Idempotent : si le .m3u existe déjà et est identique, ne rien faire

### UI

Dans la section collection, nouvel onglet ou sous-page "Multi-disc / .m3u" :

- Liste des jeux multi-disques détectés, groupés par système
- Pour chaque : nom de base, nombre de disques, statut (.m3u existe ou non)
- Prévisualisation du contenu .m3u qui serait généré
- Checkbox "cacher les disques individuels" (avec avertissement)
- Bouton "Générer les .m3u manquants" (batch) ou génération individuelle
- Après génération : indiquer qu'un re-scan EmulationStation peut être nécessaire

### Déploiement

Les .m3u vont dans `/recalbox/share/roms/<system>/`, à côté des disques.
Déploiement via SSH (réutilise le client SSH existant).

⚠️ Recalbox doit reconnaître l'extension `.m3u` pour le système concerné. Sur
les versions récentes c'est natif pour psx/saturn/etc., mais pas forcément
pour tous les systèmes. Le ticket doit le documenter, et l'UI peut afficher
un avertissement si le système ciblé ne reconnaît pas .m3u nativement.

## Tests

`lib/recalbox/__tests__/multidisc-detector.test.ts` :
- Détection avec tous les patterns (`(Disc 1)`, `(CD 1 of 3)`, etc.)
- Groupement correct
- Tri des disques par numéro
- Jeux mono-disque ignorés
- m3u déjà existant détecté

`lib/recalbox/__tests__/m3u-generator.test.ts` :
- Contenu correct
- Fins de ligne LF (vérifier explicitement qu'il n'y a pas de CRLF)

## Contraintes

- Strict TypeScript
- Fins de ligne LF garanties (test explicite)
- Ne JAMAIS écraser un .m3u existant sans confirmation explicite
- Le masquage de fichiers est opt-in et bien averti (action destructive)
- Cohérent avec le positionnement : gestion de collection, pas ops
- Commit final : `"feat(m3u): multi-disc detection and .m3u generation"`

## Workflow

1. Commence par me demander un échantillon : la liste des fichiers d'un dossier
   système multi-disque réel de ma Recalbox, ex:
   `ssh root@recalbox.local 'ls /recalbox/share/roms/psx/'`
   pour calibrer les patterns de détection sur des vrais noms de fichiers
2. Implémente : detector + tests → generator + tests → routes API → UI → déploiement
3. Vérifie `pnpm build`
4. Demande-moi confirmation sur l'approche du masquage de fichiers avant de
   l'implémenter (ou livre une v1 sans masquage)
5. Test end-to-end : détecter, générer, déployer, vérifier sur la Recalbox
   qu'un jeu multi-disque se lance bien via le .m3u
6. Update README (section features ou collection) + roadmap
7. Résume-moi : patterns rencontrés sur ma vraie collection, si le masquage
   a été inclus ou reporté, et toute limitation découverte

Démarre par demander l'échantillon de fichiers.
```

---

## Ticket 17 — Diagnostic de collection et statut Patron

````markdown
# Ticket 17 : Panneau "santé de la collection"

## Contexte

Lis d'abord README.md et fais `git log --oneline -10`.

Le dashboard parse déjà les gamelist.xml (Ticket 3) et lit recalbox.conf via
SSH (Ticket 9, pour les credentials RetroAchievements). On ajoute un panneau
"santé de la collection" qui détecte les ROMs non scrapées et le statut Patron,
et donne des recommandations.

Principe strict : LECTURE SEULE. Le dashboard détecte et recommande, il
n'exécute jamais d'action sur la Recalbox (pas de scraping, pas d'écriture de
config).

## Objectifs

1. Détecter les jeux sans média (jaquette, description, vidéo) dans la collection
2. Lire le statut Patron depuis recalbox.conf
3. Détecter si la clé Patron est absente / vide
4. Panneau "santé de la collection" sur la page collection (et/ou accueil)
5. Recommandations actionnables contextualisées (Patron vs non-Patron)
6. Liste cliquable des jeux concernés

## Détails techniques

### Détection des jeux non scrapés

Le dashboard a déjà les données de la collection en DB (table games, Ticket 3).
Un jeu est considéré "non scrapé" ou "partiellement scrapé" selon les champs
média manquants.

```typescript
export type ScrapeStatus = {
  romPath: string;
  name: string;
  system: string;
  missingImage: boolean;       // pas de jaquette
  missingDescription: boolean; // pas de description
  missingVideo: boolean;       // pas de vidéo (optionnel, moins critique)
  // un jeu est "fully scraped" si image + description présentes
  // (la vidéo est un bonus, ne compte pas comme manquant critique)
};

export type CollectionHealth = {
  totalGames: number;
  fullyScraped: number;
  missingMedia: number;          // jeux avec au moins image OU description manquante
  bySystem: Array<{
    system: string;
    total: number;
    missingMedia: number;
  }>;
  unscrapedGames: ScrapeStatus[]; // liste détaillée des jeux à problème
};

export async function getCollectionHealth(): Promise<CollectionHealth>;
```

Cette fonction lit la table games (déjà en DB), pas besoin de SSH ici. Rapide.

Décision de design : la VIDÉO ne compte pas comme "média manquant critique"
(beaucoup de jeux n'ont pas de vidéo et c'est normal). Seules l'image et la
description comptent pour le statut "fully scraped". Documente ce choix.

### Lecture du statut Patron

Étendre le conf-reader existant (créé au Ticket 9 pour RetroAchievements).

La clé Patron est stockée dans recalbox.conf. Demande-moi de te confirmer le
nom exact de la clé — c'est probablement quelque chose comme
`system.recalboxprivatekey` ou `updates.lts.activationkey`, à vérifier sur une
vraie Recalbox. Demande-moi un `grep -i patron /recalbox/share/system/recalbox.conf`
et `grep -i privatekey /recalbox/share/system/recalbox.conf` pour identifier
la bonne clé.

⚠️ IMPORTANT : la clé Patron est un SECRET. Comme le password RetroAchievements
au Ticket 9, elle doit être traitée avec la whitelist du conf-reader :
- On peut lire si la clé EXISTE et si elle est NON VIDE
- On ne RENVOIE JAMAIS la valeur de la clé via l'API
- On ne LOGGUE JAMAIS la valeur
- L'API expose uniquement un booléen : `patronKeyPresent: true/false`

```typescript
export type PatronStatus = {
  isPatron: boolean;           // l'utilisateur a-t-il une clé Patron configurée
  keyPresent: boolean;         // la clé est-elle présente ET non vide
  keyLooksValid: boolean;      // heuristique simple : longueur/format plausible
                                // (PAS une validation réseau, juste un sanity check)
};

export async function getPatronStatus(): Promise<PatronStatus>;
```

Le conf-reader doit ajouter la clé Patron à sa whitelist MAIS dans une catégorie
"présence seulement" — la valeur n'est jamais exposée, contrairement au username
RetroAchievements dont la valeur peut l'être.

### Routes API

**`GET /api/collection/health`** :
- Retourne CollectionHealth
- Query param optionnel `?system=psx` pour filtrer
- Pas de cache long (la collection change quand on sync) ou cache court invalidé
  au sync collection

**`GET /api/patron/status`** :
- Retourne PatronStatus (booléens uniquement, jamais la clé)

### UI — Panneau "santé de la collection"

Un panneau (card/section) affiché sur la page collection. Composants :

**Bloc 1 — Scraping**
- Décompte global : "47 jeux sans média sur 2841" + une barre de progression
  visuelle (ex: 98% scrapé)
- Détail par système : liste des systèmes avec le nombre de jeux à problème
  (ex: "psx : 12 jeux", "saturn : 8 jeux") — chaque système cliquable pour
  filtrer la liste
- Liste cliquable des jeux concernés : nom + système + ce qui manque
  (badge "pas de jaquette", "pas de description"). Cliquer un jeu pourrait
  ouvrir sa fiche ou le mettre en évidence dans la collection.
- Recommandation contextualisée selon le statut Patron (voir bloc 3)

**Bloc 2 — Statut Patron**
- Si isPatron && keyPresent && keyLooksValid :
  badge vert "Patron actif"
- Si isPatron mais !keyPresent ou !keyLooksValid :
  alerte orange "Ta clé Patron semble absente ou invalide. Si tu es Patron,
  remets-la via le Web Manager Recalbox." + lien vers http://recalbox.local/
  (ou l'URL configurée de la Recalbox)
- Si !isPatron :
  pas d'alerte, juste l'info neutre (optionnel : mention discrète que Patron
  donne accès aux serveurs de scraping rapides)

**Bloc 3 — Recommandation de scraping**
- Si des jeux sont à scraper ET utilisateur Patron :
  "47 jeux à scraper. En tant que Patron, scrape depuis EmulationStation
  (Menu → Scraper) — tu utiliseras les serveurs Recalbox, bien plus rapides
  que ScreenScraper."
- Si des jeux à scraper ET non-Patron :
  "47 jeux à scraper. Lance le scraper depuis EmulationStation
  (Menu → Scraper)."
- Si tout est scrapé :
  message positif "Ta collection est entièrement scrapée."

IMPORTANT : aucun bouton "scraper maintenant" dans le dashboard. On guide
l'utilisateur vers le scraper natif de Recalbox (EmulationStation ou Web
Manager), on ne scrape pas nous-mêmes. Le texte des recommandations doit être
clair là-dessus.

### Placement

Le panneau "santé de la collection" va sur la page collection existante, en
encart en haut (avant la grille de jeux). Optionnellement un résumé compact
peut aussi apparaître sur la page d'accueil (juste le décompte + l'alerte
Patron si applicable), avec un lien vers le panneau complet.

## Ce que ce ticket NE fait PAS (volontairement)

- Pas de scraping depuis le dashboard (Recalbox a son scraper natif)
- Pas d'écriture de la clé Patron (le Web Manager natif gère ça en sécurité ;
  la clé est un secret sensible qu'un outil tiers ne doit pas écrire)
- Pas de validation réseau de la clé Patron (juste un sanity check de format)
- Pas de déclenchement à distance du scraper Recalbox (à investiguer un jour
  éventuellement, mais hors périmètre ici — Recalbox n'expose pas forcément
  de commande pour ça, et ça ferait glisser vers le rôle "contrôle")

## Tests

lib/__tests__/collection-health.test.ts :
- Détection correcte des jeux sans image / sans description
- La vidéo manquante ne compte pas comme "média manquant critique"
- Agrégation par système correcte
- Collection 100% scrapée → missingMedia = 0

lib/recalbox/__tests__/patron-status.test.ts :
- Clé présente et non vide → keyPresent true
- Clé absente du fichier → keyPresent false
- Clé présente mais vide → keyPresent false
- La VALEUR de la clé n'est jamais retournée (vérifier que l'objet de sortie
  ne contient que des booléens)

## Contraintes

- Strict TypeScript
- LECTURE SEULE absolue : aucune écriture sur la Recalbox
- La clé Patron n'est JAMAIS exposée via l'API ni loggée (booléens uniquement)
- Le conf-reader whiteliste la clé Patron en mode "présence seulement"
- Aucun bouton d'action de scraping (on guide, on n'exécute pas)
- Cohérent avec le positionnement companion analytics
- Commit final : "feat(health): collection scrape diagnostic + Patron status"

## Workflow

1. Demande-moi de confirmer le nom exact de la clé Patron dans recalbox.conf :
   `ssh root@recalbox.local 'grep -iE "patron|privatekey|activation" /recalbox/share/system/recalbox.conf'`
   (je te donnerai le nom de la clé, PAS sa valeur)
2. Implémente dans l'ordre :
   - collection-health.ts (lecture table games) + tests
   - extension conf-reader pour le statut Patron (whitelist "présence seulement") + tests
   - routes API (/api/collection/health, /api/patron/status)
   - composant panneau "santé de la collection"
   - intégration page collection (encart en haut)
   - résumé compact optionnel sur la page d'accueil
3. Vérifie pnpm build
4. Test : sur ta vraie Recalbox, vérifie que le décompte de jeux non scrapés
   est cohérent, que le statut Patron est correct, que l'alerte clé fonctionne
   (tu peux tester l'alerte en imaginant le cas clé absente)
5. Update README (section features) + roadmap
6. Résume-moi : le nom de la clé Patron trouvé, le décompte sur ta collection
   réelle, et confirme que la valeur de la clé n'est exposée nulle part

Démarre par demander le nom de la clé Patron.
````

---

## Annexes

### Stratégie de communication recommandée

Après chaque ticket majeur, considérer un post LinkedIn dans la voix
identifiée (phrases courtes, technique concret, sans corporate) :

- **Après Ticket 5** : Post "Build In Public" sur le dashboard temps réel
- **Après Ticket 7** : Post "Self-hosting" sur la stack Docker multi-arch
- **Après Ticket 9** : Post "Intégration API" sur RA + matching ROM
- **Après Ticket 11** : Post le plus viral : "J'ai construit un Wrapped retrogaming"
- **Après Ticket 13** : Post PWA : "Une PWA Next.js qui marche aussi sur iOS"

### Cibles de visibilité

- LinkedIn (cible principale, audience pro)
- Reddit : r/Recalbox, r/selfhosted, r/RetroAchievements
- Discord Recalbox (channel #made-by-community)
- forum.recalbox.com (section "show your project")
- Twitter (communauté retrogaming très active)

### Roadmap optionnelle post-Ticket 14

Si tu veux pousser plus loin :

- **Ticket 16** : Telemetry opt-in anonyme (stats globales pour la slide "comparison")
- **Ticket 17** : Extraction package `@super-retrogamers/slug` sur npm
- **Ticket 18** : Theming custom (palette utilisateur)
- **Ticket 19** : Export complet RGPD-compatible

Mais réaliste : Tickets 1-13 forment déjà un projet **exceptionnel** pour un side
project < 5h/semaine. Le Ticket 14 est niche (refactor lourd, ROI utilisateur faible
pour toi en particulier qui a une seule Recalbox).

### Idée écartée : scraping intégré au dashboard

> **Scraping intégré au dashboard** — non retenu.
> Recalbox embarque déjà un scraper ScreenScraper natif. Dupliquer cette
> fonctionnalité créerait un doublon, exactement ce que le positionnement
> "companion, pas concurrent" cherche à éviter. Le `packages/scraper-core`
> reste destiné au CLI du projet image perso (provisioning), pas au dashboard.
> La DÉTECTION des jeux sans métadonnées, elle, est désormais couverte par le
> **Ticket 17** (panneau "santé de la collection") : détecter et orienter vers
> le scraper natif d'EmulationStation, sans jamais scraper depuis le dashboard
> lui-même. L'écriture de config Recalbox et le déclenchement à distance du
> scraper restent hors périmètre — c'est le rôle du Web Manager natif.

### Rappel final

Ce pipeline représente **94 à 133 heures de travail réel**. À 5h/semaine, c'est
4 à 6 mois de side project. Ne pas chercher à tout faire d'un coup. Livrer
3-4 tickets bien faits avant d'attaquer les suivants. Mettre à jour ce fichier
au fur et à mesure (cocher les tickets terminés, ajuster les estimations basées
sur l'expérience réelle).

---

**Auteur** : Madjid Meddah ([@m-meddah](https://github.com/m-meddah))
**Stack** : Next.js 16+, TypeScript, Drizzle, SQLite, Tailwind v4, shadcn/ui
**Licence** : MIT
**Date de génération** : Mai 2026
