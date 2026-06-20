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

import json
import logging
import os
import ssl
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

    def sys_ok(v):
        return isinstance(v, dict) and isinstance(v.get("name"), str) and isinstance(v.get("fullname"), str)

    def game_ok(v):
        return isinstance(v, dict) and isinstance(v.get("romPath"), str) and isinstance(v.get("name"), str)

    if event == "rungame" and sys_ok(system) and game_ok(game):
        return {
            "type": "game:start",
            "system": system["name"],
            "rom_path": game["romPath"],
            "game_name": game["name"],
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
                with open(BUFFER_PATH, "w", encoding="utf-8") as f:
                    f.write("\n".join(remaining) + "\n")
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

    def _emit(self, started: float, ended: float, ev: dict, auto_closed: bool, reason):
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
        if self.open:
            self._emit(self.open["started_at"], now, self.open, True, "new_session_started")
        self.open = {
            "started_at": now,
            "system": ev["system"],
            "rom_path": ev["rom_path"],
            "game_name": ev["game_name"],
        }
        log.info("Opened session for %s on %s", ev["rom_path"], ev["system"])

    def on_stop(self, ev: dict):
        now = time.time()
        if self.open and self.open["rom_path"] == ev["rom_path"]:
            self._emit(self.open["started_at"], now, self.open, False, None)
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
    }


def snapshot_loop(cfg):
    """Periodically gather + push a system snapshot. Best-effort (no buffering)."""
    url = endpoint_for(cfg, "snapshots")
    interval = int(cfg.get("snapshot_interval_sec", 60))
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
    log.info("System snapshots every %ss", cfg.get("snapshot_interval_sec", 60))

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
            elif ev["type"] == "game:stop":
                tracker.on_stop(ev)
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
