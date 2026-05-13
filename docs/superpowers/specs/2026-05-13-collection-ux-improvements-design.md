# Collection UX Improvements — Design Spec

**Date:** 2026-05-13  
**Scope:** `/collection` and `/collection/[system]` pages

---

## Problem

The collection page has three UX issues:
1. System navigation is a flat wall of badges with no hierarchy or search — hard to use with 20+ consoles.
2. Region filter exposes all regions in the database (up to 12), most of which are noise.
3. Game cover images are cropped left/right because `object-cover` fills the 3/4 container, cutting off artwork.

---

## Changes

### 1. System Selector — Combobox

**Component:** new `SystemSelector` client component  
**Location:** `apps/dashboard/components/system-selector.tsx`

**Props:**
```ts
type Props = {
  systems: { name: string; count: number }[]
  currentSystem?: string  // undefined on /collection, system slug on /collection/[system]
}
```

**Behaviour:**
- Renders a Popover + Command (shadcn/ui) trigger button.
- Trigger label: `"Toutes les consoles"` when no system is active, or the active system name (capitalized).
- The Command panel has a search input that filters systems by name in real time.
- Each list item shows `{name} · {count} jeu(x)`.
- First item in the list is always `"Toutes les consoles"` → navigates to `/collection`.
- Selecting a system → `router.push('/collection/[name]')`, closes the popover.
- The trigger shows a `ChevronDown` icon; active system gets a visual highlight (primary color).

**Integration:**
- `CollectionPage` (`/collection`) passes `sortedSystems` and no `currentSystem`.
- `SystemCollectionPage` (`/collection/[system]`) passes `sortedSystems` and the current `system` slug.
- The existing badge section is replaced by the `SystemSelector`.

**Dependencies:** `Command` and `Popover` from shadcn/ui are **not yet installed**. Add them before implementing:
```bash
pnpm --filter @recalbox/dashboard dlx shadcn@latest add command popover
```

---

### 2. Region Filter — Allow-list

**File:** `apps/dashboard/components/collection-filters.tsx`

**Change:** After receiving regions from the API, filter to only keep entries present in the allow-list `['fr', 'eu', 'us', 'jp', 'world']`. Order follows the allow-list order.

**Label update:** `world` → `WOR` (update `REGION_LABELS`).

**Result:** At most 5 region buttons, only shown if data for that region exists.

---

### 3. Game Card Image — No Crop

**File:** `apps/dashboard/components/game-card.tsx`

**Change:** `className="object-cover …"` → `className="object-contain …"` on the `<Image>` component.

The container already has `bg-muted` so the neutral grey background fills the empty space around jaquettes that don't match the 3/4 ratio. No other changes needed.

---

## Files Touched

| File | Change |
|------|--------|
| `components/system-selector.tsx` | New file |
| `app/collection/page.tsx` | Replace badge section with `<SystemSelector>` |
| `app/collection/[system]/page.tsx` | Add `<SystemSelector>` with `currentSystem` |
| `components/collection-filters.tsx` | Allow-list regions, update `world` label |
| `components/game-card.tsx` | `object-cover` → `object-contain` |

---

## Out of Scope

- Grouping systems by manufacturer (dropdown-with-search covers the discovery need).
- Changing the sort/favorites/neverPlayed filters.
- Pagination or grid layout changes.
