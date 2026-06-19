# sr-agent — on-Recalbox push agent (Phase 0 spike)

Proof-of-concept agent that runs **on the Recalbox** for the serverless edition
(see `~/.claude/plans/lexical-gathering-key.md` and the `saas-multi-user` memory).

It subscribes to the **local** mosquitto broker, pairs game start/stop events
into play sessions, and **pushes complete sessions out over HTTPS** to a cloud
ingest endpoint (outbound → traverses home NAT, no port-forward). Failed pushes
are buffered to disk and retried.

Dependency-free: Python 3 stdlib + `paho.mqtt.client`, both already present on
RecalboxOS (probed: Python 3.11.8). **Node is absent on the Recalbox**, so this
is a Python port of the TS pipeline, not a reuse:
- parsing mirrors `apps/dashboard/lib/recalbox/events.ts` (incl. the EmulationStation double-JSON quirk)
- pairing/auto-close/min-duration mirrors `apps/dashboard/lib/scrobbler/session-manager.ts`

## Files

- `agent.py` — the agent.
- `custom.sh` — boot hook. Deploy to `/recalbox/share/system/custom.sh`; RecalboxOS's `/etc/init.d/S99custom` runs it at boot (`$1`=start) and shutdown (`$1`=stop). The `/recalbox/share` partition survives OS upgrades.
- `config.example.json` — copy to `config.json` next to `agent.py` and fill in.

## Deploy (manual, for the spike)

```bash
RB=192.168.1.194   # or recalbox.local
scp agent.py root@$RB:/recalbox/share/system/sr-agent/agent.py
scp custom.sh root@$RB:/recalbox/share/system/custom.sh
# create /recalbox/share/system/sr-agent/config.json from config.example.json
ssh root@$RB 'bash /recalbox/share/system/custom.sh start'   # or reboot
```

## Verify

```bash
ssh root@$RB 'pgrep -af agent.py | grep "[p]ython3"'         # agent running
ssh root@$RB 'tail -f /recalbox/share/system/sr-agent/agent.log'
# simulate an event without playing:
ssh root@$RB 'mosquitto_pub -h 127.0.0.1 -t Recalbox/WebAPI/EmulationStation/Event -m "{\"event\":\"rungame\",\"system\":{\"name\":\"snes\",\"fullname\":\"SNES\"},\"game\":{\"romPath\":\"/x.smc\",\"name\":\"Demo\"},\"media\":{\"image\":\"\"}}"'
```

> Gotchas learned the hard way: don't `pkill -f sr-agent/agent.py` over SSH (the
> SSH shell's own cmdline matches the pattern → it kills itself). BusyBox `ps w`
> doesn't show `python3` greppably — use `pgrep`.

## Not in the spike (later phases)

Real cloud ingest API + per-Recalbox auth tokens; DB on Turso; now-playing
relay; command queue for power/launch/conf; artwork upload; system-stats push;
enrollment UX. The spike pushed to a throwaway webhook.site endpoint.
