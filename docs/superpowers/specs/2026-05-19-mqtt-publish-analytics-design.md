---
name: mqtt-publish-analytics-design
description: Design spec for Ticket 15 — publishing dashboard analytics to MQTT for ecosystem interop (Home Assistant, etc.)
metadata:
  type: project
---

# MQTT Analytics Publisher — Design Spec

**Ticket 15** — Publish dashboard analytics to MQTT for ecosystem interoperability.

## Context

The dashboard already consumes MQTT events from Recalbox (Ticket 2). This feature makes the dashboard a *source* of analytics data on MQTT, enabling other tools (Home Assistant, Node-RED, any MQTT client) to consume stats that only the dashboard knows how to calculate.

The feature is **opt-in** (disabled by default). Multi-Recalbox is already in production; analytics are **global aggregates across all Recalboxes**.

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `apps/dashboard/lib/recalbox/mqtt-publisher.ts` | Publisher singleton |
| `docs/mqtt-api.md` | Stable topic contract (API doc) |

### Modified files

| File | Change |
|---|---|
| `lib/settings/schemas.ts` | Add `mqttPublishConfigSchema` + extend `AppConfig` |
| `lib/settings/defaults.ts` | Add `mqttPublish` defaults |
| `lib/stats/calculators.ts` | Export `calculateStreaks` (currently private) |
| `lib/db/queries.ts` | Add `getLastClosedSession()` query |
| `lib/scrobbler/index.ts` | Wire publisher: hook `closeSession` + 5-min timer |
| `app/[locale]/settings/page.tsx` | Add "MQTT Publish" settings section |

---

## MQTT Topics Contract

Prefix configurable, default `RecalboxDashboard/`. All messages published with `retained: true`.

| Topic | Payload | When published |
|---|---|---|
| `{prefix}status` | `online` / `offline` | Connect (online) / LWT (offline) |
| `{prefix}playtime/today` | seconds (int, string) | Session close + every 5 min |
| `{prefix}playtime/week` | seconds (int, string) | Session close + every 5 min |
| `{prefix}streak/current` | days (int, string) | Session close |
| `{prefix}streak/longest` | days (int, string) | Session close |
| `{prefix}sessions/today` | count (int, string) | Session close |
| `{prefix}topgame/week` | game title (string) | Session close |
| `{prefix}lastgame` | JSON `{name, system, durationSec}` | Session close |

All payloads are plain strings (numbers serialised as decimal strings, JSON for `lastgame`).

---

## Component: `MqttPublisher`

### Public interface

```ts
export type AnalyticsSnapshot = {
  playtimeTodaySec: number
  playtimeWeekSec: number
  currentStreak: number
  longestStreak: number
  sessionsToday: number
  topGameWeek: string
  lastGame: { name: string; system: string; durationSec: number } | null
}

class MqttPublisher {
  connect(brokerUrl: string, topicPrefix: string): void
  disconnect(): void
  publishAnalytics(snapshot: AnalyticsSnapshot): void
  publishHaDiscovery(): void
  publishHaDiscoveryCleanup(): void
  publishStatus(status: 'online' | 'offline'): void
}

export const mqttPublisher: MqttPublisher
```

### Lifecycle

1. **connect()** — opens a dedicated MQTT connection with LWT `{prefix}status → offline`. On successful connect: publishes `status = online`, then HA Discovery messages (if `homeAssistantDiscovery` enabled), then an initial snapshot.
2. **publishAnalytics()** — no-op if not connected or `enabled = false`. Never throws.
3. **disconnect()** — explicit disconnect (scrobbler stop). Does NOT publish offline manually; LWT handles it.
4. **Config changes** (`configStore.on('changed:mqttPublish')`) — if `enabled` flips to false: `disconnect()`; if broker URL or prefix changes: `disconnect()` then `connect()`.

### Connection options

```ts
mqtt.connect(brokerUrl, {
  clientId: `recalbox-dashboard-pub-${Math.random().toString(16).slice(2, 10)}`,
  reconnectPeriod: 0,       // manual backoff (same pattern as RecalboxMqttClient)
  will: {
    topic: `${prefix}status`,
    payload: 'offline',
    retain: true,
    qos: 1,
  },
})
```

Uses same exponential backoff pattern as `RecalboxMqttClient` (`BACKOFF_DELAYS_MS`).

### Singleton pattern

```ts
const g = globalThis as typeof globalThis & { __mqttPublisher?: MqttPublisher }
if (!g.__mqttPublisher) g.__mqttPublisher = new MqttPublisher()
export const mqttPublisher = g.__mqttPublisher
```

---

## Component: `computeAnalyticsSnapshot()`

Standalone async function (in `mqtt-publisher.ts` or a small helper). Uses existing DB queries:

```ts
async function computeAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const startOfToday = /* today at 00:00:00 */
  const weekAgo = /* now - 7 days */

  const [todayStats, weekStats, allStats, lastGame] = await Promise.all([
    getSessionStats({ fromDate: startOfToday }),
    getSessionStats({ fromDate: weekAgo }),
    getSessionStats({}),       // for streak calculation (needs all-time byDay)
    getLastClosedSession(),
  ])

  const { currentStreak, longestStreak } = calculateStreaks(allStats.byDay)
  const topGameWeek = weekStats.topGames[0]?.gameName ?? ''

  return {
    playtimeTodaySec: todayStats.totalPlaytimeSec,
    playtimeWeekSec: weekStats.totalPlaytimeSec,
    currentStreak,
    longestStreak,
    sessionsToday: todayStats.totalSessions,
    topGameWeek,
    lastGame: lastGame
      ? { name: lastGame.gameName, system: lastGame.system, durationSec: lastGame.durationSec }
      : null,
  }
}
```

**Required export**: `calculateStreaks()` in `lib/stats/calculators.ts` must be exported (currently private). Minimal, non-breaking change.

**New query** `getLastClosedSession()` in `lib/db/queries.ts`: last session with `endedAt IS NOT NULL ORDER BY startedAt DESC LIMIT 1`, left-joined with `games` for the name.

---

## Scrobbler Integration

Changes to `lib/scrobbler/index.ts`:

```ts
// After manager.closeSession(event) succeeds:
publishAnalyticsIfEnabled()  // fire-and-forget, never throws

// In startScrobbler():
const refreshTimer = setInterval(publishAnalyticsIfEnabled, 5 * 60 * 1000)

// In stop():
clearInterval(refreshTimer)
mqttPublisher.disconnect()
```

`publishAnalyticsIfEnabled()`:
```ts
async function publishAnalyticsIfEnabled(): Promise<void> {
  try {
    if (!configStore.get().mqttPublish.enabled) return
    const snapshot = await computeAnalyticsSnapshot()
    mqttPublisher.publishAnalytics(snapshot)
  } catch {
    // never propagate — publisher must not crash scrobbler
  }
}
```

`configStore.get().mqttPublish.enabled` is checked at call time, so enabling/disabling takes effect immediately without restarting the timer.

Publisher connection is managed separately via `configStore.on('changed:mqttPublish')` listener registered in `mqtt-publisher.ts`.

---

## Configuration

### Schema (`lib/settings/schemas.ts`)

```ts
export const mqttPublishConfigSchema = z.object({
  enabled: z.boolean(),
  brokerUrl: z.string().max(256),
  topicPrefix: z.string().max(64),
  homeAssistantDiscovery: z.boolean(),
})

export type MqttPublishConfig = z.infer<typeof mqttPublishConfigSchema>

// AppConfig gains:
mqttPublish: mqttPublishConfigSchema
```

### Defaults (`lib/settings/defaults.ts`)

```ts
mqttPublish: {
  enabled: false,
  brokerUrl: '',               // '' = resolved at runtime to mqtt://${defaultRecalbox.host}:1883
  topicPrefix: 'RecalboxDashboard/',
  homeAssistantDiscovery: false,
}
```

`brokerUrl = ''` is resolved in `mqtt-publisher.ts` at `connect()` time:
```ts
const resolvedUrl = brokerUrl || `mqtt://${configStore.getDefaultRecalbox()?.host ?? 'localhost'}:1883`
```

### UI (`app/[locale]/settings/page.tsx`)

New sidebar section **"MQTT Publish"** (icon: `Radio` from lucide-react). Contains:

- Toggle: **Enable MQTT publishing** (enabled)
- Input: **Broker URL** (placeholder: `mqtt://<recalbox-host>:1883`, shown only when enabled)
- Input: **Topic prefix** (placeholder: `RecalboxDashboard/`, shown when enabled)
- Toggle: **Home Assistant Discovery** (shown when enabled)

Form saved via `PATCH /api/settings` with scope `mqttPublish` (same pattern as existing settings sections).

---

## Home Assistant Discovery

When `homeAssistantDiscovery: true`, published at connect time on `homeassistant/sensor/recalbox_dashboard_<id>/config` (retained).

### Sensors published (8 total)

| Sensor ID | State topic | Unit | Device class |
|---|---|---|---|
| `playtime_today` | `{prefix}playtime/today` | `s` | `duration` |
| `playtime_week` | `{prefix}playtime/week` | `s` | `duration` |
| `streak_current` | `{prefix}streak/current` | `d` | — |
| `streak_longest` | `{prefix}streak/longest` | `d` | — |
| `sessions_today` | `{prefix}sessions/today` | — | — |
| `topgame_week` | `{prefix}topgame/week` | — | — |
| `lastgame` | `{prefix}lastgame` | — | — |
| `status` | `{prefix}status` | — | `connectivity` |

All sensors share the same `device` block:
```json
{
  "identifiers": ["recalbox_dashboard"],
  "name": "Recalbox Dashboard",
  "model": "Recalbox Dashboard",
  "manufacturer": "recalbox-dashboard"
}
```

All sensors use `availability_topic: "{prefix}status"` with `payload_available: "online"` / `payload_not_available: "offline"`.

### Cleanup

When `homeAssistantDiscovery` flips to `false`: publish empty payload (`''`) on each discovery topic → HA removes the entities.

---

## Error Handling

- Publisher catches all MQTT errors internally (log + backoff reconnect, same as `RecalboxMqttClient`).
- `publishAnalytics()` and `publishHaDiscovery()` are no-ops if client is not connected.
- `computeAnalyticsSnapshot()` errors are caught in `publishAnalyticsIfEnabled()` — never propagated to scrobbler.
- If broker is unreachable: scrobbler continues normally, analytics silently not published until reconnected.

---

## Documentation

`docs/mqtt-api.md` — stable topic contract. Once published, topics are not renamed without a major version bump. Covers: all topics, payload format, frequency, retained flag, LWT.

README updated: new "Ecosystem" section mentioning MQTT publish feature and Home Assistant integration.
