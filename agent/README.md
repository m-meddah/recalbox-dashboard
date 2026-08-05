# sr-agent — on-Recalbox push agent (serverless edition)

The agent that runs **on the Recalbox** for the [serverless edition](../docs/serverless-deploy.md).
It talks to the **local** mosquitto broker + reads local files, and **pushes everything outbound
over HTTPS** to the cloud (Vercel) — outbound traverses home NAT, so there's no port-forward and
nothing extra always-on at home.

Dependency-free: Python 3 stdlib + `paho.mqtt.client`, both already present on RecalboxOS (probed:
Python 3.11.8). **Node is absent on the Recalbox**, so this is a Python port of the TS pipeline,
not a reuse:

- event parsing mirrors `apps/dashboard/lib/recalbox/events.ts` (incl. the EmulationStation double-JSON quirk)
- session pairing / auto-close / min-duration mirrors `apps/dashboard/lib/scrobbler/session-manager.ts`

## What it does

Authenticates every request with a per-Recalbox **Bearer token** (minted from the Recalbox edit
page or `scripts/create-agent-token.ts`). The cloud resolves the token to a `recalbox_id`.

| Loop | Endpoint | Notes |
| ---- | -------- | ----- |
| Sessions | `POST /api/agent/ingest` | Pairs MQTT game start/stop into sessions; **buffers to disk + retries** when offline |
| Snapshots | `POST /api/agent/snapshots` | CPU/RAM/temp/uptime from `/proc` + `/sys`; disabled by default (`snapshot_interval_sec` = 0) and discarded by the cloud |
| Collection | `POST /api/agent/collection` | Ships raw `gamelist.xml` (+ userdata) per system; large lists are **chunked** under the cloud body limit; every `collection_interval_sec` |
| Now playing | `POST /api/agent/now-playing` | Live game state on start/stop |
| Commands | `GET /api/agent/commands` + `POST .../commands/result` | Polls the remote-control queue (power/conf; launch stubbed), applies on the box, reports back |
| Artwork | `GET/POST /api/agent/artwork` | Polls "wanted" cover paths and uploads the files (request-driven, no bulk sweep) |

Each loop runs in its own daemon thread and never lets an exception kill it. Any loop can be
disabled by setting its interval `<= 0`.

## Files

- `agent.py` — the agent.
- `scan_roms.py` — the ROM-audit scanner. **Required next to `agent.py`**: without it the agent refuses `scan` commands with an explicit message (it never crashes, but the audit cannot run).
- `custom.sh` — boot hook. Deploy to `/recalbox/share/system/custom.sh`; RecalboxOS's `/etc/init.d/S99custom` runs it at boot (`$1`=start) and shutdown (`$1`=stop). The `/recalbox/share` partition survives OS upgrades.
- `config.example.json` — copy to `config.json` next to `agent.py` and fill in (`cloud_url`, `token`, `recalbox_id`).

## Config (`config.json`)

`cloud_url` points at the **ingest** endpoint (e.g. `https://<app>/api/agent/ingest`); the agent
derives the sibling endpoints (`/snapshots`, `/collection`, …) from it. Intervals (seconds):

| Key | Default | |
| --- | --- | --- |
| `snapshot_interval_sec` | 0 | system snapshots; `0` disables (default: the cloud discards them) |
| `collection_interval_sec` | 21600 | collection sync (6 h); `0` disables |
| `collection_max_xml_bytes` | 3500000 | chunk gamelists larger than this |
| `command_poll_interval_sec` | 10 | remote-control poll |
| `artwork_poll_interval_sec` | 30 | wanted-artwork poll; `0` disables |
| `artwork_max_bytes` | 4000000 | skip uploads larger than this |
| `min_duration_sec` | 10 | drop sessions shorter than this |

## Deploy

```bash
RB=192.168.1.194   # or recalbox.local
ssh root@$RB 'mkdir -p /recalbox/share/system/sr-agent'
scp agent.py root@$RB:/recalbox/share/system/sr-agent/agent.py
scp scan_roms.py root@$RB:/recalbox/share/system/sr-agent/scan_roms.py
scp custom.sh root@$RB:/recalbox/share/system/custom.sh
# create /recalbox/share/system/sr-agent/config.json from config.example.json (token + cloud_url)
ssh root@$RB 'bash /recalbox/share/system/custom.sh start'   # or reboot
```

See [docs/serverless-deploy.md](../docs/serverless-deploy.md) for the full cloud-side runbook
(Vercel + Turso + Blob + minting the token).

## Verify

```bash
ssh root@$RB 'pgrep -f "python3 [a]gent.py"'                  # agent running (bracket avoids self-match)
ssh root@$RB 'tail -f /recalbox/share/system/sr-agent/agent.log'
# simulate a game event without playing:
ssh root@$RB 'mosquitto_pub -h 127.0.0.1 -t Recalbox/WebAPI/EmulationStation/Event -m "{\"event\":\"rungame\",\"system\":{\"name\":\"snes\",\"fullname\":\"SNES\"},\"game\":{\"romPath\":\"/x.smc\",\"name\":\"Demo\"},\"media\":{\"image\":\"\"}}"'
```

> **Gotchas learned the hard way:** to stop/find the agent over SSH, use a pattern that can't
> match the SSH shell's own command line — `pgrep -f "python3 [a]gent.py"` (the `[a]` bracket
> trick). A plain `grep "[p]ython3"` is **not** enough because the shell's cmdline also contains
> "python3"; and `pkill -f "next dev…"`-style patterns self-kill. BusyBox `ps w` doesn't show
> `python3` greppably — use `pgrep`.
