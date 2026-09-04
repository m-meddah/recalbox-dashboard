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

## Mise à jour automatique

L'agent converge vers la version que le cloud lui annonce dans la réponse de sa
boucle de commandes (`agent.target_version`), et déclare la sienne dans l'en-tête
`X-Agent-Version` de chaque requête.

Une bascule télécharge le paquet (`GET /api/agent/download`), le vérifie par
`py_compile`, copie l'ancien dans `backup/`, pose le témoin `update.json`, échange
les fichiers et se relance par `execv`. Le témoin passe à `confirmed` au premier
aller-retour réussi avec le cloud ; s'il ne l'est toujours pas dix minutes plus
tard, `launch.py` restaure `backup/` au lancement suivant et inscrit la version
fautive dans `failed.json`, qui empêche de la retenter.

Fichiers remplacés : `agent.py`, `scan_roms.py`, `launch.py`, `updater.py`,
`VERSION`. **Jamais** `config.json` (il porte le jeton) ni le lanceur
`userscripts/` (sa corruption serait irrattrapable).

**Une descente ne télécharge jamais.** Le cloud ne dispose que de la version
déployée, donc la seule source d'une version antérieure est le `backup/` local :
si la cible annoncée est plus basse que la version courante, la box restaure sa
sauvegarde et se relance, sans le moindre aller-retour réseau. Une seule marche
de recul, et elle est visible : si la sauvegarde ne porte pas exactement la
version demandée — box en 1.2.0, sauvegarde en 1.1.0, cible en 1.0.0 — la box ne
bouge pas, le journalise (`Cannot reach target … the local backup holds …`) et
continue de déclarer sa version, donc `/admin` la montre en retrait.

Deux garde-fous : l'agent ne se met à jour que lancé par `launch.py`, qui pose
`SR_AGENT_SUPERVISED=1` — une box encore sur l'ancien `custom.sh` n'aurait
personne pour la réparer. Et une bascule attend qu'aucune partie ni aucun scan
ne soit en cours, sans délai maximal : un `execv` au milieu d'une partie
perdrait la session.

Le déploiement se pilote depuis `/admin` : version cible (choisie dans une liste,
jamais saisie), part des box `stable` qui basculent, et canal par box (`stable`
ou `beta`, sur la page d'édition de la Recalbox).

## Files

- `agent.py` — the agent.
- `scan_roms.py` — the ROM-audit scanner. **Required next to `agent.py`**: without it the agent refuses `scan` commands with an explicit message (it never crashes, but the audit cannot run).
- `custom.sh` — boot hook. Deploy to `/recalbox/share/system/custom.sh`; RecalboxOS's `/etc/init.d/S99custom` runs it at boot (`$1`=start) and shutdown (`$1`=stop). The `/recalbox/share` partition survives OS upgrades. `agent.py` takes its single-instance lock itself, so any start path — this legacy `custom.sh` autostart, the current `launch.py`-based one, or both installed at once on the same box — contends for the same lock and can never end up running two agents that double-record play sessions.
- `launch.py` — the supervisor, and what the launcher actually starts. Repairs an update that never proved itself (restores `backup/`, records the failed version) and then `execv`s `agent.py`, setting `SR_AGENT_SUPERVISED=1` so the agent knows someone can repair it. Its `import updater` is guarded: a broken `updater.py` must never stop the agent from starting.
- `updater.py` — all the update logic, in pure testable functions: version compare, bundle verification (`py_compile`), the swap, the `update.json` witness, restore, and the `failed.json` ledger. Imported by both `agent.py` (forward path) and `launch.py` (repair path).
- `sr-agent[systembrowsing].sh` — the current launcher. Deploy to `/recalbox/share/userscripts/`; EmulationStation runs any `*[systembrowsing].sh` every time it shows the systems list — at boot and on every menu navigation — which makes it the watchdog too. **Never updated by the auto-update mechanism**: it is the one file whose corruption is unrecoverable, so it stays frozen and all the replaceable logic lives in Python.
- `VERSION` — the version this directory holds, one line. Read at import and stamped on every request as `X-Agent-Version`; it is what the cloud compares against the target it announces. A directory without it reads as `0.0.0`.
- `config.example.json` — copy to `config.json` next to `agent.py` and fill in (`cloud_url`, `token`, `recalbox_id`).

## Tests

Stdlib `unittest` only — the agent is dependency-free, so nothing needs installing.
From the repo root:

```bash
python3 -m unittest discover -s agent -v
```

That runs all 187 tests: the `test_*.py` files at the top level and inside
`__tests__/`. The `__tests__/__init__.py` is what lets discovery recurse into that
subdirectory — without it, `discover` silently skips it and reports only the top-level
tests, which is easy to mistake for a green run.

⚠️ **`python3 -m unittest agent.test_agent_snapshots` does not work**, and cannot be made
to. The directory `agent/` and the module `agent.py` inside it share a name, so the dotted
form binds `agent` to the directory (a namespace package) and the tests' own
`import agent` then gets that instead of `agent.py` — failing with
`AttributeError: <module 'agent' (namespace)>`. `discover -s agent` sets the top-level
directory to `agent/`, where `agent` unambiguously means `agent.py`. Use it.

Two of the snapshot tests detect a missing loop guard by *hanging* (the loop they call is
a `while True`), so run them under a timeout if you are changing that code:

```bash
timeout 60 python3 -m unittest discover -s agent
```

## Config (`config.json`)

`cloud_url` points at the **ingest** endpoint (e.g. `https://<app>/api/agent/ingest`); the agent
derives the sibling endpoints (`/snapshots`, `/collection`, …) from it. Intervals (seconds):

| Key | Default | |
| --- | --- | --- |
| `snapshot_interval_sec` | 0 | system snapshots; `0` disables (default: the cloud discards them) |
| `collection_interval_sec` | 21600 | collection sync (6 h); `0` disables |
| `collection_max_xml_bytes` | 3500000 | chunk gamelists larger than this |
| `command_poll_interval_sec` | 60 | remote-control poll |
| `artwork_poll_interval_sec` | 60 | wanted-artwork poll; `0` disables |
| `artwork_idle_max_sec` | 300 | ceiling the artwork poll drifts up to while the queue is empty |
| `artwork_max_bytes` | 4000000 | skip uploads larger than this |
| `min_duration_sec` | 10 | drop sessions shorter than this |

Two backoffs act on these loops and they are deliberately separate. The **retry** backoff
answers "is the cloud reachable?" and doubles up to 30 min during an outage — that is what
stops a dead endpoint costing 3.4k requests a day. The **idle** backoff answers "was there
anything to do?" and applies to the artwork poll only, doubling up to `artwork_idle_max_sec`
while nothing is wanted; a box left on all day is idle for nearly all of its 1440 daily
polls, and each one is a billed serverless invocation. It costs latency only on the *first*
image after a quiet spell, because any wanted image drops the loop straight back to
`artwork_poll_interval_sec` for the ones that follow.

## Deploy

> **For end users this is the wrong path** — they get the installer zip from
> `/recalboxes/add` (see [docs/serverless-deploy.md](../docs/serverless-deploy.md#enroll-each-recalbox-agent)).
> The `custom.sh` layout below lays down neither `VERSION`, nor `launch.py`, nor
> `updater.py`: the box reports `0.0.0`, logs an import error at every start, has
> no supervisor to repair a failed swap, and therefore never auto-updates. Use it
> only to push a working copy onto a dev box, and prefer the zip even then.

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
ssh root@$RB 'pgrep -f "sr-agent/[a]gent.py"'                 # agent running (bracket avoids self-match)
ssh root@$RB 'tail -f /recalbox/share/system/sr-agent/agent.log'
# simulate a game event without playing:
ssh root@$RB 'mosquitto_pub -h 127.0.0.1 -t Recalbox/WebAPI/EmulationStation/Event -m "{\"event\":\"rungame\",\"system\":{\"name\":\"snes\",\"fullname\":\"SNES\"},\"game\":{\"romPath\":\"/x.smc\",\"name\":\"Demo\"},\"media\":{\"image\":\"\"}}"'
```

> **Gotchas learned the hard way:** to stop/find the agent over SSH, use a pattern that can't
> match the SSH shell's own command line — hence the `[a]` bracket trick. A plain
> `grep "[p]ython3"` is **not** enough because the shell's cmdline also contains "python3"; and
> `pkill -f "next dev…"`-style patterns self-kill. BusyBox `ps w` doesn't show `python3`
> greppably — use `pgrep`.
>
> Match on `sr-agent/[a]gent.py`, **never** on `python3 [a]gent.py`. `launch.py` execs
> `[sys.executable, agent_path()]`, so the real cmdline is
> `/usr/bin/python3 /recalbox/share/system/sr-agent/agent.py` — an absolute path sits between the
> interpreter and the script, and the two are never adjacent. The wrong pattern fails **silently
> and in the worst direction**: it reports no agent while a perfectly healthy one is running, so
> the reflex it triggers is to start a second one. Verified on a live box: the documented pattern
> returned nothing for pid 620, `sr-agent/[a]gent.py` returned 620.

## The log

`agent.log` is written by the launcher's `>>` redirect, not by Python — so no
`RotatingFileHandler` is involved, and renaming the file would leave the running
daemon appending to an invisible inode forever. `updater.trim_log()` therefore
truncates it **in place**, which is safe only because `>>` opens with `O_APPEND`.

It runs from `launch.py`, i.e. on every menu navigation. Past 5 MB the file is
cut back to its last 2000 lines — **plus every game line, kept without any time
limit**. Game lines are the ones on the `sr-agent.session` logger (sessions
opened, closed, delivered, buffered, discarded); they cost about 200 lines per
two months of play.

Failures are logged as a *state*, not once per attempt: the first occurrence,
then a summary every 5 minutes while it lasts, then a recovery line reporting
how many attempts it took. A change of cause (a 402 that becomes a 500) speaks
up immediately. Before this, a two-week cloud outage produced 170 000 lines —
91% of a 29 MB log — because every buffered session was logged on every retry.
