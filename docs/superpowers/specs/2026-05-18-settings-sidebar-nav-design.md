# Settings Page — Sidebar Navigation

**Date:** 2026-05-18  
**Status:** Approved  

## Problem

The settings page has 7 tabs rendered with `grid grid-cols-7` inside a `max-w-2xl` container (~672px). Each tab gets ~96px — not enough for labels like "retroachievements". The result is visually cramped and ugly.

## Solution

Replace the horizontal `Tabs` component with a two-column sidebar layout:
- Left: vertical nav sidebar (~208px, `w-52`)
- Right: content area (`flex-1`)

This is the standard pattern for settings pages with 5+ sections (GitHub, Vercel, VS Code).

## Layout

```
┌──────────── max-w-4xl ──────────────────────────────────────┐
│ Settings                                                    │
│ Configure your dashboard                                    │
├───────────────┬─────────────────────────────────────────────┤
│  w-52         │  flex-1                                     │
│  sticky       │                                             │
│  [nav items]  │  [Card with form content]                   │
│               │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

On mobile (`< md`): the sidebar collapses to a horizontal scrollable bar above the content, showing icon + short label per item.

## Sidebar Nav Items

| Value | Label (full) | Icon (Lucide) | Mobile label |
|---|---|---|---|
| `recalbox` | Recalbox | `Server` | Recalbox |
| `scrobble` | Scrobble | `Clock` | Scrobble |
| `interface` | Interface | `Palette` | UI |
| `retroachievements` | RetroAchievements | `Trophy` | Retro |
| `integrations` | Intégrations | `Plug` | Intégr. |
| `notifications` | Notifications | `Bell` | Notifs |
| `app` | Application | `Smartphone` | App |

Active state: `bg-accent text-accent-foreground rounded-md`.  
Hover state: `hover:bg-accent/50`.

## State Management

Replace the shadcn `Tabs` component with a local `useState<string>` for the active section. The tab content components (`RecalboxTab`, `ScrobbleTab`, etc.) are unchanged — only the navigation shell changes.

```tsx
const [active, setActive] = useState('recalbox')
```

## Content Area

The `Card` + `CardHeader` + `CardContent` wrappers for each section remain identical. Only the surrounding navigation changes.

## Mobile Behaviour

Below `md` breakpoint, the sidebar becomes a horizontally scrollable flex row pinned above the content. Each button shows icon + short label. No dropdown or select — keeps visual consistency with the desktop experience.

## Files Changed

- `apps/dashboard/app/[locale]/settings/page.tsx` — only file to modify
  - Container: `max-w-2xl` → `max-w-4xl`
  - Replace `<Tabs>` / `<TabsList>` / `<TabsTrigger>` with custom sidebar + `useState`
  - Add `SidebarNav` component (inlined in the same file)
  - `TabsContent` wrappers replaced with conditional rendering

## Out of Scope

- No changes to form logic, validation, or API calls
- No changes to individual tab content components
- No i18n changes (labels already exist as `t('tabs.*')`)
