#!/usr/bin/env python3
"""
Super-Retrogamers Recalbox agent (Phase 0 spike).

Runs ON the Recalbox. Subscribes to the local MQTT broker, pairs game
start/stop events into play sessions, and pushes complete sessions OUT to a
cloud ingest endpoint over HTTPS (outbound, NAT-friendly). Failed pushes are
buffered to disk and retried, so sessions survive a temporary loss of network.

Dependency-free: only the Python 3 stdlib + paho.mqtt.client, both already
present on RecalboxOS (probed: Python 3.11.8, paho.mqtt.client installed).

This is a SPIKE: it proves the edge pipeline (MQTT -> session -> push). The
real cloud ingest API, auth, DB writes and now-playing relay come in later
phases. The parsing/pairing logic mirrors the existing TS implementation:
  - apps/dashboard/lib/recalbox/events.ts      (event parsing + double-JSON quirk)
  - apps/dashboard/lib/scrobbler/session-manager.ts (open/close, min-duration, auto-close)
"""

import base64
import glob
import json
import logging
import os
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# ── Topics (must match RecalboxOS WebAPI) ────────────────────────────────────
ES_EVENT_TOPIC = "Recalbox/WebAPI/EmulationStation/Event"

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
BUFFER_PATH = os.path.join(HERE, "buffer.jsonl")

FLUSH_INTERVAL_SEC = 15

log = logging.getLogger("sr-agent")


# ── Config ───────────────────────────────────────────────────────────────────
def load_config():
    defaults = {
        "cloud_url": "",
        "token": "",
        "recalbox_id": "spike",
        "mqtt_host": "127.0.0.1",
        "mqtt_port": 1883,
        "min_duration_sec": 10,
        "http_timeout_sec": 10,
        "snapshot_interval_sec": 60,
        "collection_interval_sec": 21600,
        "collection_max_xml_bytes": 3500000,
        "command_poll_interval_sec": 10,
        "artwork_poll_interval_sec": 30,
        "artwork_max_bytes": 4000000,
    }
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            defaults.update(json.load(f))
    except FileNotFoundError:
        log.warning("No config.json at %s, using defaults", CONFIG_PATH)
    except (json.JSONDecodeError, OSError) as e:
        log.error("Bad config.json (%s), using defaults", e)
    return defaults


# ── Event parsing (mirror of events.ts) ──────────────────────────────────────
def parse_es_event(payload: bytes):
    """Return a dict describing the event, or None. Never raises.

    Recalbox/EmulationStation sometimes appends a second JSON copy in the same
    payload (double-publish bug). We recover by slicing to the byte position
    reported by the JSON decoder, exactly like events.ts does.
    """
    raw = payload.decode("utf-8", errors="replace").replace("\x00", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as first:
        # first.pos = index where the extra data starts
        if not first.pos:
            return None
        try:
            data = json.loads(raw[: first.pos])
        except json.JSONDecodeError:
            return None

    if not isinstance(data, dict):
        return None
    event = data.get("event")
    if not isinstance(event, str):
        return None

    system = data.get("system")
    game = data.get("game")
    media = data.get("media")

    def sys_ok(v):
        return isinstance(v, dict) and isinstance(v.get("name"), str) and isinstance(v.get("fullname"), str)

    def game_ok(v):
        return isinstance(v, dict) and isinstance(v.get("romPath"), str) and isinstance(v.get("name"), str)

    if event == "rungame" and sys_ok(system) and game_ok(game):
        return {
            "type": "game:start",
            "system": system["name"],
            "system_full_name": system["fullname"],
            "rom_path": game["romPath"],
            "game_name": game["name"],
            "emulator": system.get("defaultEmulator") or None,
            "image_path": (media.get("image") if isinstance(media, dict) else None) or None,
            "from_screensaver": False,
        }
    # startgameclip = screensaver demo clip: display-only, never a real session.
    if event == "startgameclip":
        return {"type": "game:start", "from_screensaver": True}
    if event == "endgame" and sys_ok(system) and game_ok(game):
        return {
            "type": "game:stop",
            "system": system["name"],
            "rom_path": game["romPath"],
            "game_name": game["name"],
        }
    return None


# ── HTTP helpers ─────────────────────────────────────────────────────────────
def endpoint_for(cfg, name):
    """Resolve a sibling endpoint URL from cloud_url.

    cloud_url points at the session ingest endpoint (…/api/agent/ingest); we
    derive siblings like …/api/agent/snapshots from it, so a config that sets
    either the full ingest URL or just the base works.
    """
    url = (cfg.get("cloud_url") or "").rstrip("/")
    if url.endswith("/ingest"):
        url = url[: -len("/ingest")]
    return (url + "/" + name) if url else ""


def http_post_json(url, payload, token, timeout):
    """POST payload as JSON. Returns True on 2xx, False otherwise. Never raises."""
    if not url:
        return False
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError, ValueError) as e:
        log.warning("POST %s failed: %s", url, e)
        return False


def http_get_json(url, token, timeout):
    """GET + parse a JSON body. Returns the parsed object, or None on any error."""
    if not url:
        return None
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            if not (200 <= resp.status < 300):
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        log.warning("GET %s failed: %s", url, e)
        return None


# ── Cloud delivery (HTTPS POST + disk buffer) ────────────────────────────────
class Deliverer:
    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()

    def _post(self, session: dict) -> bool:
        url = endpoint_for(self.cfg, "ingest")
        if not url:
            log.error("No cloud_url configured; cannot push")
            return False
        ok = http_post_json(url, session, self.cfg.get("token"), self.cfg.get("http_timeout_sec", 10))
        log.info(
            "POST %s -> %s for %s",
            url,
            "ok" if ok else "FAILED (buffering)",
            session.get("rom_path"),
        )
        return ok

    def deliver(self, session: dict):
        if not self._post(session):
            self._buffer_append(session)
        else:
            # opportunistic flush of anything left over
            self.flush()

    def _buffer_append(self, session: dict):
        with self.lock:
            with open(BUFFER_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(session) + "\n")
        log.info("Buffered session for %s (pending=%d)", session.get("rom_path"), self._count())

    def _count(self) -> int:
        try:
            with open(BUFFER_PATH, "r", encoding="utf-8") as f:
                return sum(1 for _ in f)
        except FileNotFoundError:
            return 0

    def flush(self):
        with self.lock:
            try:
                with open(BUFFER_PATH, "r", encoding="utf-8") as f:
                    lines = [ln for ln in f.read().splitlines() if ln.strip()]
            except FileNotFoundError:
                return
            if not lines:
                return
            remaining = []
            for ln in lines:
                try:
                    session = json.loads(ln)
                except json.JSONDecodeError:
                    continue  # drop corrupt line
                if not self._post(session):
                    remaining.append(ln)
            if remaining:
                # Atomic rewrite: write a temp file then rename over the buffer, so a
                # crash/power-loss mid-write can't truncate away the still-pending sessions.
                tmp = BUFFER_PATH + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write("\n".join(remaining) + "\n")
                os.replace(tmp, BUFFER_PATH)
            else:
                os.remove(BUFFER_PATH)
                log.info("Buffer drained")

    def flush_loop(self):
        while True:
            time.sleep(FLUSH_INTERVAL_SEC)
            try:
                self.flush()
            except Exception as e:  # never let the retry thread die
                log.error("flush_loop error: %s", e)


# ── Session state machine (mirror of session-manager.ts) ─────────────────────
class SessionTracker:
    def __init__(self, cfg, deliverer: Deliverer):
        self.cfg = cfg
        self.deliverer = deliverer
        self.open = None  # {started_at: float, system, rom_path, game_name}

    def _emit(self, ev: dict, ended: float, ended_mono: float, auto_closed: bool, reason):
        started = ev["started_at"]
        started_mono = ev.get("started_mono")
        # Duration from a MONOTONIC clock: RTC-less boards (most Raspberry Pis) boot with a
        # wrong wall-clock that NTP corrects seconds-to-minutes later. A wall-clock delta
        # would then inflate a session by years (forward jump) or go negative and be silently
        # dropped (backward jump). Wall-clock is used only for the human-readable timestamps.
        if started_mono is not None and ended_mono is not None:
            duration = round(ended_mono - started_mono)
        else:
            duration = round(ended - started)
        if duration < self.cfg.get("min_duration_sec", 10):
            log.info("Dropping short session (%ds) for %s", duration, ev.get("rom_path"))
            return
        session = {
            "recalbox_id": self.cfg.get("recalbox_id"),
            "source": "agent",
            "started_at": datetime.fromtimestamp(started, timezone.utc).isoformat(),
            "ended_at": datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            "duration_seconds": duration,
            "system": ev.get("system"),
            "rom_path": ev.get("rom_path"),
            "game_name": ev.get("game_name"),
            "auto_closed": auto_closed,
            "closed_reason": reason,
        }
        log.info("Session %ds for %s (%s)", duration, ev.get("rom_path"), ev.get("system"))
        self.deliverer.deliver(session)

    def on_start(self, ev: dict):
        if ev.get("from_screensaver"):
            return  # screensaver clip, never a real session
        now = time.time()
        now_mono = time.monotonic()
        if self.open:
            self._emit(self.open, now, now_mono, True, "new_session_started")
        self.open = {
            "started_at": now,
            "started_mono": now_mono,
            "system": ev["system"],
            "rom_path": ev["rom_path"],
            "game_name": ev["game_name"],
        }
        log.info("Opened session for %s on %s", ev["rom_path"], ev["system"])

    def on_stop(self, ev: dict):
        now = time.time()
        now_mono = time.monotonic()
        if self.open and self.open["rom_path"] == ev["rom_path"]:
            self._emit(self.open, now, now_mono, False, None)
            self.open = None
        else:
            log.info("No matching open session for %s, ignoring stop", ev.get("rom_path"))


# ── System snapshots (CPU / RAM / temp / uptime, pushed periodically) ─────────
def _read_first_line(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.readline().strip()


def read_cpu_temp():
    """CPU temperature in °C from /sys/class/thermal (millidegrees)."""
    try:
        return int(_read_first_line("/sys/class/thermal/thermal_zone0/temp")) / 1000
    except (OSError, ValueError):
        return None


def read_uptime():
    try:
        return float(_read_first_line("/proc/uptime").split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _proc_stat():
    parts = [int(x) for x in _read_first_line("/proc/stat").split()[1:]]
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)  # idle + iowait
    total = sum(parts[:8])
    return total, idle


def read_cpu_usage():
    """CPU usage % from two /proc/stat reads 200 ms apart (mirrors system-stats.ts)."""
    try:
        t1, i1 = _proc_stat()
        time.sleep(0.2)
        t2, i2 = _proc_stat()
        td, idd = t2 - t1, i2 - i1
        if td <= 0:
            return None
        return round((td - idd) / td * 1000) / 10
    except (OSError, ValueError, IndexError):
        return None


def read_mem_mb():
    """(total_mb, used_mb) from /proc/meminfo; used = total - available."""
    try:
        info = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                key, _, value = line.partition(":")
                info[key] = int(value.strip().split()[0])  # kB
        total = info["MemTotal"] / 1024
        avail = info.get("MemAvailable", info.get("MemFree", 0)) / 1024
        return round(total), round(total - avail)
    except (OSError, ValueError, KeyError, IndexError):
        return None, None


# Pseudo/virtual filesystems we never report as storage (mirrors the dashboard's
# fetchStorageInfo filter, which drops overlay/tmpfs/squashfs/dev/etc.).
_STORAGE_SKIP_FSTYPES = {
    "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "overlay", "squashfs",
    "cgroup", "cgroup2", "mqueue", "debugfs", "tracefs", "securityfs",
    "pstore", "bpf", "configfs", "fusectl", "ramfs", "autofs", "hugetlbfs",
    "efivarfs", "binfmt_misc", "nsfs", "selinuxfs", "rpc_pipefs",
    # Network filesystems: statvfs() can block indefinitely on an unreachable host
    # (hard-mount semantics), which would freeze the snapshot loop. Skip them.
    "nfs", "nfs4", "cifs", "smbfs", "smb3", "ncpfs", "fuse.sshfs",
}


def read_storage():
    """List of {label, mount, usedBytes, sizeBytes, percent} for real mounts.

    Best-effort: returns [] on any failure so a storage read never drops a snapshot.
    """
    try:
        out = []
        seen_mounts = set()
        seen_devices = set()
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                device, mount, fstype = parts[0], parts[1], parts[2]
                if fstype in _STORAGE_SKIP_FSTYPES or mount in seen_mounts:
                    continue
                # Skip bind-mount duplicates: the same real device mounted twice.
                if device.startswith("/dev/") and device in seen_devices:
                    continue
                seen_mounts.add(mount)
                seen_devices.add(device)
                try:
                    st = os.statvfs(mount)
                except OSError:
                    continue
                size = st.f_blocks * st.f_frsize
                if size <= 0:
                    continue
                free = st.f_bavail * st.f_frsize
                used = size - free
                label = mount.rstrip("/").split("/")[-1] or device.split("/")[-1] or mount
                out.append({
                    "label": label,
                    "mount": mount,
                    "usedBytes": used,
                    "sizeBytes": size,
                    "percent": round(used / size * 100),
                })
        out.sort(key=lambda m: m["percent"], reverse=True)
        return out
    except Exception:
        return []


def gather_snapshot():
    total_mb, used_mb = read_mem_mb()
    uptime = read_uptime()
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": read_cpu_usage(),
        "mem_used_mb": used_mb,
        "mem_total_mb": total_mb,
        "temp_celsius": read_cpu_temp(),
        "uptime_seconds": int(uptime) if uptime is not None else None,
        "storage": read_storage(),
    }


def snapshot_loop(cfg):
    """Periodically gather + push a system snapshot. Best-effort (no buffering)."""
    url = endpoint_for(cfg, "snapshots")
    interval = int(cfg.get("snapshot_interval_sec", 300))
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    while True:
        try:
            snap = gather_snapshot()
            ok = http_post_json(url, snap, token, timeout)
            log.info(
                "snapshot -> %s (cpu=%s%% temp=%s)",
                "ok" if ok else "failed",
                snap.get("cpu_percent"),
                snap.get("temp_celsius"),
            )
        except Exception as e:  # never let the thread die
            log.error("snapshot_loop error: %s", e)
        time.sleep(interval)


# ── Collection sync (ship gamelist.xml + userdata to the cloud parser) ────────
def find_gamelists():
    """Gamelist paths under external USB roms dirs (matches listSystems)."""
    paths = []
    for p in glob.glob("/recalbox/share/externals/usb*/recalbox/roms/*/gamelist.xml"):
        system = os.path.basename(os.path.dirname(p))
        if system == "ports" or system.startswith("."):
            continue
        paths.append(p)
    return sorted(paths)


def _read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def iter_gamelist_chunks(xml, max_bytes):
    """Split a gamelist into <gameList>-wrapped chunks, each holding whole <game>
    blocks under ~max_bytes. Used only for systems whose full gamelist exceeds the
    cloud body limit; the server upserts per romPath so chunks accumulate (nothing
    is wiped). Yields nothing when there are no <game> blocks (caller sends whole)."""
    blocks = re.findall(r"<game\b[^>]*>.*?</game>", xml, re.DOTALL)
    if not blocks:
        return
    header, footer = '<?xml version="1.0"?>\n<gameList>\n', "\n</gameList>\n"
    cur, size = [], 0
    for b in blocks:
        bl = len(b.encode("utf-8"))
        if cur and size + bl > max_bytes:
            yield header + "\n".join(cur) + footer
            cur, size = [], 0
        cur.append(b)
        size += bl
    if cur:
        yield header + "\n".join(cur) + footer


def push_collection(cfg):
    """Ship each system's gamelist.xml (+ userdata.ini) to the cloud, which parses
    and upserts. Large gamelists are split into chunks under the cloud body limit
    (~4.5 MB on Vercel); final=true on the very last request triggers the
    inherited-stats refresh once."""
    url = endpoint_for(cfg, "collection")
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    max_xml = int(cfg.get("collection_max_xml_bytes", 3_500_000))
    paths = find_gamelists()
    log.info("collection: %d gamelist(s) found", len(paths))

    # Build the whole job list first so final=true lands on the actual last request.
    jobs = []  # list of (gpath, xml_or_chunk, userdata)
    for gpath in paths:
        xml = _read_text(gpath)
        if xml is None:
            continue
        userdata = _read_text(os.path.join(os.path.dirname(gpath), "gamelist-userdata.ini"))
        if len(xml.encode("utf-8")) > max_xml:
            chunks = list(iter_gamelist_chunks(xml, max_xml)) or [xml]
            log.info("collection: %s large, split into %d chunk(s)", gpath, len(chunks))
        else:
            chunks = [xml]
        for c in chunks:
            jobs.append((gpath, c, userdata))

    last = len(jobs) - 1
    for i, (gpath, xml, userdata) in enumerate(jobs):
        payload = {
            "gamelist_path": gpath,
            "gamelist_xml": xml,
            "userdata_ini": userdata,
            "final": i == last,
        }
        ok = http_post_json(url, payload, token, timeout)
        log.info("collection: %s [%d/%d] -> %s", gpath, i + 1, len(jobs), "ok" if ok else "failed")


def collection_loop(cfg):
    interval = int(cfg.get("collection_interval_sec", 21600))
    if interval <= 0:
        log.info("Collection sync disabled (collection_interval_sec<=0)")
        return
    while True:
        try:
            push_collection(cfg)
        except Exception as e:  # never let the thread die
            log.error("collection_loop error: %s", e)
        time.sleep(interval)


# ── Remote-control commands (poll → execute → report) ────────────────────────
RECALBOX_CONF = "/recalbox/share/system/recalbox.conf"
CONF_KEY_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def run_cmd(args, timeout=30):
    """Run a command (argv list, NO shell). Returns (ok, output)."""
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return proc.returncode == 0, (proc.stdout + proc.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)


def set_conf_value(path, key, value):
    """Set key=value in a recalbox.conf-style file, in place. Replaces the line
    for `key` (commented or not), else appends it. No shell, no injection: the
    key is validated and the value is written as a literal single line."""
    line = "%s=%s" % (key, value)
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        lines = []
    pat = re.compile(r"^\s*;?\s*" + re.escape(key) + r"\s*=")
    for i, existing in enumerate(lines):
        if pat.match(existing):
            lines[i] = line
            break
    else:
        lines.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def exec_power(payload):
    action = payload.get("action")
    if action == "reboot":
        return run_cmd(["reboot"])
    if action == "shutdown":
        return run_cmd(["poweroff"])
    return False, "unknown power action: %s" % action


def exec_conf(payload):
    key = payload.get("key") or ""
    value = "" if payload.get("value") is None else str(payload.get("value"))
    if not CONF_KEY_RE.match(key):
        return False, "invalid conf key"
    if "\n" in value or "\r" in value:
        # A newline would splice extra key=value lines into recalbox.conf beyond the one
        # this command is scoped to. Reject rather than silently rewrite unrelated keys.
        return False, "invalid conf value (newline)"
    try:
        set_conf_value(RECALBOX_CONF, key, value)
        return True, "%s=%s" % (key, value)
    except OSError as e:
        return False, str(e)


def exec_launch(payload):
    # Launching a game requires EmulationStation's device-specific mechanism,
    # which must be verified on the box before wiring. The queue is ready; this
    # executor is intentionally a no-op until that mechanism is confirmed.
    return False, "launch not supported by agent yet"


def execute_command(cmd):
    ctype = cmd.get("type")
    payload = cmd.get("payload") or {}
    if ctype == "power":
        return exec_power(payload)
    if ctype == "conf":
        return exec_conf(payload)
    if ctype == "launch":
        return exec_launch(payload)
    return False, "unknown command type: %s" % ctype


def report_result(result_url, token, timeout, cid, ok, output):
    http_post_json(result_url, {"id": cid, "ok": ok, "result": (output or "")[:4096]}, token, timeout)


def handle_command(cmd, result_url, token, timeout):
    cid = cmd.get("id")
    ctype = cmd.get("type")
    log.info("command %s: %s", cid, ctype)
    # Power cuts the agent off mid-flight, so report success first (the box is
    # about to go down) and then execute.
    if ctype == "power":
        action = (cmd.get("payload") or {}).get("action")
        report_result(result_url, token, timeout, cid, True, "executing power: %s" % action)
        execute_command(cmd)
        return
    ok, output = execute_command(cmd)
    report_result(result_url, token, timeout, cid, ok, output)


def command_loop(cfg):
    """Poll the cloud for pending commands, execute them locally, report back."""
    url = endpoint_for(cfg, "commands")
    result_url = (url + "/result") if url else ""
    interval = int(cfg.get("command_poll_interval_sec", 60))
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    while True:
        try:
            data = http_get_json(url, token, timeout)
            for cmd in (data or {}).get("commands") or []:
                handle_command(cmd, result_url, token, timeout)
        except Exception as e:  # never let the thread die
            log.error("command_loop error: %s", e)
        time.sleep(interval)


# ── Now-playing relay (live game state, pushed on start/stop) ─────────────────
def push_now_playing(cfg, payload):
    """Push the box's live now-playing state. Best-effort (no buffer): a missed
    update is corrected by the next start/stop event."""
    url = endpoint_for(cfg, "now-playing")
    ok = http_post_json(url, payload, cfg.get("token"), cfg.get("http_timeout_sec", 10))
    log.info(
        "now-playing %s -> %s",
        "playing" if payload.get("playing") else "stopped",
        "ok" if ok else "failed",
    )


# ── Artwork upload (request-driven: cloud marks "wanted", agent uploads) ──────
def upload_artwork(cfg, box_path):
    """Read one box image file and upload its bytes to the cloud, which stores it
    in object storage. Bounded by artwork_max_bytes (respects the cloud body limit)."""
    # defense-in-depth: only ever read files that really live under /recalbox/ after
    # resolving symlinks and ".." — a prefix check alone is bypassable
    # ("/recalbox/../etc/shadow" literally startswith "/recalbox/").
    real = os.path.realpath(box_path)
    if real != "/recalbox" and not real.startswith("/recalbox/"):
        log.warning("artwork rejected (path escapes share): %s", box_path)
        return
    try:
        with open(real, "rb") as f:
            raw = f.read()
    except OSError as e:
        log.warning("artwork read failed %s: %s", box_path, e)
        return
    max_bytes = int(cfg.get("artwork_max_bytes", 4000000))
    if len(raw) == 0 or len(raw) > max_bytes:
        log.info("artwork skip %s (%d bytes)", box_path, len(raw))
        return
    payload = {"box_path": box_path, "data": base64.b64encode(raw).decode("ascii")}
    url = endpoint_for(cfg, "artwork")
    ok = http_post_json(url, payload, cfg.get("token"), cfg.get("http_timeout_sec", 10))
    log.info("artwork %s -> %s", box_path, "ok" if ok else "failed")


def artwork_loop(cfg):
    """Poll the cloud for artwork browsers requested but we haven't uploaded yet,
    and upload each. Lazy/on-demand — no bulk sweep."""
    interval = int(cfg.get("artwork_poll_interval_sec", 60))
    if interval <= 0:
        log.info("Artwork upload disabled (artwork_poll_interval_sec<=0)")
        return
    url = endpoint_for(cfg, "artwork")
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    while True:
        try:
            data = http_get_json(url, token, timeout)
            for box_path in (data or {}).get("wanted") or []:
                upload_artwork(cfg, box_path)
        except Exception as e:  # never let the thread die
            log.error("artwork_loop error: %s", e)
        time.sleep(interval)


# ── MQTT wiring ──────────────────────────────────────────────────────────────
def build_client():
    """Construct a paho client that works on both paho-mqtt 1.x and 2.x."""
    try:
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)  # paho >= 2.0
    except (AttributeError, TypeError):
        return mqtt.Client()  # paho < 2.0


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    cfg = load_config()
    log.info(
        "sr-agent starting (recalbox_id=%s, mqtt=%s:%s, cloud=%s)",
        cfg.get("recalbox_id"),
        cfg.get("mqtt_host"),
        cfg.get("mqtt_port"),
        cfg.get("cloud_url") or "<unset>",
    )

    deliverer = Deliverer(cfg)
    tracker = SessionTracker(cfg, deliverer)

    threading.Thread(target=deliverer.flush_loop, daemon=True).start()
    threading.Thread(target=snapshot_loop, args=(cfg,), daemon=True).start()
    log.info("System snapshots every %ss", cfg.get("snapshot_interval_sec", 300))
    if int(cfg.get("collection_interval_sec", 21600)) > 0:
        threading.Thread(target=collection_loop, args=(cfg,), daemon=True).start()
        log.info("Collection sync every %ss", cfg.get("collection_interval_sec", 21600))
    else:
        log.info("Collection sync disabled")
    threading.Thread(target=command_loop, args=(cfg,), daemon=True).start()
    log.info("Command poll every %ss", cfg.get("command_poll_interval_sec", 60))
    if int(cfg.get("artwork_poll_interval_sec", 60)) > 0:
        threading.Thread(target=artwork_loop, args=(cfg,), daemon=True).start()
        log.info("Artwork upload poll every %ss", cfg.get("artwork_poll_interval_sec", 60))
    else:
        log.info("Artwork upload disabled")

    def on_connect(client, userdata, flags, *args):
        log.info("MQTT connected, subscribing to %s", ES_EVENT_TOPIC)
        client.subscribe(ES_EVENT_TOPIC, qos=0)

    def on_disconnect(client, userdata, *args):
        log.warning("MQTT disconnected; paho will auto-reconnect")

    def on_message(client, userdata, msg):
        ev = parse_es_event(msg.payload)
        if not ev:
            return
        try:
            if ev["type"] == "game:start":
                tracker.on_start(ev)
                if not ev.get("from_screensaver"):
                    push_now_playing(
                        cfg,
                        {
                            "playing": True,
                            "system": ev.get("system"),
                            "system_full_name": ev.get("system_full_name"),
                            "rom_path": ev.get("rom_path"),
                            "game_name": ev.get("game_name"),
                            "image_path": ev.get("image_path"),
                            "emulator": ev.get("emulator"),
                            "started_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
            elif ev["type"] == "game:stop":
                tracker.on_stop(ev)
                push_now_playing(
                    cfg,
                    {
                        "playing": False,
                        "system": ev.get("system"),
                        "rom_path": ev.get("rom_path"),
                        "game_name": ev.get("game_name"),
                    },
                )
        except Exception as e:  # never let a bad event kill the loop
            log.error("event handling error: %s", e)

    client = build_client()
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    host = cfg.get("mqtt_host", "127.0.0.1")
    port = int(cfg.get("mqtt_port", 1883))
    while True:
        try:
            client.connect(host, port, keepalive=60)
            client.loop_forever()  # blocks; handles reconnects internally
        except (OSError, ValueError) as e:
            log.warning("MQTT connect failed (%s); retry in 5s", e)
            time.sleep(5)


if __name__ == "__main__":
    main()
