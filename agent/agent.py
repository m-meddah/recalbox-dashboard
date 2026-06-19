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


# ── Cloud delivery (HTTPS POST + disk buffer) ────────────────────────────────
class Deliverer:
    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()

    def _post(self, session: dict) -> bool:
        url = self.cfg.get("cloud_url")
        if not url:
            log.error("No cloud_url configured; cannot push")
            return False
        body = json.dumps(session).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        token = self.cfg.get("token")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, timeout=self.cfg.get("http_timeout_sec", 10), context=ctx) as resp:
                ok = 200 <= resp.status < 300
                log.info("POST %s -> %s for %s", url, resp.status, session.get("rom_path"))
                return ok
        except (urllib.error.URLError, OSError, ValueError) as e:
            log.warning("POST failed (%s) for %s -> buffering", e, session.get("rom_path"))
            return False

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
