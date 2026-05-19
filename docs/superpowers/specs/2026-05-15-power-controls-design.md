# Power Controls — Design Spec

**Date:** 2026-05-15
**Status:** Approved

## Overview

Add shutdown and reboot controls to the dashboard navbar, allowing users to power off or restart their Recalbox without leaving the dashboard. Mirrors the functionality of the Recalbox web manager.

## Architecture

Three layers: an API route that wraps SSH commands, a client component with confirmation dialogs, and i18n keys for all user-facing strings.

## API Route

**Endpoint:** `POST /api/system/power`

**Request body:** `{ action: "shutdown" | "reboot" }`

**Implementation:**
- Uses the existing `sshClient` singleton (no new SSH infrastructure)
- Maps `"shutdown"` → `poweroff`, `"reboot"` → `reboot`
- Executes with a 2-second timeout (shorter than the default 5s)
- SSH disconnection after the command is **expected behavior** — the machine is shutting down. Any connection error is silently swallowed.
- Always returns `200 { ok: true }` — the client must not interpret a subsequent network drop as command failure

**File:** `apps/dashboard/app/api/system/power/route.ts`

## UI Component

**Component:** `PowerControls` (client component)

**Placement:** Inside the `ml-auto` flex container in `apps/dashboard/app/[locale]/layout.tsx`, alongside `ThemeToggle` and `LanguageSwitcher`.

**Controls:**
- `Power` icon button (lucide-react) → shutdown
- `RotateCcw` icon button (lucide-react) → reboot
- Both use `variant="ghost" size="icon"` to match existing navbar buttons

**Confirmation flow (per button):**
1. User clicks icon → `AlertDialog` opens with title + description
2. User clicks Cancel → dialog closes, nothing happens
3. User clicks Confirm → button disabled + spinner while fetching
4. `POST /api/system/power` called with the appropriate action
5. Dialog closes → `toast()` displayed ("Shutting down…" or "Rebooting…")

**File:** `apps/dashboard/components/power-controls.tsx`

## i18n

New `power` namespace added to both `apps/dashboard/messages/en.json` and `apps/dashboard/messages/fr.json`.

**Keys:**

| Key | EN | FR |
|-----|----|----|
| `power.shutdown` | Shut down | Éteindre |
| `power.reboot` | Reboot | Redémarrer |
| `power.confirmShutdownTitle` | Shut down Recalbox? | Éteindre la Recalbox ? |
| `power.confirmShutdownDescription` | The console will power off. You will need to turn it back on manually. | La console va s'éteindre. Vous devrez la rallumer manuellement. |
| `power.confirmRebootTitle` | Reboot Recalbox? | Redémarrer la Recalbox ? |
| `power.confirmRebootDescription` | The console will restart. This will interrupt any ongoing session. | La console va redémarrer. Cela interrompra toute session en cours. |
| `power.shutdownToast` | Shutting down… | Extinction en cours… |
| `power.rebootToast` | Rebooting… | Redémarrage en cours… |

## Error Handling

- If the SSH connection fails **before** the command is sent (Recalbox unreachable), the API returns `503`. The UI shows a sonner error toast.
- If the SSH connection drops **after** the command is sent (expected for shutdown/reboot), the API returns `200`. No error is surfaced to the user.

## Out of Scope

- Polling for reconnection / "waiting for Recalbox to come back" screen after reboot
- Wake-on-LAN
- Any power scheduling
