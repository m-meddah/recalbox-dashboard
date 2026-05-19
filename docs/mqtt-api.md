# MQTT Publish API

The dashboard can publish analytics to MQTT topics so other tools (Home Assistant, Node-RED, any MQTT client) can consume stats that only the dashboard knows how to calculate.

Enable and configure in **Settings → MQTT Publish**.

## Topic contract

**Default prefix:** `RecalboxDashboard/` (configurable in Settings)

All messages are published with `retained: true` so subscribers receive the latest value immediately on connect.

| Topic | Payload | When published |
|-------|---------|----------------|
| `{prefix}status` | `online` / `offline` | On connect (online) and via LWT (offline) |
| `{prefix}playtime/today` | seconds as string | Session close + every 5 min |
| `{prefix}playtime/week` | seconds as string | Session close + every 5 min |
| `{prefix}streak/current` | days as string | Session close |
| `{prefix}streak/longest` | days as string | Session close |
| `{prefix}sessions/today` | count as string | Session close |
| `{prefix}topgame/week` | game title | Session close |
| `{prefix}lastgame` | JSON `{"name":"…","system":"…","durationSec":N}` | Session close |

All numeric payloads are serialised as decimal strings (e.g. `"3600"`). The `lastgame` topic carries JSON.

Analytics are **global aggregates across all Recalbox instances** managed by this dashboard.

## Broker URL

Leave the Broker URL blank in Settings to connect to the default Recalbox MQTT broker (`mqtt://<recalbox-host>:1883`) automatically. Set a custom URL to target a different broker.

## Home Assistant Discovery

When **Home Assistant Discovery** is enabled, the dashboard publishes MQTT Discovery config messages at connect time so sensors appear automatically in Home Assistant.

Discovery topics: `homeassistant/sensor/recalbox_dashboard_<id>/config`

| Sensor | Unit | Device class |
|--------|------|--------------|
| `playtime_today` | `s` | `duration` |
| `playtime_week` | `s` | `duration` |
| `streak_current` | `d` | — |
| `streak_longest` | `d` | — |
| `sessions_today` | — | — |
| `topgame_week` | — | — |
| `lastgame` | — | — |
| `status` | — | `connectivity` |

All sensors share a `Recalbox Dashboard` device block and use `{prefix}status` as their availability topic.

To remove sensors from Home Assistant, disable **Home Assistant Discovery** in Settings — the dashboard publishes empty payloads on each discovery topic, which removes the entities from HA.

## Stability

Once published, topic names will not be renamed without a major version bump.
