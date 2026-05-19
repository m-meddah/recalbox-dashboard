# Power Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shutdown and reboot buttons to the navbar that send SSH commands to the Recalbox, with an AlertDialog confirmation and a sonner toast on success.

**Architecture:** A testable lib function (`system-power.ts`) wraps the SSH call; a thin Next.js route calls it; a client component (`PowerControls`) renders two icon buttons, each opening an AlertDialog before POSTing to the route; the Toaster is moved to the root layout so toasts work on every page.

**Tech Stack:** Next.js 16 App Router, node-ssh (via existing `sshClient`), shadcn AlertDialog, sonner, next-intl, lucide-react

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `apps/dashboard/lib/recalbox/system-power.ts` | SSH logic — testable in isolation |
| Create | `apps/dashboard/lib/recalbox/__tests__/system-power.test.ts` | Unit tests |
| Create | `apps/dashboard/app/api/system/power/route.ts` | Thin API route |
| Modify | `apps/dashboard/messages/en.json` | Add `power` namespace |
| Modify | `apps/dashboard/messages/fr.json` | Add `power` namespace |
| Modify | `apps/dashboard/app/[locale]/settings/page.tsx` | Remove local `<Toaster />` (moving to root layout) |
| Modify | `apps/dashboard/app/[locale]/layout.tsx` | Add `<Toaster />` + `<PowerControls />` |
| Create | `apps/dashboard/components/power-controls.tsx` | Navbar UI component |

---

## Task 1: System power lib (TDD)

**Files:**
- Create: `apps/dashboard/lib/recalbox/system-power.ts`
- Create: `apps/dashboard/lib/recalbox/__tests__/system-power.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/lib/recalbox/__tests__/system-power.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/recalbox/ssh-client', () => ({
	sshClient: {
		exec: vi.fn(),
	},
}))

vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sshClient } from '@/lib/recalbox/ssh-client'
import { executeSystemPower } from '@/lib/recalbox/system-power'

const mockExec = vi.mocked(sshClient.exec)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('executeSystemPower', () => {
	it('runs poweroff for shutdown action', async () => {
		mockExec.mockResolvedValue('')

		await executeSystemPower('shutdown')

		expect(mockExec).toHaveBeenCalledWith('poweroff', 2000)
	})

	it('runs reboot for reboot action', async () => {
		mockExec.mockResolvedValue('')

		await executeSystemPower('reboot')

		expect(mockExec).toHaveBeenCalledWith('reboot', 2000)
	})

	it('does not throw when SSH disconnects (expected for poweroff/reboot)', async () => {
		mockExec.mockRejectedValue(new Error('ECONNRESET'))

		await expect(executeSystemPower('shutdown')).resolves.toBeUndefined()
	})

	it('re-throws unexpected SSH errors', async () => {
		mockExec.mockRejectedValue(new Error('Authentication failed'))

		await expect(executeSystemPower('reboot')).rejects.toThrow('Authentication failed')
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/recalbox/__tests__/system-power.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/recalbox/system-power'`

- [ ] **Step 3: Implement `system-power.ts`**

Create `apps/dashboard/lib/recalbox/system-power.ts`:

```typescript
import { logger } from '@/lib/logger'
import { sshClient } from '@/lib/recalbox/ssh-client'

const POWER_TIMEOUT_MS = 2000

const CONNECTION_RESET_PATTERNS = ['ECONNRESET', 'ECONNREFUSED', 'timed out', 'socket hang up']

function isExpectedDisconnect(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return CONNECTION_RESET_PATTERNS.some((p) => msg.includes(p))
}

export async function executeSystemPower(action: 'shutdown' | 'reboot'): Promise<void> {
	const command = action === 'shutdown' ? 'poweroff' : 'reboot'
	try {
		await sshClient.exec(command, POWER_TIMEOUT_MS)
	} catch (err) {
		if (isExpectedDisconnect(err)) {
			logger.info(`SSH disconnected after ${command} — expected`)
			return
		}
		throw err
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/recalbox/__tests__/system-power.test.ts
```

Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/recalbox/system-power.ts apps/dashboard/lib/recalbox/__tests__/system-power.test.ts
git commit -m "feat(power): add executeSystemPower with SSH disconnect handling"
```

---

## Task 2: API route

**Files:**
- Create: `apps/dashboard/app/api/system/power/route.ts`

- [ ] **Step 1: Create the route**

Create `apps/dashboard/app/api/system/power/route.ts`:

```typescript
import { logger } from '@/lib/logger'
import { executeSystemPower } from '@/lib/recalbox/system-power'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
	const body = await request.json().catch(() => null)
	const action = body?.action

	if (action !== 'shutdown' && action !== 'reboot') {
		return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
	}

	try {
		await executeSystemPower(action)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error(`Power action "${action}" failed — Recalbox unreachable`, err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/system/power/route.ts
git commit -m "feat(power): add POST /api/system/power route"
```

---

## Task 3: i18n keys

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`

- [ ] **Step 1: Add `power` namespace to `en.json`**

In `apps/dashboard/messages/en.json`, add before the closing `}` of the root object (after the `"time"` block):

```json
  "power": {
    "shutdown": "Shut down",
    "reboot": "Reboot",
    "confirmShutdownTitle": "Shut down Recalbox?",
    "confirmShutdownDescription": "The console will power off. You will need to turn it back on manually.",
    "confirmRebootTitle": "Reboot Recalbox?",
    "confirmRebootDescription": "The console will restart. This will interrupt any ongoing session.",
    "shutdownToast": "Shutting down…",
    "rebootToast": "Rebooting…"
  }
```

- [ ] **Step 2: Add `power` namespace to `fr.json`**

In `apps/dashboard/messages/fr.json`, add the same block with French translations:

```json
  "power": {
    "shutdown": "Éteindre",
    "reboot": "Redémarrer",
    "confirmShutdownTitle": "Éteindre la Recalbox ?",
    "confirmShutdownDescription": "La console va s'éteindre. Vous devrez la rallumer manuellement.",
    "confirmRebootTitle": "Redémarrer la Recalbox ?",
    "confirmRebootDescription": "La console va redémarrer. Cela interrompra toute session en cours.",
    "shutdownToast": "Extinction en cours…",
    "rebootToast": "Redémarrage en cours…"
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(power): add i18n keys for power controls"
```

---

## Task 4: Move Toaster to root layout

The `Toaster` component is currently only mounted in the settings page. PowerControls lives in the navbar (part of root layout), so toasts need to be available on every page.

**Files:**
- Modify: `apps/dashboard/app/[locale]/layout.tsx`
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx`

- [ ] **Step 1: Add Toaster import and mount in `layout.tsx`**

In `apps/dashboard/app/[locale]/layout.tsx`, add the import after the existing imports:

```typescript
import { Toaster } from '@/components/ui/sonner'
```

Then add `<Toaster />` inside `<RecalboxEventsProvider>`, right before `</RecalboxEventsProvider>`:

```tsx
<RecalboxEventsProvider>
  <header className="border-b px-6 py-3">
    {/* ... existing nav ... */}
  </header>
  {children}
  <Toaster />
</RecalboxEventsProvider>
```

- [ ] **Step 2: Remove Toaster from settings page**

In `apps/dashboard/app/[locale]/settings/page.tsx`:
- Remove the import line: `import { Toaster } from '@/components/ui/sonner'`
- Remove the `<Toaster />` JSX element (line 738)

- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/app/[locale]/layout.tsx" "apps/dashboard/app/[locale]/settings/page.tsx"
git commit -m "refactor(ui): move Toaster to root layout so toasts work on all pages"
```

---

## Task 5: PowerControls component

**Files:**
- Create: `apps/dashboard/components/power-controls.tsx`

- [ ] **Step 1: Create the component**

Create `apps/dashboard/components/power-controls.tsx`:

```typescript
'use client'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Power, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

type Action = 'shutdown' | 'reboot'

function PowerAction({ action }: { action: Action }) {
	const t = useTranslations('power')
	const tCommon = useTranslations('common')
	const isShutdown = action === 'shutdown'

	async function handleConfirm() {
		try {
			const res = await fetch('/api/system/power', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			})
			if (!res.ok) throw new Error('unreachable')
			toast(isShutdown ? t('shutdownToast') : t('rebootToast'))
		} catch {
			toast.error(tCommon('error'))
		}
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={t(action)}>
					{isShutdown ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isShutdown ? t('confirmShutdownTitle') : t('confirmRebootTitle')}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isShutdown ? t('confirmShutdownDescription') : t('confirmRebootDescription')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirm}>
						{t(action)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

export function PowerControls() {
	return (
		<>
			<PowerAction action="reboot" />
			<PowerAction action="shutdown" />
		</>
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/power-controls.tsx
git commit -m "feat(power): add PowerControls navbar component with AlertDialog confirmation"
```

---

## Task 6: Wire into navbar

**Files:**
- Modify: `apps/dashboard/app/[locale]/layout.tsx`

- [ ] **Step 1: Add PowerControls import**

In `apps/dashboard/app/[locale]/layout.tsx`, add after the existing imports:

```typescript
import { PowerControls } from '@/components/power-controls'
```

- [ ] **Step 2: Add PowerControls in the ml-auto block**

In the same file, find the `ml-auto` div:

```tsx
<div className="ml-auto flex items-center gap-2">
  <ThemeToggle />
  <LanguageSwitcher />
</div>
```

Replace with:

```tsx
<div className="ml-auto flex items-center gap-2">
  <PowerControls />
  <ThemeToggle />
  <LanguageSwitcher />
</div>
```

- [ ] **Step 3: Verify the dev server starts without errors**

```bash
pnpm dev
```

Open http://localhost:3000 — confirm two new icon buttons appear in the navbar (RotateCcw + Power), that clicking each opens a dialog, and that confirming shows a toast.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Final commit**

```bash
git add "apps/dashboard/app/[locale]/layout.tsx"
git commit -m "feat(power): wire PowerControls into navbar"
```
