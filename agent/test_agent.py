#!/usr/bin/env python3
"""Tests for the agent's offline buffer retry policy.

Stdlib unittest only: the agent is deliberately dependency-free, and these run
without installing anything. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import io
import json
import multiprocessing
import os
import shutil
import subprocess
import sys
import tempfile
import time
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


class IdleDelayTest(unittest.TestCase):
	"""Distinct from the retry backoff above: here the cloud answers fine, there is simply
	nothing to do. An always-on box asking "any artwork wanted?" every 60s spends most of
	its life on an empty queue, and each of those polls is a billed serverless invocation."""

	def test_delay_doubles_while_the_queue_stays_empty(self):
		self.assertEqual(agent.next_idle_delay(60, 60, False, 300), 120)
		self.assertEqual(agent.next_idle_delay(120, 60, False, 300), 240)

	def test_delay_is_capped_at_idle_max(self):
		self.assertEqual(agent.next_idle_delay(240, 60, False, 300), 300)
		self.assertEqual(agent.next_idle_delay(300, 60, False, 300), 300)

	def test_delay_resets_to_base_as_soon_as_there_is_work(self):
		"""Browsing a collection queues many images: the first one seen must drop the loop
		back to its normal cadence so the rest follow within a minute, not five."""
		self.assertEqual(agent.next_idle_delay(300, 60, True, 300), 60)

	def test_a_slower_configured_interval_is_never_sped_up(self):
		"""Mirrors next_retry_delay: a cap must not make a deliberately lazy loop faster."""
		base = 900
		self.assertEqual(agent.next_idle_delay(base, base, False, 300), base)


class _JsonResp:
	"""200 response carrying a real body, which http_get_json needs (_Resp has no read)."""

	def __init__(self, body):
		self.status = 200
		self._body = body

	def read(self):
		return self._body

	def __enter__(self):
		return self

	def __exit__(self, *_):
		return False


class _JsonUrlopen:
	"""Fake urlopen that always answers 200 with the same JSON payload."""

	def __init__(self, payload):
		self.body = json.dumps(payload).encode("utf-8")
		self.calls = 0

	def __call__(self, req, timeout=None, context=None):
		self.calls += 1
		return _JsonResp(self.body)


class ArtworkIdleBackoffTest(unittest.TestCase):
	"""A box left on all day asks "any artwork wanted?" 1440 times and the queue is empty
	for nearly all of them, each one a billed invocation. The loop must slow down while
	there is nothing to fetch — and snap back the moment there is, or browsing a collection
	would show placeholders for minutes."""

	def setUp(self):
		self.cfg = {
			"cloud_url": "https://example.test/api/agent/ingest",
			"token": "tok",
			"http_timeout_sec": 1,
			"artwork_poll_interval_sec": 60,
			"artwork_idle_max_sec": 300,
		}

	def _run(self, payload, stop_after=4):
		rec = _SleepRecorder(stop_after)
		with mock.patch.object(agent.time, "sleep", rec), mock.patch.object(
			agent.urllib.request, "urlopen", _JsonUrlopen(payload)
		), mock.patch.object(agent, "upload_artwork", lambda *a, **k: None):
			try:
				agent.artwork_loop(self.cfg)
			except _StopLoop:
				pass
		return rec.delays

	def test_empty_queue_backs_off_up_to_the_idle_cap(self):
		self.assertEqual(self._run({"wanted": []}), [120, 240, 300, 300])

	def test_a_wanted_image_holds_the_configured_cadence(self):
		self.assertEqual(self._run({"wanted": ["/recalbox/share/x.png"]}), [60, 60, 60, 60])

	def test_idle_backoff_stays_well_under_the_outage_ceiling(self):
		"""Regression guard on the two backoffs being distinct: an idle box must not drift
		toward the 30min outage ceiling, which would make artwork feel broken."""
		self.assertLess(max(self._run({"wanted": []}, stop_after=8)), agent.MAX_RETRY_BACKOFF_SEC)


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


class LockingTest(unittest.TestCase):
	"""The single-instance lock used to live in launch.py; it now lives here because
	launch.py is not the only thing that starts the agent. An older install still in
	the field (custom.sh) runs `python3 agent.py` directly, skipping launch.py
	entirely — so the lock has to be owned by the one file every start path always
	runs through: agent.py itself."""

	def setUp(self):
		"""Creer un repertoire temporaire pour les verrous de test."""
		self.temp_dir = tempfile.mkdtemp()
		self.original_lock_path = agent.lock_path
		# Remplacer lock_path() par une version qui utilise le temp dir
		agent.lock_path = lambda: os.path.join(self.temp_dir, "launch.lock")

	def tearDown(self):
		"""Nettoyer le repertoire temporaire et restaurer lock_path."""
		shutil.rmtree(self.temp_dir, ignore_errors=True)
		agent.lock_path = self.original_lock_path

	def test_free_lock_is_acquired(self):
		"""Un verrou libre doit etre acquis avec succes."""
		acquired, lock_fd = agent.acquire_lock()
		self.assertTrue(acquired)
		self.assertIsNotNone(lock_fd)
		# Verifier que le fichier de verrou existe
		self.assertTrue(os.path.exists(os.path.join(self.temp_dir, "launch.lock")))
		# Verifier qu'il contient le pid courant (pour le debug)
		with open(os.path.join(self.temp_dir, "launch.lock"), "r") as f:
			content = f.read().strip()
		self.assertEqual(content, str(os.getpid()))
		os.close(lock_fd)

	def test_second_caller_while_first_holds_lock_gets_false(self):
		"""Un deuxieme appelant tandis que le premier tient le verrou doit obtenir False."""
		acquired1, lock_fd1 = agent.acquire_lock()
		self.assertTrue(acquired1)
		self.assertIsNotNone(lock_fd1)

		# Tenter d'acquerir le verrou alors qu'il est deja tenu
		acquired2, lock_fd2 = agent.acquire_lock()
		self.assertFalse(acquired2)
		self.assertIsNone(lock_fd2)

		os.close(lock_fd1)

	def test_lock_is_acquirable_again_after_holder_exits(self):
		"""Le verrou doit etre acquirable apres que le titulaire ait ferme le fd."""
		acquired1, lock_fd1 = agent.acquire_lock()
		self.assertTrue(acquired1)
		self.assertIsNotNone(lock_fd1)

		# Fermer le fd (simule la mort du processus titulaire)
		os.close(lock_fd1)

		# Tenter d'acquerir le verrou a nouveau — doit reussir car le noyau
		# a automatiquement libere le verrou quand le fd a ete ferme
		acquired2, lock_fd2 = agent.acquire_lock()
		self.assertTrue(acquired2)
		self.assertIsNotNone(lock_fd2)

		os.close(lock_fd2)

	@staticmethod
	def _worker_acquire_lock(result_queue):
		"""Fonction worker pour test de concurrence: tente d'acquerir le verrou."""
		acquired, lock_fd = agent.acquire_lock()
		result_queue.put({"acquired": acquired, "pid": os.getpid()})
		if acquired and lock_fd is not None:
			# Garder le verrou pendant 0.2 secondes pour permettre a d'autres
			# callers de tenter l'acquisition
			time.sleep(0.2)
			os.close(lock_fd)

	def test_exactly_one_caller_among_many_gets_lock(self):
		"""Exactement un appelant parmi N doit acquerir le verrou."""
		num_callers = 5
		result_queue = multiprocessing.Queue()

		# Lancer N processus qui tentent tous d'acquerir le verrou
		processes = []
		for _ in range(num_callers):
			p = multiprocessing.Process(
				target=LockingTest._worker_acquire_lock, args=(result_queue,)
			)
			p.start()
			processes.append(p)

		# Attendre que tous les processus se terminent
		for p in processes:
			p.join(timeout=5)

		# Collecter les resultats
		results = []
		while not result_queue.empty():
			results.append(result_queue.get())

		# Verifier qu'exactement un processus a acquis le verrou
		acquired_count = sum(1 for r in results if r["acquired"])
		self.assertEqual(
			acquired_count, 1, f"Expected 1 lock holder, got {acquired_count}"
		)
		# Verifier que tous les autres ont obtenu False
		failed_count = sum(1 for r in results if not r["acquired"])
		self.assertEqual(failed_count, num_callers - 1)

	def test_oserror_from_os_open_propagates_not_swallowed(self):
		"""Erreurs non-flock (e.g. os.open EACCES) doivent propager, pas etre avalees."""
		# Regression test: narrow OSError catch to only fcntl.flock(). Errors from
		# os.open/set_inheritable/ftruncate/write must propagate and appear in
		# agent.log as tracebacks, not silently treated as "another agent holds
		# the lock".

		original_os_open = os.open

		def failing_os_open(path, flags, mode=None):
			# Simulate a filesystem permission error
			raise PermissionError(f"[Errno 13] Permission denied: '{path}'")

		# Monkeypatch os.open to fail
		os.open = failing_os_open
		try:
			# acquire_lock should propagate the PermissionError, not return (False, None)
			with self.assertRaises(PermissionError):
				agent.acquire_lock()
		finally:
			# Restore original
			os.open = original_os_open


class DirectInvocationLockTest(unittest.TestCase):
	"""The property this whole change exists to deliver: the OLD custom.sh install
	starts the agent with `python3 agent.py` directly, never touching launch.py. It
	must still contend for the exact same lock as a box started the current way
	(python3 launch.py, which execv's into agent.py). Runs real subprocesses — not
	monkeypatched in-process calls — so launch.py genuinely has zero lock code left
	to exercise and the two entry points are exercised as they are on a real box."""

	def setUp(self):
		self.work = tempfile.mkdtemp()
		agent_dir = os.path.dirname(os.path.abspath(__file__))
		shutil.copy(os.path.join(agent_dir, "agent.py"), os.path.join(self.work, "agent.py"))
		shutil.copy(os.path.join(agent_dir, "launch.py"), os.path.join(self.work, "launch.py"))
		shutil.copy(os.path.join(agent_dir, "updater.py"), os.path.join(self.work, "updater.py"))

		# agent.py imports paho at module level. The in-process sys.modules stub used
		# by the rest of this file doesn't cross into a subprocess, so stub it on disk.
		stub_root = os.path.join(self.work, "_stubs")
		pkg_dir = os.path.join(stub_root, "paho", "mqtt")
		os.makedirs(pkg_dir)
		open(os.path.join(stub_root, "paho", "__init__.py"), "w").close()
		open(os.path.join(pkg_dir, "__init__.py"), "w").close()
		with open(os.path.join(pkg_dir, "client.py"), "w", encoding="utf-8") as f:
			f.write(
				"class CallbackAPIVersion:\n"
				"    VERSION2 = 2\n"
				"class Client:\n"
				"    def __init__(self, *a, **k):\n"
				"        self.on_connect = self.on_disconnect = self.on_message = None\n"
				"    def subscribe(self, *a, **k):\n"
				"        pass\n"
				"    def reconnect_delay_set(self, *a, **k):\n"
				"        pass\n"
				"    def connect(self, *a, **k):\n"
				"        raise OSError('stub: no real broker in tests')\n"
				"    def loop_forever(self):\n"
				"        pass\n"
			)
		self.env = dict(os.environ)
		self.env["PYTHONPATH"] = stub_root + os.pathsep + self.env.get("PYTHONPATH", "")
		self.procs = []

	def tearDown(self):
		for p in self.procs:
			if p.poll() is None:
				p.kill()
				p.wait(timeout=5)
		shutil.rmtree(self.work, ignore_errors=True)

	def _spawn(self, script_name):
		proc = subprocess.Popen(
			[sys.executable, os.path.join(self.work, script_name)],
			cwd=self.work,
			env=self.env,
			stdout=subprocess.PIPE,
			stderr=subprocess.STDOUT,
			text=True,
		)
		self.procs.append(proc)
		return proc

	def test_direct_invocation_and_launcher_contend_for_the_same_lock(self):
		# No config.json: defaults leave cloud_url empty, so every network call in
		# every background loop is a no-op (endpoint_for returns "" -> http calls
		# short-circuit) and the lock decision at the top of main() is the only
		# thing that matters for this test.
		direct = self._spawn("agent.py")  # the old custom.sh path
		via_launcher = self._spawn("launch.py")  # the current launcher path

		loser = winner = None
		deadline = time.time() + 5
		while time.time() < deadline and loser is None:
			if direct.poll() is not None:
				loser, winner = direct, via_launcher
			elif via_launcher.poll() is not None:
				loser, winner = via_launcher, direct
			else:
				time.sleep(0.05)

		self.assertIsNotNone(loser, "neither process exited within 5s; expected exactly one loser")
		self.assertEqual(loser.returncode, 0, loser.stdout.read() if loser.stdout else "")

		# The winner must still be holding the lock, not also exited. Only read its
		# stdout in the failure branch: reading a still-alive process's pipe blocks
		# until it closes, which would hang this test in the passing case.
		time.sleep(0.2)
		winner_exit = winner.poll()
		if winner_exit is not None:
			self.fail(
				"the winner should still be running (holds the lock) but exited with %r: %s"
				% (winner_exit, winner.stdout.read() if winner.stdout else "")
			)


if __name__ == "__main__":
	unittest.main()


class RepeatedFailureLogTest(unittest.TestCase):
	"""Une panne du cloud est un etat, pas un evenement par tentative."""

	def setUp(self):
		agent._repeats.clear()

	def tearDown(self):
		agent._repeats.clear()

	def test_the_first_failure_speaks_and_the_repeats_stay_silent(self):
		with self.assertLogs("sr-agent", level="WARNING") as cm:
			for _ in range(50):
				agent.log_repeating(("POST", "u"), "HTTP 402", "POST %s failed: HTTP %s", "u", 402)
		self.assertEqual(len(cm.output), 1, "50 tentatives identiques = une seule ligne")

	def test_a_different_cause_takes_the_floor_again(self):
		"""Un 402 devenu 500, c'est une autre panne : la voir est tout l'interet."""
		with self.assertLogs("sr-agent", level="WARNING") as cm:
			agent.log_repeating(("POST", "u"), "HTTP 402", "cloud unpaid")
			agent.log_repeating(("POST", "u"), "HTTP 500", "cloud broken")
		self.assertEqual(len(cm.output), 2)

	def test_a_lasting_failure_gets_a_periodic_summary(self):
		agent.log_repeating(("POST", "u"), "HTTP 402", "boom")
		agent._repeats[("POST", "u")]["last_summary"] -= agent.REPEAT_SUMMARY_SEC + 1
		with self.assertLogs("sr-agent", level="WARNING") as cm:
			agent.log_repeating(("POST", "u"), "HTTP 402", "boom")
		self.assertIn("still failing: 2 attempts", cm.output[0])

	def test_recovery_reports_what_the_outage_cost_then_stays_quiet(self):
		for _ in range(4):
			agent.log_repeating(("POST", "u"), "HTTP 402", "boom")
		with self.assertLogs("sr-agent", level="INFO") as cm:
			agent.log_recovered(("POST", "u"), "POST %s", "u")
		self.assertIn("recovered after 4", cm.output[0])
		# assertLogs echoue quand rien n'est journalise : c'est ainsi que l'on
		# affirme un silence sans exiger un Python 3.10 (assertNoLogs).
		with self.assertRaises(AssertionError):
			with self.assertLogs("sr-agent", level="INFO"):
				agent.log_recovered(("POST", "u"), "POST %s", "u")


class LogVolumeTest(unittest.TestCase):
	"""Le journal ne doit plus grossir avec le nombre de sessions en attente.
	C'est cette amplification — une ligne par session ET par tentative — qui a
	produit 170 000 lignes pendant la seule panne de juillet."""

	def setUp(self):
		self.tmp = tempfile.mkdtemp()
		self._orig = agent.BUFFER_PATH
		agent.BUFFER_PATH = os.path.join(self.tmp, "buffer.jsonl")
		agent._repeats.clear()
		self.cfg = {
			"cloud_url": "https://example.test/api/agent/ingest",
			"token": "tok",
			"http_timeout_sec": 1,
		}

	def tearDown(self):
		agent.BUFFER_PATH = self._orig
		agent._repeats.clear()
		shutil.rmtree(self.tmp, ignore_errors=True)

	def test_a_stuck_buffer_does_not_log_once_per_session_per_attempt(self):
		fake = _Urlopen(503)
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", fake):
			with self.assertLogs("sr-agent", level="INFO") as cm:
				for i in range(20):
					d.deliver(_session("/roms/snes/g%d.zip" % i))
				for _ in range(5):
					d.flush()
		self.assertEqual(fake.calls, 120, "le tampon est bien rejoue a chaque cycle")
		technical = [r for r in cm.records if r.name == "sr-agent"]
		played = [r for r in cm.records if r.name == agent.SESSION_LOGGER]
		self.assertEqual(len(played), 20, "une ligne de jeu par session, jamais par tentative")
		self.assertEqual(len(technical), 1, "120 echecs sur la meme cause = une seule ligne")

	def test_a_flush_that_works_reports_one_summary_line(self):
		d = agent.Deliverer(self.cfg)
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(503)):
			for i in range(20):
				d.deliver(_session("/roms/snes/g%d.zip" % i))
		with mock.patch.object(agent.urllib.request, "urlopen", _Urlopen(200)):
			with self.assertLogs("sr-agent", level="INFO") as cm:
				d.flush()
		summaries = [
			r.getMessage()
			for r in cm.records
			if r.name == "sr-agent" and "Buffer flush" in r.getMessage()
		]
		self.assertEqual(len(summaries), 1)
		self.assertIn("20 delivered", summaries[0])
		self.assertIn("0 still pending", summaries[0])
