# Navbar Theme & Language Selectors

**Date:** 2026-05-15  
**Status:** Approved

## Goal

Add a dark/light theme toggle and a language switcher (fr/en) to the navbar, visible on every page.

## Context

- `next-themes` ^0.4.6 is already installed
- Dark CSS variables already defined in `globals.css` using `.dark` class (via `@custom-variant dark (&:is(.dark *))`)
- `LanguageSwitcher` component already exists at `components/language-switcher.tsx` (shadcn Select, flags + labels) but is not wired into the navbar
- Navbar lives in `app/[locale]/layout.tsx` (Server Component)

## Target Layout

```
[ Home | Collection | Stats | Achievements | Settings ]    [ 🌙 ][ FR ▾ ]
```

Nav links on the left, theme toggle + language switcher grouped on the right via `ml-auto`.

## Changes

### 1. `app/[locale]/layout.tsx`

- Add `ThemeProvider` from `next-themes` wrapping body content, with `attribute="class"` and `defaultTheme="system"`
- Add `suppressHydrationWarning` on `<html>` element to prevent SSR/client mismatch
- Update navbar: add `ml-auto flex items-center gap-2` container on the right with `<ThemeToggle />` and `<LanguageSwitcher />`

### 2. `components/theme-toggle.tsx` (new file)

- Client component (`'use client'`)
- Uses `useTheme` from `next-themes`
- Renders `Button variant="ghost" size="icon"` from shadcn
- Shows `Sun` icon when theme is dark, `Moon` icon when light (icons from `lucide-react`)
- Clicking toggles between `'light'` and `'dark'`

### 3. `components/language-switcher.tsx`

- No changes — reuse as-is

## What Does Not Change

- CSS dark variables — already complete
- `LanguageSwitcher` logic — already complete
- i18n routing — no changes needed

## Files Touched

| File | Change |
|------|--------|
| `app/[locale]/layout.tsx` | Add ThemeProvider, suppressHydrationWarning, right-side nav controls |
| `components/theme-toggle.tsx` | New file |
