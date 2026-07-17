#!/usr/bin/env python3
"""Tests for the agent's offline buffer retry policy.

Stdlib unittest only: the agent is deliberately dependency-free, and these run
without installing anything. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
import urllib.error
from unittest import mock

# agent.py imports paho at module level. It ships with RecalboxOS but is not
# needed to exercise the HTTP/buffer logic, so stub it to keep the import cheap.
if "paho" not in sys.modules:
	_paho = types.ModuleType("paho")
	_mqtt = types.ModuleType("paho.mqtt")
	_client = types.ModuleType("paho.mqtt.client")
	_client.Client = object
	_paho.mqtt = _mqtt
	_mqtt.client = _client
	sys.modules["paho"] = _paho
	sys.modules["paho.mqtt"] = _mqtt
	sys.modules["paho.mqtt.client"] = _client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent  # noqa: E402


class _Resp:
	def __init__(self, status):
		self.status = status

	def __enter__(self):
		return self

	def __exit__(self, *_):
		return False


class _Urlopen:
	"""Fake urlopen that always replies the same way, counting the attempts."""

	def __init__(self, status):
		self.status = status
		self.calls = 0

	def __call__(self, req, timeout=None, context=None):
		self.calls += 1
		if 200 <= self.status < 300:
			return _Resp(self.status)
		raise urllib.error.HTTPError(
			req.full_url, self.status, "err", {}, io.BytesIO(b"{}")
		)


def _session(rom="/recalbox/share/roms/snes/game.zip"):
	return {
		"recalbox_id": "box",
		"source": "agent",
		"started_at": "2026-07-17T10:00:00+00:00",
		"ended_at": "2026-07-17T10:05:00+00:00",
		"duration_seconds": 300,
		"system": "snes",
		"rom_path": rom,
		"game_name": "Game",
		"auto_closed": False,
		"closed_reason": None,
	}


class BufferRetryPolicyTest(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp()
		self._orig = agent.BUFFER_PATH
		agent.BUFFER_PATH = os.path.join(self.tmp, "buffer.jsonl")
		self.cfg = {
			"cloud_url": "https://example.test/api/agent/ingest",
			"token": "tok",
			"http_timeout_sec": 1,
		}

	def tearDown(self):
		agent.BUFFER_PATH = self._orig
		shutil.rmtree(self.tmp, ignore_errors=True)

	def _buffered(self):
		try:
			with open(agent.BUFFER_PATH, "r", encoding="utf-8") as f:
				return [json.loads(ln) for ln in f.read().splitlines() if ln.strip()]
		except FileNotFoundError:
			return []

	def test_payload_rejected_as_invalid_is_dropped_not_retried_forever(self):
		"""A 400 means the server will NEVER accept this payload. Retrying it every
		cycle is the bug behind 25k ingest requests in 12h: drop it after one try."""
		fake = _Urlopen(400)
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", fake):
			d.deliver(_session())
			for _ in range(3):
				d.flush()

		self.assertEqual(fake.calls, 1, "a permanently-rejected session must be posted once, never retried")
		self.assertEqual(self._buffered(), [], "a permanently-rejected session must not stay buffered")

	def test_server_error_is_kept_and_retried(self):
		"""A 5xx is transient — the session is real play data and must survive."""
		fake = _Urlopen(503)
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", fake):
			d.deliver(_session())
			d.flush()

		self.assertEqual(fake.calls, 2, "a transient failure must be retried")
		self.assertEqual(len(self._buffered()), 1, "a transient failure must stay buffered")

	def test_auth_failure_is_kept_not_dropped(self):
		"""A 401 is user-fixable (re-enroll / new token). Dropping would throw away
		real sessions that would succeed once the token is fixed."""
		fake = _Urlopen(401)
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", fake):
			d.deliver(_session())
			d.flush()

		self.assertEqual(len(self._buffered()), 1, "an auth failure must not discard the session")

	def test_buffer_drains_on_success(self):
		fake = _Urlopen(201)
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", fake):
			d.deliver(_session())

		self.assertEqual(self._buffered(), [], "a delivered session must not be buffered")

	def test_stuck_buffer_recovers_once_the_server_accepts(self):
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(503)):
			d.deliver(_session())
		self.assertEqual(len(self._buffered()), 1)

		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(201)):
			d.flush()
		self.assertEqual(self._buffered(), [], "buffer must drain once the server recovers")

	def test_flush_reports_whether_it_made_progress(self):
		"""flush() drives the retry backoff, so it must say if anything moved."""
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(503)):
			d.deliver(_session())
			self.assertFalse(d.flush(), "a stuck buffer is not progress")

		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(201)):
			self.assertTrue(d.flush(), "draining the buffer is progress")


class _StopLoop(BaseException):
	"""Breaks out of an agent loop from the faked sleep. NOT an Exception, so the
	loops' own `except Exception` can never swallow it."""


class _SleepRecorder:
	"""Fake time.sleep: records each delay, then stops the loop."""

	def __init__(self, stop_after):
		self.delays = []
		self.stop_after = stop_after

	def __call__(self, delay):
		self.delays.append(delay)
		if len(self.delays) >= self.stop_after:
			raise _StopLoop


class RetryDelayTest(unittest.TestCase):
	"""Backoff is what caps the request rate against a failing cloud: without it every
	loop keeps its configured cadence forever, which burned 10 days of quota."""

	def test_delay_doubles_while_failing(self):
		self.assertEqual(agent.next_retry_delay(60, 60, False), 120)
		self.assertEqual(agent.next_retry_delay(120, 60, False), 240)

	def test_delay_is_capped(self):
		self.assertEqual(agent.next_retry_delay(agent.MAX_RETRY_BACKOFF_SEC, 60, False), agent.MAX_RETRY_BACKOFF_SEC)
		self.assertLessEqual(agent.next_retry_delay(agent.MAX_RETRY_BACKOFF_SEC - 1, 60, False), agent.MAX_RETRY_BACKOFF_SEC)

	def test_delay_resets_to_base_on_success(self):
		self.assertEqual(agent.next_retry_delay(agent.MAX_RETRY_BACKOFF_SEC, 60, True), 60)

	def test_a_slow_loop_never_backs_off_to_faster_than_configured(self):
		"""collection_interval_sec is 6h — a cap of 30min must not speed it up."""
		base = 21600
		self.assertEqual(agent.next_retry_delay(base, base, False), base)


class PollLoopBackoffTest(unittest.TestCase):
	"""The poll loops (not just the ingest buffer) are what ran 3.4k/day against a dead
	endpoint for 10 days — they must back off too."""

	def setUp(self):
		self.cfg = {
			"cloud_url": "https://example.test/api/agent/ingest",
			"token": "tok",
			"http_timeout_sec": 1,
		}

	def _run(self, loop, status, stop_after=4):
		rec = _SleepRecorder(stop_after)
		with mock.patch.object(agent.time, "sleep", rec), mock.patch.object(
			agent.urllib.request, "urlopen", _Urlopen(status)
		), mock.patch.object(agent, "gather_snapshot", lambda: {"cpu_percent": 1, "temp_celsius": 50}):
			try:
				loop(self.cfg)
			except _StopLoop:
				pass
		return rec.delays

	def test_snapshot_loop_backs_off_on_402(self):
		self.cfg["snapshot_interval_sec"] = 300
		self.assertEqual(self._run(agent.snapshot_loop, 402), [600, 1200, 1800, 1800])

	def test_command_loop_backs_off_on_500(self):
		self.cfg["command_poll_interval_sec"] = 60
		self.assertEqual(self._run(agent.command_loop, 500), [120, 240, 480, 960])

	def test_artwork_loop_backs_off_on_402(self):
		self.cfg["artwork_poll_interval_sec"] = 60
		self.assertEqual(self._run(agent.artwork_loop, 402), [120, 240, 480, 960])

	def test_loops_keep_their_configured_cadence_while_healthy(self):
		self.cfg["snapshot_interval_sec"] = 300
		self.assertEqual(self._run(agent.snapshot_loop, 201), [300, 300, 300, 300])

	def test_artwork_loop_still_honours_the_disable_switch(self):
		self.cfg["artwork_poll_interval_sec"] = 0
		self.assertEqual(self._run(agent.artwork_loop, 402), [], "disabled loop must not poll at all")


class PostOutcomeTest(unittest.TestCase):
	def setUp(self):
		self.args = ("https://example.test/api/agent/ingest", {"a": 1}, "tok", 1)

	def _post_outcome(self, status):
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(status)):
			return agent.http_post_json_outcome(*self.args)

	def test_2xx_is_ok(self):
		self.assertEqual(self._post_outcome(200), agent.POST_OK)
		self.assertEqual(self._post_outcome(201), agent.POST_OK)

	def test_bad_payload_is_permanent(self):
		self.assertEqual(self._post_outcome(400), agent.POST_PERMANENT)
		self.assertEqual(self._post_outcome(422), agent.POST_PERMANENT)

	def test_auth_and_server_errors_are_transient(self):
		for status in (401, 403, 404, 429, 500, 503):
			self.assertEqual(self._post_outcome(status), agent.POST_TRANSIENT, "status %d" % status)

	def test_network_error_is_transient(self):
		def _boom(req, timeout=None, context=None):
			raise urllib.error.URLError("no route to host")

		with mock.patch.object(agent.urllib.request, "urlopen", _boom):
			self.assertEqual(agent.http_post_json_outcome(*self.args), agent.POST_TRANSIENT)

	def test_bool_wrapper_still_reports_2xx_only(self):
		"""The fire-and-forget callers (snapshots, now-playing, collection, command
		results) keep the old bool contract."""
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(200)):
			self.assertTrue(agent.http_post_json(*self.args))
		for status in (400, 401, 500):
			with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(status)):
				self.assertFalse(agent.http_post_json(*self.args))


if __name__ == "__main__":
	unittest.main()
