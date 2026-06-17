# IGDB Review — Filtrage par système

**Date :** 2026-06-05  
**Branche :** feat/recalbox-ui-refonte  
**Problème :** La page `/settings/igdb/review` charge jusqu'à 3000 items d'un coup, rendant `useOptimistic` inefficace et la page très lente.

## Objectif

Restructurer la page de review IGDB pour afficher les jeux filtrés par système via un layout sidebar + liste. Charger uniquement les items du système actif côté serveur.

---

## API

### Nouvel endpoint — `GET /api/igdb/review/systems`

Retourne la liste des systèmes ayant au moins un item `needsReview = true`, triés par nombre d'items décroissant.

```ts
// Response
{ systems: { system: string; count: number }[] }
```

Requête Drizzle :
```ts
db.select({
  system: games.system,
  count: sql<number>`count(*)`.as('count'),
})
.from(gameIgdbMapping)
.innerJoin(games, eq(games.id, gameIgdbMapping.gameId))
.where(eq(gameIgdbMapping.needsReview, true))
.groupBy(games.system)
.orderBy(desc(sql`count(*)`))
```

### Endpoint existant modifié — `GET /api/igdb/review?system=:system`

Ajoute un filtre `AND games.system = system` quand le query param `system` est fourni. Sans param, le comportement actuel est conservé (retourne tous les items — rétrocompatibilité).

### Endpoint confirm — inchangé

`POST /api/igdb/review/confirm` reste tel quel.

---

## Page — `app/[locale]/settings/igdb/review/page.tsx`

### Layout

```
┌──────────────────┬────────────────────────────────────┐
│  Sidebar (w-56)  │  Zone de contenu (flex-1)           │
│                  │                                     │
│  SNES       47   │  47 jeux à reviewer (SNES)          │
│  PS1        31   │  ┌──────────────────────────────┐   │
│  NES         8   │  │ Super Mario World            │   │
│  GBA         3   │  │  A ✓  B ✓  Aucun ✗           │   │
│                  │  └──────────────────────────────┘   │
│                  │  ┌──────────────────────────────┐   │
│                  │  │ Zelda LTTP                   │   │
│                  │  └──────────────────────────────┘   │
└──────────────────┴────────────────────────────────────┘
```

- Sidebar : fixe, non-scrollable, liste des systèmes avec badge count
- Système actif : fond coloré + texte primaire
- Zone droite : scrollable, titre avec count, liste des items du système actif
- Le badge count de la sidebar se décrémente localement après chaque action (sans refetch)

### State

```ts
const [systems, setSystems] = useState<{ system: string; count: number }[]>([])
const [activeSystem, setActiveSystem] = useState<string | null>(null)
const [items, setItems] = useState<ReviewItem[]>([])
const [loadingSystems, setLoadingSystems] = useState(true)
const [loadingItems, setLoadingItems] = useState(false)

const [optimisticItems, removeOptimistic] = useOptimistic(
  items,
  (state, gameId: number) => state.filter(item => item.gameId !== gameId),
)
```

### Machine d'état (flux)

```
mount
  → fetch /api/igdb/review/systems
  → setSystems(data.systems)
  → autoSelect: setActiveSystem(systems[0].system)

activeSystem change
  → setLoadingItems(true)
  → fetch /api/igdb/review?system=activeSystem
  → setItems(data.items)
  → setLoadingItems(false)

action utilisateur (confirm / reject / manual)
  → startTransition:
      removeOptimistic(gameId)          // retire visuellement immédiat
      POST /api/igdb/review/confirm
      si ok:
        setItems(prev => prev.filter(...))          // état définitif
        setSystems(prev => prev
          .map(s => s.system === activeSystem
            ? { ...s, count: s.count - 1 }
            : s)
          .filter(s => s.count > 0)               // retire si terminé
        )
        si items désormais vides:
          setActiveSystem(systems[0]?.system ?? null)  // prochain système

click sur un système dans la sidebar
  → setActiveSystem(system)             // déclenche le useEffect ci-dessus
```

### Gestion des cas limites

- **Tous les systèmes terminés** : sidebar vide, zone droite affiche le message "Tout bon" existant (`igdbReview.allGood`)
- **Erreur réseau sur confirm** : `useOptimistic` revient automatiquement à l'état précédent (comportement natif de `useOptimistic` dans une `startTransition`)
- **Changement de système pendant un confirm en cours** : le confirm se termine sur le système précédent, `setItems` filter sur l'ancien système ne cause pas d'incohérence car `items` est remplacé au changement de système

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `app/api/igdb/review/route.ts` | Ajouter filtre `system` optionnel |
| `app/api/igdb/review/systems/route.ts` | Nouveau endpoint (créer le fichier) |
| `app/[locale]/settings/igdb/review/page.tsx` | Refonte complète avec sidebar + state machine |

---

## Ce qui ne change pas

- `app/api/igdb/review/confirm/route.ts` — inchangé
- Types `ReviewItem` et `IgdbCandidate` — inchangés
- Le rendu d'un item individuel (card avec candidates / confirm / reject / manual) — inchangé, juste extrait dans un composant interne pour clarté
