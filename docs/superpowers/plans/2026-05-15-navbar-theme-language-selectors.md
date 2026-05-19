# Navbar Theme & Language Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dark/light theme toggle button and the existing language switcher to the navbar, visible on every page.

**Architecture:** `next-themes` is already installed and dark CSS variables are already defined. We create a `ThemeToggle` client component (Sun/Moon icon button), wire a `ThemeProvider` into the locale layout, and add both controls to the right side of the navbar.

**Tech Stack:** Next.js 15 App Router, next-themes ^0.4.6, next-intl, lucide-react, shadcn Button (base-ui)

---

### Task 1: Create ThemeToggle component

**Files:**
- Create: `apps/dashboard/components/theme-toggle.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme()

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
			aria-label="Toggle theme"
		>
			{resolvedTheme === 'dark' ? <Sun /> : <Moon />}
		</Button>
	)
}
```

Note: `resolvedTheme` (not `theme`) is used because `theme` can be `'system'` — `resolvedTheme` is always `'light'` or `'dark'`.

- [ ] **Step 2: Verify TypeScript is happy**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: no errors.

---

### Task 2: Wire ThemeProvider and update the navbar

**Files:**
- Modify: `apps/dashboard/app/[locale]/layout.tsx`

- [ ] **Step 1: Add the ThemeProvider import and update the layout**

Replace the contents of `apps/dashboard/app/[locale]/layout.tsx` with:

```tsx
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import '../globals.css'
import { RecalboxEventsProvider } from '../recalbox-events-provider'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { routing } from '@/i18n/routing'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageSwitcher } from '@/components/language-switcher'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

type Props = {
	children: React.ReactNode
	params: Promise<{ locale: string }>
}

export async function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params
	return {
		title: 'Recalbox Dashboard',
		description:
			'Companion analytics dashboard for your Recalbox — playtime history, achievement progress, and an annual recap.',
	} satisfies Metadata
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params

	if (!hasLocale(routing.locales, locale)) {
		notFound()
	}

	setRequestLocale(locale)

	const t = await getTranslations({ locale, namespace: 'nav' })

	return (
		<html lang={locale} className={cn('font-sans', geist.variable)} suppressHydrationWarning>
			<body>
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
					<NextIntlClientProvider>
						<RecalboxEventsProvider>
							<header className="border-b px-6 py-3">
								<nav className="flex items-center gap-6">
									<Link href="/" className="text-sm font-semibold hover:text-primary">
										{t('home')}
									</Link>
									<Link
										href="/collection"
										className="text-sm text-muted-foreground hover:text-foreground"
									>
										{t('collection')}
									</Link>
									<Link
										href="/stats"
										className="text-sm text-muted-foreground hover:text-foreground"
									>
										{t('stats')}
									</Link>
									<Link
										href="/achievements"
										className="text-sm text-muted-foreground hover:text-foreground"
									>
										{t('achievements')}
									</Link>
									<Link
										href="/settings"
										className="text-sm text-muted-foreground hover:text-foreground"
									>
										{t('settings')}
									</Link>
									<div className="ml-auto flex items-center gap-2">
										<ThemeToggle />
										<LanguageSwitcher />
									</div>
								</nav>
							</header>
							{children}
						</RecalboxEventsProvider>
					</NextIntlClientProvider>
				</ThemeProvider>
			</body>
		</html>
	)
}
```

Key changes vs original:
- `ThemeProvider` wraps everything inside `<body>`, with `attribute="class"` (applies `.dark` to `<html>`) and `enableSystem`
- `suppressHydrationWarning` on `<html>` (required by next-themes to avoid SSR mismatch)
- Right-side `div` with `ml-auto` containing `<ThemeToggle />` and `<LanguageSwitcher />`

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and manually verify**

```bash
pnpm dev
```

Open http://localhost:3000 and check:
- Navbar shows Moon icon (or Sun if OS is in dark mode) on the right, next to the language selector
- Clicking the Moon icon switches to dark mode (background goes dark, icon switches to Sun)
- Clicking Sun switches back to light mode
- Refreshing the page preserves the theme choice (next-themes persists in localStorage)
- Changing language via the Select still works (fr ↔ en)
- Theme persists when switching language

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/theme-toggle.tsx apps/dashboard/app/[locale]/layout.tsx
git commit -m "feat(ui): add theme toggle and language switcher to navbar"
```
