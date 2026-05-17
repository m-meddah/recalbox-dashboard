# Recalbox Wrapped — Design Spec

**Feature**: Ticket 11 — Annual recap with shareable images  
**Date**: 2026-05-17  
**Status**: Approved

---

## Overview

`/wrapped/:year` — a full-screen story-mode annual recap (Spotify Wrapped style) for retrogaming playtime. 8–12 slides, glassmorphism dark aesthetic with per-slide color accents, tap/swipe navigation, PNG sharing via `next/og`.

Accessible year-round. Archive at `/wrapped`. Preview banner on `/stats`.

---

## 1. Route Architecture

```
app/[locale]/wrapped/
├── layout.tsx                        # Fullscreen override (no nav header)
├── page.tsx                          # /wrapped — archive
└── [year]/
    ├── page.tsx                      # /wrapped/2026 — story viewer
    └── share/
        └── [slide]/
            └── route.tsx             # GET → ImageResponse PNG

app/api/wrapped/
└── [year]/route.ts                   # POST → force-regenerate (cache bust)
```

The `wrapped/layout.tsx` overrides the parent layout visually with `position: fixed; inset: 0; z-index: 50` rather than duplicating ThemeProvider/NextIntlClientProvider. No nav header shown inside wrapped routes.

---

## 2. Data Layer

### DB Schema addition — `wrapped_cache`

```typescript
export const wrappedCache = sqliteTable('wrapped_cache', {
  year:        integer('year').notNull(),
  locale:      text('locale').notNull(),
  data:        text('data').notNull(),       // serialized JSON
  generatedAt: integer('generated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.year, t.locale] }),
}))
```

### Types — `lib/wrapped/types.ts`

```typescript
export type WrappedSlideType =
  | 'intro'
  | 'total-time'
  | 'most-played-game'
  | 'top-system'
  | 'top-games-list'
  | 'longest-session'
  | 'busiest-day'
  | 'streak'
  | 'achievements-summary'   // skipped if RA disabled
  | 'unlocks'                // dedicated slide before outro
  | 'comparison-vs-others'
  | 'outro'

export type WrappedUnlock = {
  id: string
  title: string
  description: string
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
}

export type WrappedSlide = {
  type: WrappedSlideType
  data: Record<string, unknown>   // typed per-slide via discriminated union
}

export type Wrapped = {
  year: number
  generatedAt: Date
  user: { pseudo?: string }
  slides: WrappedSlide[]     // pre-filtered: slides with no data already excluded
  unlocks: WrappedUnlock[]
}
```

### Generator — `lib/wrapped/generator.ts`

```typescript
export async function generateWrapped(year: number, locale: string): Promise<Wrapped>
```

- Pure function — no side effects, all DB I/O via injected queries
- All SQL aggregations run in parallel via `Promise.all`
- Slides with no data (e.g. `achievements-summary` when RA disabled, `streak` when 0 consecutive days, `longest-session` when 0 sessions) are **excluded** from the returned `slides` array
- If `slides.length === 0` (year has no sessions), returns `{ slides: [], unlocks: [] }` — viewer shows fallback page

### Cache strategy

| Case | Behavior |
|------|----------|
| Past year | Generated once, never recalculated |
| Current year, cached < 24h | Serve from cache |
| Current year, cached ≥ 24h | Regenerate, update cache |
| POST `/api/wrapped/[year]` | Force-regenerate regardless of age |

`getCachedWrapped(year, locale)` reads from `wrapped_cache`, regenerates if stale, writes back.

---

## 3. Slide Catalogue

| # | Type | Key data | Condition |
|---|------|----------|-----------|
| 1 | `intro` | year, user pseudo | always |
| 2 | `total-time` | totalHours, comparison string | always |
| 3 | `most-played-game` | name, imagePath, hours, sessions | ≥ 1 session |
| 4 | `top-system` | system name, % time, donut breakdown | ≥ 1 session |
| 5 | `top-games-list` | top N games with playtime (N = min(5, games played)) | ≥ 2 games played |
| 6 | `longest-session` | game name, duration, date | ≥ 1 completed session |
| 7 | `busiest-day` | date, total hours that day | ≥ 1 session |
| 8 | `streak` | best streak days, heatmap data | streak ≥ 2 days |
| 9 | `achievements-summary` | count unlocked, total score, rarest | RA enabled + ≥ 1 achievement in year |
| 10 | `unlocks` | list of earned WrappedUnlock | unlocks.length ≥ 1 |
| 11 | `comparison-vs-others` | percentile (hardcoded averages) | ≥ 1 session |
| 12 | `outro` | year, share CTA | always |

---

## 4. Easter Egg Unlocks

Computed inside `generateWrapped`. All deterministic from session data.

| ID | Title | Condition | Rarity |
|----|-------|-----------|--------|
| `night-owl` | Insomniaque | > 10% playtime between 00:00–04:00 | uncommon |
| `speedrunner` | Speedrunner | > 30 sessions < 15 min | rare |
| `marathon-man` | Marathon Man | ≥ 1 session > 5h | rare |
| `diversified` | Diversifié | > 15 different systems | uncommon |
| `monogame` | Monogame | > 50% time on single game | legendary |
| `completionist` | Touche-à-tout | > 100 different games | uncommon |
| `early-bird` | Lève-tôt | > 30% playtime between 05:00–09:00 | uncommon |
| `weekend-warrior` | Weekend Warrior | > 70% playtime on Saturday/Sunday | common |
| `throwback` | Throwback Thursday | regular sessions on games released > 20 years ago | uncommon |
| `achievement-hunter` | Achievement Hunter | > 100 RA achievements unlocked in year | rare |
| `hardcore` | Hardcore | > 80% RA achievements earned in hardcore mode | legendary |

`achievement-hunter` and `hardcore` are only computed if RA is enabled.

---

## 5. Story Viewer

**Component tree** (all in `app/[locale]/wrapped/[year]/`):

```
StoryViewer (Client Component)
├── ProgressBar          — CSS animated segments (one per slide, 5s fill)
├── SlideShell           — glassmorphism wrapper, per-slide accent color
│   └── SlideRenderer    — switch on slide.type → specific slide component
└── ShareDialog          — format selector + preview + share/download
```

**State**:
```typescript
const [currentIndex, setCurrentIndex] = useState(0)
const [isPaused,     setIsPaused]     = useState(false)
```

**Navigation**:
- Tap right half → next slide
- Tap left half → previous slide
- Any tap → pause auto-advance (`isPaused = true`)
- Swipe: `pointerdown`/`pointerup` delta X > 50px

**Auto-advance**: `setInterval(5000)` active when `!isPaused`. A tap both pauses AND advances.

**View Transitions**: `document.startViewTransition(() => setCurrentIndex(i))` when API available, plain `setState` fallback.

**Per-slide accent colors** (`SLIDE_ACCENTS: Record<WrappedSlideType, string>`):

| Type | Accent |
|------|--------|
| intro | `#a855f7` (violet) |
| total-time | `#06b6d4` (cyan) |
| most-played-game | `#f97316` (orange) |
| top-system | `#10b981` (emerald) |
| top-games-list | `#eab308` (yellow) |
| longest-session | `#ef4444` (red) |
| busiest-day | `#3b82f6` (blue) |
| streak | `#f59e0b` (amber) |
| achievements-summary | `#8b5cf6` (purple) |
| unlocks | `#ec4899` (pink) |
| comparison-vs-others | `#14b8a6` (teal) |
| outro | `#6366f1` (indigo) |

**Glassmorphism shell** (`SlideShell`):
- Background: `#0a0a0a`
- Animated radial gradient glow behind glass card using slide accent
- Card: `backdrop-blur-xl`, `bg-white/5`, `border border-white/10`
- Watermark bottom-right: `github.com/m-meddah/recalbox-dashboard` (opacity 30%)

**No-data fallback**: if `wrapped.slides.length === 0`, viewer renders a centered message (i18n key `wrapped.noData.title` + `wrapped.noData.subtitle`) with a link back to `/stats`.

---

## 6. Animation Stack

- **View Transitions** (native React 19): slide-to-slide transitions
- **`motion`** package (`pnpm add motion`): animated counter (`AnimatedHours`), podium stagger (`top-games-list`), heatmap day-by-day fill (`streak`)
- **CSS keyframes**: progress bar fill, glow pulse

`AnimatedHours` implementation (from spec, using `motion` `useAnimate` or `animate()`):
```typescript
function AnimatedHours({ target }: { target: number }) {
  const [current, setCurrent] = useState(0)
  useEffect(() => {
    const duration = 2000, steps = 60
    let i = 0
    const id = setInterval(() => {
      i++
      setCurrent(Math.min(target, Math.round(target / steps * i)))
      if (i >= steps) clearInterval(id)
    }, duration / steps)
    return () => clearInterval(id)
  }, [target])
  return <span className="text-9xl font-black">{current}</span>
}
```

---

## 7. PNG Image Generation

**Route**: `GET /[locale]/wrapped/[year]/share/[slide]?format=story|square|landscape`

**Dimensions**:
| format | width × height |
|--------|---------------|
| `story` (default) | 1080 × 1920 |
| `square` | 1080 × 1080 |
| `landscape` | 1200 × 630 |

**`SlideImage`** component: pure JSX with CSS-in-JS (no Tailwind — Satori constraint). Mirrors the glassmorphism aesthetic using inline styles. Watermark bottom-right.

**Font**: `lib/wrapped/fonts.ts` — reads `apps/dashboard/assets/fonts/Inter-Bold.ttf` via `fs.readFile`. File must be added to the repo.

**Response headers**: `Cache-Control: public, max-age=3600`.

**ShareDialog**:
- Format selector (3 buttons)
- `<img>` preview auto-loading from share route
- Primary: `navigator.share({ files: [blob] })` if Web Share API available
- Fallback: `<a href={objectURL} download="wrapped-2026.png">`

---

## 8. Archive Page `/wrapped`

Lists years where: `sessions.count ≥ 1 AND (year < currentYear OR (year === currentYear AND month >= 12))`.

Per year card:
- Year number (large)
- KPI: `{hours}h jouées`
- Generation date
- "Revoir" button → `/wrapped/{year}`

---

## 9. Stats Preview Banner

Added to `app/[locale]/stats/[period]/page.tsx`. Shown when ≥ 1 session in current year. Uses a lightweight query (not the full generator):

```typescript
const wrappedPreview = await getWrappedPreview(currentYear)
// { hours: number, topGame: string | null }
```

Banner text: `"Ton Wrapped {year} prend forme — {hours}h • {topGame} en tête → Voir mon Wrapped"`

---

## 10. Translations

New `wrapped` namespace in both `fr.json` and `en.json`:

```
wrapped.nav.archive
wrapped.nav.regen
wrapped.intro.title           // "Voici ton année {year}"
wrapped.intro.subtitle
wrapped.totalTime.headline    // "{hours}h de jeu"
wrapped.totalTime.comparison  // "C'est comme regarder {movies} films d'affilée"
wrapped.mostPlayedGame.title
wrapped.topSystem.title
wrapped.topGamesList.title
wrapped.longestSession.headline  // "Ta plus longue partie : {duration} sur {game}"
wrapped.busiestDay.headline      // "Ton jour le plus actif : {date}"
wrapped.streak.headline          // "{days} jours consécutifs"
wrapped.achievements.headline
wrapped.unlocks.title            // "Tes badges secrets"
wrapped.unlocks.rarity.common
wrapped.unlocks.rarity.uncommon
wrapped.unlocks.rarity.rare
wrapped.unlocks.rarity.legendary
wrapped.comparison.headline      // "Tu es dans le top {percent}%"
wrapped.comparison.disclaimer    // "Chiffres estimés, pas de tracking"
wrapped.outro.title
wrapped.outro.share
wrapped.noData.title             // "Aucune session en {year}"
wrapped.noData.subtitle          // "Joue et reviens !"
wrapped.archive.hoursPlayed      // "{hours}h jouées"
wrapped.archive.generatedOn      // "Généré le {date}"
```

---

## 11. Tests

`lib/wrapped/__tests__/generator.test.ts`:
- Each unlock condition tested with a minimal mock dataset satisfying exactly the threshold
- Edge cases: 0 sessions → `{ slides: [], unlocks: [] }`, 1 session, 1 game only
- `achievements-summary` slide absent when `retroachievements.enabled = false`
- `achievement-hunter` and `hardcore` unlocks absent when RA disabled
- Every slide type returns valid (non-null) data when sufficient mock data provided
- Cache: past year is never regenerated; current year regenerates after 24h

---

## 12. Privacy

Slide `comparison-vs-others` uses hardcoded average values (no telemetry, no tracking). Comment in code: `// Estimated averages — no user tracking`.

---

## 13. Performance Targets

| Operation | Target |
|-----------|--------|
| `generateWrapped()` cold | < 1s |
| PNG image generation | < 200ms |
| Story slide transition | 60 FPS |
| Browser cache on PNG | 1h (`max-age=3600`) |

---

## 14. Commit

```
feat(wrapped): annual recap with shareable images
```
