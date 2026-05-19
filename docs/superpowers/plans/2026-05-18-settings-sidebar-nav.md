# Settings Page — Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 7-tab horizontal grid in the settings page with a vertical sidebar nav + content area layout.

**Architecture:** Single file change. Add a `SidebarNav` component (inlined in the same file), swap `useState` for active section tracking instead of Radix Tabs, and use conditional rendering for section content. Desktop: sidebar left + content right. Mobile: horizontal scrollable nav above content.

**Tech Stack:** Next.js App Router, React `useState`, Tailwind CSS, Lucide React icons, `cn` from `@/lib/utils`

---

### Task 1: Update imports

**Files:**
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx`

- [ ] **Step 1: Replace Lucide import line (line 6)**

Replace:
```tsx
import { CheckCircle2, Circle } from 'lucide-react'
```
With:
```tsx
import { Bell, CheckCircle2, Circle, Clock, Palette, Plug, Server, Smartphone, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
```

- [ ] **Step 2: Remove the Tabs import line (line 25)**

Remove this line entirely:
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
```

- [ ] **Step 3: Add cn import after the existing React import**

After `import { useEffect, useState } from 'react'`, add:
```tsx
import { cn } from '@/lib/utils'
```

- [ ] **Step 4: Verify no type errors**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -30
```
Expected: zero new errors introduced.

---

### Task 2: Add SidebarNav component

**Files:**
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx` — insert just above the `// ─── Page` comment (around line 893)

- [ ] **Step 1: Insert NavItem type and SidebarNav component**

Insert this block immediately before the `// ─── Page` comment:

```tsx
// ─── Sidebar Nav ─────────────────────────────────────────────────────────────

type NavItem = { value: string; icon: LucideIcon; label: string; mobileLabel: string }

function SidebarNav({
	items,
	active,
	onSelect,
}: {
	items: NavItem[]
	active: string
	onSelect: (value: string) => void
}) {
	return (
		<>
			<nav className="hidden md:flex flex-col gap-1 w-52 shrink-0">
				{items.map((item) => (
					<button
						key={item.value}
						type="button"
						onClick={() => onSelect(item.value)}
						className={cn(
							'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-left transition-colors',
							active === item.value
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
						)}
					>
						<item.icon className="h-4 w-4 shrink-0" />
						{item.label}
					</button>
				))}
			</nav>
			<nav className="flex md:hidden gap-1 overflow-x-auto pb-2 shrink-0">
				{items.map((item) => (
					<button
						key={item.value}
						type="button"
						onClick={() => onSelect(item.value)}
						className={cn(
							'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors',
							active === item.value
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
						)}
					>
						<item.icon className="h-4 w-4 shrink-0" />
						{item.mobileLabel}
					</button>
				))}
			</nav>
		</>
	)
}
```

---

### Task 3: Update SettingsPage

**Files:**
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx` — `SettingsPage` function

- [ ] **Step 1: Add `active` state inside SettingsPage**

After `const [loading, setLoading] = useState(true)`, add:
```tsx
const [active, setActive] = useState('recalbox')
```

- [ ] **Step 2: Add navItems array inside SettingsPage**

After the `useEffect` block (before the loading/error early returns), add:
```tsx
const navItems: NavItem[] = [
	{ value: 'recalbox', icon: Server, label: t('tabs.recalbox'), mobileLabel: 'Recalbox' },
	{ value: 'scrobble', icon: Clock, label: t('tabs.scrobble'), mobileLabel: 'Scrobble' },
	{ value: 'interface', icon: Palette, label: t('tabs.interface'), mobileLabel: 'UI' },
	{ value: 'retroachievements', icon: Trophy, label: t('tabs.retroachievements'), mobileLabel: 'Retro' },
	{ value: 'integrations', icon: Plug, label: t('tabs.integrations'), mobileLabel: 'Intégr.' },
	{ value: 'notifications', icon: Bell, label: t('tabs.notifications'), mobileLabel: 'Notifs' },
	{ value: 'app', icon: Smartphone, label: t('tabs.app'), mobileLabel: 'App' },
]
```

- [ ] **Step 3: Replace the entire return block**

Replace everything from `return (` to the closing `)` of `SettingsPage` with:

```tsx
	return (
		<div className="container max-w-4xl mx-auto p-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground text-sm">{t('subtitle')}</p>
			</div>
			<div className="flex flex-col md:flex-row gap-8">
				<SidebarNav items={navItems} active={active} onSelect={setActive} />
				<div className="flex-1 min-w-0">
					{active === 'recalbox' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('recalbox.cardTitle')}</CardTitle>
								<CardDescription>{t('recalbox.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<RecalboxTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'scrobble' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('scrobble.cardTitle')}</CardTitle>
								<CardDescription>{t('scrobble.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<ScrobbleTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'interface' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('interface.cardTitle')}</CardTitle>
								<CardDescription>{t('interface.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<UiTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'retroachievements' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('retroachievements.cardTitle')}</CardTitle>
								<CardDescription>{t('retroachievements.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<RetroAchievementsTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'integrations' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('integrations.cardTitle')}</CardTitle>
								<CardDescription>{t('integrations.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<IntegrationsTab config={config} />
							</CardContent>
						</Card>
					)}
					{active === 'notifications' && <NotificationsTab />}
					{active === 'app' && (
						<Card>
							<CardHeader>
								<CardTitle>{t('app.cardTitle')}</CardTitle>
								<CardDescription>{t('app.cardDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<AppTab />
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</div>
	)
```

- [ ] **Step 4: Verify, lint, commit**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -20
pnpm lint 2>&1 | tail -20
```
Expected: no errors.

```bash
git add apps/dashboard/app/\[locale\]/settings/page.tsx
git commit -m "feat(settings): replace horizontal tabs with vertical sidebar nav"
```
