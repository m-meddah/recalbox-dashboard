# Contributing Translations

The dashboard supports **English** (`en`) and **French** (`fr`). Adding a new language takes about 30 minutes and requires no code changes beyond the files listed below.

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 9
- Familiarity with [ICU message syntax](https://unicode-org.github.io/icu/userguide/format_parse/messages/) (used for plurals and interpolation)

---

## Steps

### 1. Copy the English catalogue

```bash
cp apps/dashboard/messages/en.json apps/dashboard/messages/<locale>.json
# e.g. apps/dashboard/messages/de.json
```

### 2. Translate all strings

Open `messages/<locale>.json` and translate every value.

**Rules:**
- Keep all ICU placeholders (`{count}`, `{minutes}`, etc.) **exactly as-is**
- Keep ICU plural keywords (`=0`, `one`, `other`) intact — only translate the human-readable parts
- Do **not** rename keys — only change values

**Example (plural):**
```json
// EN
"gamesCount": "{count, plural, =0 {No games} one {1 game} other {# games}}"

// DE
"gamesCount": "{count, plural, =0 {Keine Spiele} one {1 Spiel} other {# Spiele}}"
```

### 3. Register the locale in the router

Edit `apps/dashboard/i18n/routing.ts`:

```typescript
export const routing = defineRouting({
  locales: ['en', 'fr', '<your-locale>'] as const,  // ← add here
  defaultLocale: 'en',
  localePrefix: 'always',
})
```

### 4. Add the flag in the language switcher

Edit `apps/dashboard/components/language-switcher.tsx`:

```typescript
const LOCALE_LABELS: Record<string, string> = {
  en: '🇬🇧 English',
  fr: '🇫🇷 Français',
  de: '🇩🇪 Deutsch',  // ← add here
}
```

### 5. Test locally

```bash
pnpm dev
```

Navigate to `http://localhost:3000/<locale>` — e.g. `http://localhost:3000/de`.

Switch language via **Settings → Interface → Language**.

### 6. Run the integrity tests

```bash
pnpm test
```

The `i18n.test.ts` suite checks:
- All locales have the same keys as English
- No empty strings
- ICU placeholders match across all locales

### 7. Open a PR

Include:
- `messages/<locale>.json`
- Updated `i18n/routing.ts`
- Updated `language-switcher.tsx`
- Screenshots of at least 3 pages in the new locale

---

## Locale codes

Use [BCP 47](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry) language tags:

| Language | Code |
|----------|------|
| English  | `en` |
| French   | `fr` |
| German   | `de` |
| Spanish  | `es` |
| Italian  | `it` |
| Portuguese | `pt` |
| Japanese | `ja` |

## Questions?

Open an issue on GitHub or check existing PRs for examples.
