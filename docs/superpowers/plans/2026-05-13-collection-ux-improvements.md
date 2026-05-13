# Collection UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer l'UX de la page collection : sélecteur de systèmes en combobox, filtre régions simplifié à 5 valeurs, images non croppées.

**Architecture:** Nouveau composant `SystemSelector` (Popover + Command) remplace les badges systèmes. `CollectionFilters` filtre les régions côté client. `GameCard` passe de `object-cover` à `object-contain`.

**Tech Stack:** Next.js 16 App Router, shadcn/ui (Command + Popover à installer), Tailwind CSS, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/dashboard/components/ui/command.tsx` | Install via CLI | shadcn Command primitive |
| `apps/dashboard/components/ui/popover.tsx` | Install via CLI | shadcn Popover primitive |
| `apps/dashboard/components/system-selector.tsx` | Create | Combobox systèmes avec recherche |
| `apps/dashboard/app/collection/page.tsx` | Modify | Intégrer SystemSelector, supprimer badges |
| `apps/dashboard/app/collection/[system]/page.tsx` | Modify | Intégrer SystemSelector avec currentSystem |
| `apps/dashboard/components/collection-filters.tsx` | Modify | Allow-list régions + label WOR |
| `apps/dashboard/components/game-card.tsx` | Modify | object-cover → object-contain |

---

## Task 1: Installer les composants shadcn/ui manquants

**Files:**
- Create: `apps/dashboard/components/ui/command.tsx`
- Create: `apps/dashboard/components/ui/popover.tsx`

- [ ] **Step 1: Installer Command et Popover**

Depuis la racine du monorepo :
```bash
pnpm --filter @recalbox/dashboard dlx shadcn@latest add command popover
```

Expected output: deux nouveaux fichiers créés dans `apps/dashboard/components/ui/`.

- [ ] **Step 2: Vérifier les fichiers créés**

```bash
ls apps/dashboard/components/ui/ | grep -E "command|popover"
```

Expected: `command.tsx` et `popover.tsx` apparaissent.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/ui/command.tsx apps/dashboard/components/ui/popover.tsx
git commit -m "chore: add shadcn command and popover primitives"
```

---

## Task 2: Fix images non croppées dans GameCard

**Files:**
- Modify: `apps/dashboard/components/game-card.tsx:39`

- [ ] **Step 1: Changer object-cover en object-contain**

Dans `apps/dashboard/components/game-card.tsx`, ligne ~39, remplacer :

```tsx
className="object-cover transition-transform duration-300 group-hover:scale-105"
```

par :

```tsx
className="object-contain transition-transform duration-300 group-hover:scale-105"
```

Le conteneur parent a déjà `bg-muted` — le fond gris neutre remplira l'espace vide autour des jaquettes dont le ratio ne correspond pas au 3/4 de la card.

- [ ] **Step 2: Vérifier visuellement**

Lancer le dev server si pas déjà démarré :
```bash
pnpm dev
```

Ouvrir http://localhost:3000/collection et vérifier que les jaquettes ne sont plus croppées.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/game-card.tsx
git commit -m "fix(collection): use object-contain on game covers to prevent cropping"
```

---

## Task 3: Simplifier le filtre régions

**Files:**
- Modify: `apps/dashboard/components/collection-filters.tsx`

- [ ] **Step 1: Mettre à jour REGION_LABELS et ajouter la constante allow-list**

Dans `apps/dashboard/components/collection-filters.tsx`, remplacer le bloc `REGION_LABELS` existant (lignes 12-25) par :

```tsx
const ALLOWED_REGIONS = ['fr', 'eu', 'us', 'jp', 'world'] as const

const REGION_LABELS: Record<string, string> = {
  fr: 'FR',
  eu: 'EU',
  us: 'US',
  jp: 'JP',
  world: 'WOR',
}
```

- [ ] **Step 2: Filtrer les régions reçues de l'API**

Dans le même fichier, à l'endroit où on stocke les régions (ligne ~39), modifier le `.then` pour filtrer :

```tsx
.then((data: { regions: string[] }) =>
  setRegions(data.regions.filter((r) => (ALLOWED_REGIONS as readonly string[]).includes(r)).sort(
    (a, b) => (ALLOWED_REGIONS as readonly string[]).indexOf(a) - (ALLOWED_REGIONS as readonly string[]).indexOf(b)
  ))
)
```

- [ ] **Step 3: Vérifier visuellement**

Sur http://localhost:3000/collection, le filtre régions ne doit plus montrer DE, ES, IT, UK, AU, KR, CN. Seuls FR, EU, US, JP, WOR apparaissent (si des données existent pour ces régions).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/collection-filters.tsx
git commit -m "fix(collection): restrict region filter to FR/EU/US/JP/WOR"
```

---

## Task 4: Créer le composant SystemSelector

**Files:**
- Create: `apps/dashboard/components/system-selector.tsx`

- [ ] **Step 1: Créer le fichier**

Créer `apps/dashboard/components/system-selector.tsx` avec ce contenu :

```tsx
'use client'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChevronDown, Monitor } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  systems: { name: string; count: number }[]
  currentSystem?: string
}

export function SystemSelector({ systems, currentSystem }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const totalGames = systems.reduce((sum, s) => sum + s.count, 0)

  const handleSelect = (system: string | null) => {
    setOpen(false)
    router.push(system ? `/collection/${system}` : '/collection')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-56 justify-between"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {currentSystem ? (
                <span className="capitalize">{currentSystem}</span>
              ) : (
                <span className="text-muted-foreground">Toutes les consoles</span>
              )}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher une console…" />
          <CommandList>
            <CommandEmpty>Aucune console trouvée.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => handleSelect(null)}
                className={cn(!currentSystem && 'bg-accent font-medium')}
              >
                <span className="flex-1">Toutes les consoles</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {totalGames.toLocaleString('fr-FR')}
                </span>
              </CommandItem>
              {systems.map((s) => (
                <CommandItem
                  key={s.name}
                  value={s.name}
                  onSelect={() => handleSelect(s.name)}
                  className={cn(currentSystem === s.name && 'bg-accent font-medium')}
                >
                  <span className="flex-1 capitalize">{s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.count.toLocaleString('fr-FR')}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Vérifier que le build TypeScript passe**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/system-selector.tsx
git commit -m "feat(collection): add SystemSelector combobox component"
```

---

## Task 5: Intégrer SystemSelector dans les pages collection

**Files:**
- Modify: `apps/dashboard/app/collection/page.tsx`
- Modify: `apps/dashboard/app/collection/[system]/page.tsx`

- [ ] **Step 1: Mettre à jour `/collection/page.tsx`**

Remplacer le contenu de `apps/dashboard/app/collection/page.tsx` par :

```tsx
import { CollectionFilters } from '@/components/collection-filters'
import { CollectionGrid } from '@/components/collection-grid'
import { SyncButton } from '@/components/sync-button'
import { SystemSelector } from '@/components/system-selector'
import { Separator } from '@/components/ui/separator'
import { getCollectionStats } from '@/lib/db/queries'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function CollectionPage() {
  const stats = await getCollectionStats()

  const sortedSystems = Object.entries(stats.bySystem)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  return (
    <div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Collection</h1>
          <p className="text-sm text-muted-foreground">
            {stats.totalGames.toLocaleString('fr-FR')} jeux · {stats.favorites} favoris ·{' '}
            {stats.neverPlayed} jamais joués · {sortedSystems.length} systèmes
          </p>
        </div>
        <SyncButton />
      </div>

      <Separator />

      {/* System selector + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SystemSelector systems={sortedSystems} />
        <Separator orientation="vertical" className="h-8" />
        <Suspense>
          <CollectionFilters />
        </Suspense>
      </div>

      {/* Game grid */}
      <CollectionGrid />
    </div>
  )
}
```

- [ ] **Step 2: Mettre à jour `/collection/[system]/page.tsx`**

Remplacer le contenu de `apps/dashboard/app/collection/[system]/page.tsx` par :

```tsx
import { CollectionFilters } from '@/components/collection-filters'
import { CollectionGrid } from '@/components/collection-grid'
import { SyncButton } from '@/components/sync-button'
import { SystemSelector } from '@/components/system-selector'
import { Separator } from '@/components/ui/separator'
import { getCollectionStats } from '@/lib/db/queries'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ system: string }>
}

export default async function SystemCollectionPage({ params }: Props) {
  const { system } = await params
  const stats = await getCollectionStats()
  const gameCount = stats.bySystem[system] ?? 0

  const sortedSystems = Object.entries(stats.bySystem)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  return (
    <div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/collection" className="hover:text-foreground">
          Collection
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-foreground capitalize">{system}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold capitalize">{system}</h1>
          <p className="text-sm text-muted-foreground">
            {gameCount.toLocaleString('fr-FR')} jeu{gameCount > 1 ? 'x' : ''}
          </p>
        </div>
        <SyncButton system={system} />
      </div>

      <Separator />

      {/* System selector + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SystemSelector systems={sortedSystems} currentSystem={system} />
        <Separator orientation="vertical" className="h-8" />
        <Suspense>
          <CollectionFilters system={system} />
        </Suspense>
      </div>

      {/* Game grid */}
      <CollectionGrid system={system} />
    </div>
  )
}
```

- [ ] **Step 3: Vérifier le build TypeScript**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: aucune erreur.

- [ ] **Step 4: Vérifier le lint**

```bash
pnpm lint
```

Expected: aucune erreur Biome.

- [ ] **Step 5: Vérifier visuellement**

Sur http://localhost:3000/collection :
- Le combobox "Toutes les consoles" apparaît en haut à gauche des filtres.
- Cliquer dessus ouvre la liste avec une barre de recherche.
- Taper une lettre filtre les consoles en temps réel.
- Sélectionner une console navigue vers `/collection/[system]`.
- Sur `/collection/[system]`, le combobox affiche le système actif.
- Sélectionner "Toutes les consoles" retourne sur `/collection`.
- Les anciens badges systèmes ont disparu.

- [ ] **Step 6: Commit final**

```bash
git add apps/dashboard/app/collection/page.tsx apps/dashboard/app/collection/[system]/page.tsx
git commit -m "feat(collection): replace system badges with searchable combobox"
```
