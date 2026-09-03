#!/usr/bin/env python3
"""Tests du mécanisme de mise à jour automatique.

Stdlib unittest only. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import fcntl
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

# agent.py imports paho at module level. It ships with RecalboxOS but is not
# needed to exercise the update logic, so stub it to keep the import cheap.
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
import test_agent  # noqa: E402 — reuses its _SleepRecorder/_StopLoop/_JsonUrlopen loop-test helpers
import updater  # noqa: E402


def bundle(agent_src="x = 1\n", version="1.1.0\n"):
    """Un paquet complet et valide, que chaque test déforme à sa guise."""
    files = {name: "# ok\n" for name in updater.BUNDLE_FILES}
    files["agent.py"] = agent_src
    files["VERSION"] = version
    return files


class CompareVersionsTest(unittest.TestCase):
    def test_orders_numerically_not_lexicographically(self):
        self.assertGreater(updater.compare_versions("1.10.0", "1.9.0"), 0)
        self.assertLess(updater.compare_versions("1.9.0", "1.10.0"), 0)

    def test_equal_versions(self):
        self.assertEqual(updater.compare_versions("1.1.0", "1.1.0"), 0)

    def test_pads_missing_segments(self):
        self.assertEqual(updater.compare_versions("1.1", "1.1.0"), 0)
        self.assertGreater(updater.compare_versions("2", "1.9.9"), 0)

    def test_garbage_segment_reads_as_zero(self):
        self.assertEqual(updater.compare_versions("1.x.0", "1.0.0"), 0)
        self.assertEqual(updater.compare_versions(None, "0.0.0"), 0)

    def test_matches_the_server_side_rule(self):
        # The same table is asserted in lib/agent/__tests__/version.test.ts.
        # Two implementations, one rule — they must not drift.
        cases = [
            ("1.10.0", "1.9.0", 1),
            ("1.9.0", "1.10.0", -1),
            ("1.1", "1.1.0", 0),
            ("1.10rc1.0", "1.10.0", -1),
        ]
        for a, b, expected in cases:
            got = updater.compare_versions(a, b)
            self.assertEqual((got > 0) - (got < 0), expected, "%s vs %s" % (a, b))


class ReadVersionTest(unittest.TestCase):
    def test_reads_and_strips(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "VERSION"), "w") as f:
                f.write("1.2.3\n")
            self.assertEqual(updater.read_version(d), "1.2.3")

    def test_missing_file_is_lowest_version(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(updater.read_version(d), "0.0.0")


class VerifyBundleTest(unittest.TestCase):
    def test_accepts_a_complete_valid_bundle(self):
        self.assertTrue(updater.verify_bundle(bundle()))

    def test_rejects_python_that_does_not_compile(self):
        # This is the whole point: a truncated download must never be swapped in.
        self.assertFalse(updater.verify_bundle(bundle(agent_src="def broken(:\n")))

    def test_rejects_a_bundle_missing_a_file(self):
        files = bundle()
        del files["scan_roms.py"]
        self.assertFalse(updater.verify_bundle(files))

    def test_rejects_a_non_dict(self):
        self.assertFalse(updater.verify_bundle(None))
        self.assertFalse(updater.verify_bundle([]))

    def test_rejects_a_non_string_entry(self):
        files = bundle()
        files["launch.py"] = 42
        self.assertFalse(updater.verify_bundle(files))

    def test_returns_false_rather_than_raising_when_tmp_is_unwritable(self):
        # mkdtemp used to be called outside the try block: an OSError there
        # (e.g. /tmp full or unwritable) would propagate instead of yielding
        # the False this function promises on every failure path.
        with mock.patch("tempfile.mkdtemp", side_effect=OSError("no space")):
            self.assertFalse(updater.verify_bundle(bundle()))


class SwapTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-swap-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def read(self, *parts):
        with open(os.path.join(self.dir, *parts), "r") as f:
            return f.read()

    def test_swaps_the_files_and_keeps_the_old_ones(self):
        self.assertTrue(
            updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        )
        self.assertEqual(self.read("agent.py"), "# new\n")
        self.assertEqual(self.read("VERSION"), "1.1.0\n")
        self.assertEqual(self.read(updater.BACKUP_DIR, "agent.py"), "# old\n")
        self.assertEqual(updater.backup_version(self.dir), "1.0.0")

    def test_refuses_a_bundle_that_does_not_compile_and_touches_nothing(self):
        self.assertFalse(
            updater.stage_and_swap(self.dir, bundle(agent_src="def x(:\n"), "1.0.0", "1.1.0")
        )
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertIsNone(updater.read_witness(self.dir))

    def test_leaves_no_staging_directory_behind(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertFalse(os.path.exists(os.path.join(self.dir, updater.UPDATE_DIR)))

    def test_a_retry_after_a_failed_swap_keeps_the_last_good_backup(self):
        # backup/ is wiped and refilled from the CURRENT directory on every
        # attempt. After a swap that died mid-os.replace, that current
        # directory is a MIX of both versions — and maybe_update retries every
        # 60s, so a handful of retries inside the 600s grace window would
        # replace the last known-good backup with that mix. The eventual
        # rollback would then restore a poisoned backup AND blacklist the
        # target: a box left mixed, unrepairable, and excluded from the fix.
        real_replace = os.replace
        calls = {"n": 0}

        def flaky_replace(src, dst):
            calls["n"] += 1
            if calls["n"] > 2:
                raise OSError("read-only remount")
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", flaky_replace):
            self.assertFalse(
                updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
            )
        # The mixed state: agent.py already swapped, the rest still old.
        self.assertEqual(self.read("agent.py"), "# new\n")
        self.assertEqual(self.read(updater.BACKUP_DIR, "agent.py"), "# old\n")

        # The retry a minute later must refuse rather than re-snapshot the mix.
        self.assertFalse(
            updater.stage_and_swap(self.dir, bundle(agent_src="# newer\n"), "1.0.0", "1.1.0")
        )
        self.assertEqual(self.read(updater.BACKUP_DIR, "agent.py"), "# old\n")
        self.assertEqual(updater.backup_version(self.dir), "1.0.0")

    def test_refuses_to_stage_while_an_unproven_swap_is_outstanding(self):
        self.assertTrue(updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0"))
        self.assertFalse(updater.stage_and_swap(self.dir, bundle(), "1.1.0", "1.2.0"))
        # Confirmed, the door reopens: the launcher no longer owes a repair.
        updater.confirm_update(self.dir)
        self.assertTrue(updater.stage_and_swap(self.dir, bundle(), "1.1.0", "1.2.0"))

    def test_writes_the_witness_before_swapping(self):
        # os.replace is atomic per file, not across the set: a power cut mid-swap
        # leaves a mix of both versions. With the witness already on disk,
        # launch.py repairs it; written after, nothing would know.
        witness_seen = {}
        real_replace = os.replace

        def spy(src, dst):
            # _write_json is itself atomic (temp file + os.replace), so the
            # very first os.replace call is now the witness's own rename, not
            # a bundle file swap. What this test pins is that the witness is
            # on disk before any BUNDLE_FILES entry is swapped — so only look
            # at replace calls targeting one of those.
            if os.path.basename(dst) in updater.BUNDLE_FILES:
                witness_seen.setdefault("at_first_replace", updater.read_witness(self.dir))
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", spy):
            updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertIsNotNone(witness_seen["at_first_replace"])
        self.assertFalse(witness_seen["at_first_replace"]["confirmed"])


class WitnessTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-witness-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")

    def test_no_witness_means_nothing_to_roll_back(self):
        self.assertFalse(updater.pending_rollback(self.dir))

    def test_a_fresh_witness_is_given_time(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertFalse(updater.pending_rollback(self.dir, now=1000 + 10))

    def test_an_unconfirmed_witness_expires(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertTrue(updater.pending_rollback(self.dir, now=1000 + updater.GRACE_SEC))

    def test_a_confirmed_witness_never_expires(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertTrue(updater.confirm_update(self.dir))
        self.assertFalse(updater.pending_rollback(self.dir, now=1000 + 10 * updater.GRACE_SEC))

    def test_confirming_twice_is_a_no_op(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertTrue(updater.confirm_update(self.dir))
        self.assertFalse(updater.confirm_update(self.dir))

    def test_an_unreadable_witness_is_treated_as_failed(self):
        # A witness file that exists but does not parse is the likely trace of
        # a power cut mid-write, not the absence of a witness: restoring is
        # the safe reading.
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write("{ not json")
        self.assertTrue(updater.pending_rollback(self.dir))

    def test_a_genuinely_absent_witness_is_not_treated_as_unreadable(self):
        # Pins the two cases apart: no file at all must stay a clean "nothing
        # to do", distinct from a present-but-corrupt file (previous test).
        self.assertFalse(os.path.exists(os.path.join(self.dir, updater.WITNESS_NAME)))
        self.assertFalse(updater.pending_rollback(self.dir))


class RollbackTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-rollback-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def read(self, name):
        with open(os.path.join(self.dir, name), "r") as f:
            return f.read()

    def test_restores_the_previous_files_and_version(self):
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        self.assertTrue(updater.rollback(self.dir))
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertEqual(self.read("VERSION"), "1.0.0\n")
        self.assertIsNone(updater.read_witness(self.dir))

    def test_records_the_failing_version_so_it_is_not_retried(self):
        # Without this the box restores 1.0.0, polls 60s later, finds 1.1.0
        # again, re-downloads it, re-crashes — forever.
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        updater.rollback(self.dir)
        self.assertTrue(updater.has_failed(self.dir, "1.1.0"))
        self.assertFalse(updater.has_failed(self.dir, "1.1.1"))

    def test_rollback_without_a_backup_clears_the_witness(self):
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write('{"from": "1.0.0", "to": "1.1.0", "at": 1, "confirmed": false}')
        self.assertFalse(updater.rollback(self.dir))
        self.assertIsNone(updater.read_witness(self.dir))

    def test_restore_backup_does_not_blame_the_version(self):
        # A deliberate descent ordered by the cloud is not a failure: marking it
        # would make the box refuse the very version it was told to run.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        updater.clear_witness(self.dir)
        self.assertTrue(updater.restore_backup(self.dir))
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertEqual(updater.read_failed(self.dir), [])

    def test_failed_ledger_survives_garbage(self):
        with open(os.path.join(self.dir, updater.FAILED_NAME), "w") as f:
            f.write("not json at all")
        self.assertEqual(updater.read_failed(self.dir), [])
        updater.mark_failed(self.dir, "1.1.0")
        self.assertEqual(updater.read_failed(self.dir), ["1.1.0"])

    def test_rollback_keeps_the_witness_when_the_backup_copy_fails_partway(self):
        # A full or corrupt SD card can make shutil.copy2 fail partway through
        # the restore, leaving some files back to their old version and some
        # not: a NEW mixed state. Clearing the witness here would throw away
        # the only signal that a retry is still needed.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        self.assertIsNotNone(updater.read_witness(self.dir))
        real_copy2 = shutil.copy2
        calls = {"n": 0}

        def flaky_copy2(src, dst):
            calls["n"] += 1
            if calls["n"] > 1:
                raise OSError("card full")
            return real_copy2(src, dst)

        with mock.patch.object(shutil, "copy2", side_effect=flaky_copy2):
            self.assertFalse(updater.rollback(self.dir))
        self.assertIsNotNone(updater.read_witness(self.dir))

    def test_a_swap_interrupted_partway_is_repaired_by_pending_rollback_and_rollback(self):
        # os.replace is used both for the witness's own atomic write and for
        # each bundle file swap. Letting the first two calls through then
        # failing lets the witness land but cuts the file swap short after
        # only one file — exactly the mixed old/new state a power cut mid-swap
        # would produce. The witness was already durable before any bundle
        # file moved, so the recovery path below can find and use it.
        real_replace = os.replace
        calls = {"n": 0}

        def flaky_replace(src, dst):
            calls["n"] += 1
            if calls["n"] > 2:
                raise OSError("power cut")
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", flaky_replace):
            self.assertFalse(
                updater.stage_and_swap(
                    self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0", now=1000
                )
            )
        self.assertTrue(updater.pending_rollback(self.dir, now=1000 + updater.GRACE_SEC))
        self.assertTrue(updater.rollback(self.dir))
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertEqual(self.read("VERSION"), "1.0.0\n")
        self.assertIsNone(updater.read_witness(self.dir))


class SuperviseTest(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import launch

        self.launch = launch
        self.dir = tempfile.mkdtemp(prefix="sr-agent-supervise-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def test_does_nothing_without_a_witness(self):
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")

    def test_leaves_a_fresh_witness_alone(self):
        # The launcher fires on EVERY menu navigation. Without the grace period
        # a navigation ten seconds after the swap would cancel a perfectly
        # healthy update, while it is running.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# new\n")

    def test_restores_after_an_unconfirmed_update_expires(self):
        updater.stage_and_swap(
            self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0", now=time.time() - 4000
        )
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")
        self.assertTrue(updater.has_failed(self.dir, "1.1.0"))

    def test_clears_a_confirmed_witness(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        updater.confirm_update(self.dir)
        self.launch.supervise(self.dir)
        self.assertIsNone(updater.read_witness(self.dir))

    def test_restores_when_the_witness_is_present_but_corrupt(self):
        # pending_rollback deliberately tells "no file" apart from "file there
        # but unparseable" and restores on the second — an interrupted write is
        # the trace of a swap in flight. supervise used to return early on
        # read_witness() is None, which is the SAME value for both cases, so
        # from the only production caller that branch was dead code.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write("{ truncated mid-writ")
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")

    def test_leaves_a_stale_witness_alone_while_an_agent_holds_the_lock(self):
        # confirm_update needs a cloud round-trip. A box whose connectivity
        # drops for ten minutes after a swap would otherwise be rolled back on
        # the next menu navigation, and mark_failed would write a perfectly
        # healthy version into failed.json — which nothing ever clears and no
        # admin command can reach. A held lock proves the swapped version
        # booted; only the cloud is unreachable.
        updater.stage_and_swap(
            self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0", now=time.time() - 4000
        )
        lock = os.path.join(self.dir, updater.LOCK_NAME)
        fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o644)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# new\n")
        self.assertFalse(updater.has_failed(self.dir, "1.1.0"))
        self.assertIsNotNone(updater.read_witness(self.dir))

    def test_a_free_lock_still_rolls_back(self):
        # The other half of the probe: a version that crashes at startup holds
        # nothing, so the lock file can be there and still be free.
        updater.stage_and_swap(
            self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0", now=time.time() - 4000
        )
        with open(os.path.join(self.dir, updater.LOCK_NAME), "w") as f:
            f.write("4242")
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")

    def test_never_raises_even_on_a_nonexistent_directory(self):
        # A broken updater must not be able to stop the agent from starting.
        self.launch.supervise("/nonexistent/sr-agent")

    def test_the_env_name_matches_the_launcher(self):
        # launch.py hard-codes the string so it stays correct even when the
        # updater import fails; this asserts the two never drift.
        self.assertEqual(updater.SUPERVISED_ENV, "SR_AGENT_SUPERVISED")


LOCK_PROBE = '''
import fcntl, os, sys
lock = os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch.lock")
fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o644)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    sys.stdout.write("ACQUIRED")
except OSError:
    sys.stdout.write("BLOCKED")
'''

PARENT = '''
import os, sys, types
_paho = types.ModuleType("paho")
_mqtt = types.ModuleType("paho.mqtt")
_client = types.ModuleType("paho.mqtt.client")
_client.Client = object
_paho.mqtt = _mqtt
_mqtt.client = _client
sys.modules["paho"] = _paho
sys.modules["paho.mqtt"] = _mqtt
sys.modules["paho.mqtt.client"] = _client

sys.path.insert(0, %(agent_dir)r)
import agent
agent.HERE = %(tmp)r
acquired, fd = agent.acquire_lock()
assert acquired, "the parent must own the lock before restarting"
agent.LOCK_FD = fd
%(extra)s
agent.restart()
'''


class RestartLockTest(unittest.TestCase):
    """Le piege que ce test existe pour attraper.

    acquire_lock() rend le descripteur heritable : il survit a execv en tenant
    toujours LOCK_EX. Le nouvel agent ouvre un descripteur NEUF sur le meme
    fichier et flock() arbitre entre descriptions de fichier ouvert, pas entre
    processus — il se refuserait donc le verrou a lui-meme. Sans le close()
    dans restart(), TOUTES les mises a jour echoueraient.
    """

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-execv-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.agent_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(self.dir, "agent.py"), "w") as f:
            f.write(LOCK_PROBE)

    def run_parent(self, extra=""):
        script = os.path.join(self.dir, "parent.py")
        with open(script, "w") as f:
            f.write(PARENT % {"agent_dir": self.agent_dir, "tmp": self.dir, "extra": extra})
        out = subprocess.run(
            [sys.executable, script], capture_output=True, text=True, timeout=30
        )
        return out.stdout.strip()

    def test_the_restarted_agent_gets_the_lock(self):
        self.assertEqual(self.run_parent(), "ACQUIRED")

    def test_without_the_close_the_restarted_agent_would_be_locked_out(self):
        # Negative control: proves the close() in restart() is load-bearing and
        # not decoration. If this ever prints ACQUIRED, the lock is no longer
        # inherited and the comment in restart() has gone stale.
        self.assertEqual(self.run_parent(extra="agent.LOCK_FD = None"), "BLOCKED")


class MaybeUpdateTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-decide-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")
        self.here = mock.patch.object(agent, "HERE", self.dir)
        self.here.start()
        self.addCleanup(self.here.stop)
        self.version = mock.patch.object(agent, "AGENT_VERSION", "1.0.0")
        self.version.start()
        self.addCleanup(self.version.stop)
        self.supervised = mock.patch.dict(
            os.environ, {updater.SUPERVISED_ENV: "1"}
        )
        self.supervised.start()
        self.addCleanup(self.supervised.stop)
        self.restart = mock.patch.object(agent, "restart")
        self.restart_mock = self.restart.start()
        self.addCleanup(self.restart.stop)

    def test_does_nothing_without_a_target(self):
        agent.maybe_update({}, None, None)
        self.restart_mock.assert_not_called()

    def test_does_nothing_when_already_on_target(self):
        agent.maybe_update({}, None, "1.0.0")
        self.restart_mock.assert_not_called()

    def test_refuses_to_update_without_a_supervisor(self):
        # A box on the old custom.sh path has nothing that would repair it if
        # the new version fails to start, so it must never update.
        with mock.patch.dict(os.environ, {updater.SUPERVISED_ENV: ""}):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()

    def test_refuses_a_version_that_already_failed_here(self):
        updater.mark_failed(self.dir, "1.1.0")
        agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()

    def test_defers_while_a_session_is_open(self):
        tracker = types.SimpleNamespace(open={"rom_path": "/x.zip"})
        with mock.patch.object(agent, "download_bundle") as dl:
            agent.maybe_update({}, tracker, "1.1.0")
        dl.assert_not_called()
        self.restart_mock.assert_not_called()

    def test_descends_from_the_local_backup_without_downloading(self):
        updater.stage_and_swap(self.dir, bundle(version="1.1.0\n"), "1.0.0", "1.1.0")
        with mock.patch.object(agent, "AGENT_VERSION", "1.1.0"):
            with mock.patch.object(agent, "download_bundle") as dl:
                agent.maybe_update({}, None, "1.0.0")
        dl.assert_not_called()
        self.restart_mock.assert_called_once()

    def test_logs_when_the_backup_restore_fails(self):
        # Review Minor 1: every other refusal path in maybe_update logs; a
        # failed descent falling through silently would be invisible in
        # agent.log, the only diagnostic on a real console.
        updater.stage_and_swap(self.dir, bundle(version="1.1.0\n"), "1.0.0", "1.1.0")
        with mock.patch.object(agent, "AGENT_VERSION", "1.1.0"):
            with mock.patch.object(updater, "restore_backup", return_value=False):
                with self.assertLogs(agent.log, level="ERROR") as logs:
                    agent.maybe_update({}, None, "1.0.0")
        self.restart_mock.assert_not_called()
        self.assertTrue(any("1.0.0" in line for line in logs.output))

    def test_stays_put_when_the_backup_is_not_the_target(self):
        # The one-step limit made visible rather than silent.
        with mock.patch.object(agent, "AGENT_VERSION", "1.2.0"):
            agent.maybe_update({}, None, "0.9.0")
        self.restart_mock.assert_not_called()

    def test_swaps_and_restarts_on_a_valid_download(self):
        with mock.patch.object(
            agent, "download_bundle", return_value={"version": "1.1.0", "files": bundle()}
        ):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_called_once()
        self.assertEqual(updater.read_version(self.dir), "1.1.0")

    def test_refuses_a_download_that_does_not_compile(self):
        broken = {"version": "1.1.0", "files": bundle(agent_src="def x(:\n")}
        with mock.patch.object(agent, "download_bundle", return_value=broken):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()
        self.assertEqual(updater.read_version(self.dir), "1.0.0")


class UpdaterUnavailableTest(unittest.TestCase):
    """Review Important finding: `import updater` at module load was unguarded.

    A hand-made install predating the bundle system (no updater.py at all), or
    a swap/rollback interrupted partway through copying files (updater.py
    missing or truncated), would take the WHOLE agent down one import later —
    no MQTT, no scrobbling, no snapshots, no command polling — regardless of
    how forgiving launch.py's own guard is upstream. These tests prove the
    opposite: agent.py must still import and run with updater.py absent, and
    the update path must degrade to a safe no-op rather than crash.
    """

    def test_agent_module_still_imports_without_updater_py(self):
        # A real subprocess is required: the running test process has already
        # cached `updater` in sys.modules, so an in-process reimport would
        # never observe the ImportError a genuinely missing file produces.
        d = tempfile.mkdtemp(prefix="sr-agent-no-updater-")
        self.addCleanup(shutil.rmtree, d, True)
        agent_dir = os.path.dirname(os.path.abspath(__file__))
        shutil.copy(os.path.join(agent_dir, "agent.py"), os.path.join(d, "agent.py"))
        # Deliberately no updater.py in d — this is the scenario itself.
        with open(os.path.join(d, "VERSION"), "w") as f:
            f.write("1.2.3\n")
        script = (
            "import sys, types\n"
            "_paho = types.ModuleType('paho')\n"
            "_mqtt = types.ModuleType('paho.mqtt')\n"
            "_client = types.ModuleType('paho.mqtt.client')\n"
            "_client.Client = object\n"
            "_paho.mqtt = _mqtt\n"
            "_mqtt.client = _client\n"
            "sys.modules['paho'] = _paho\n"
            "sys.modules['paho.mqtt'] = _mqtt\n"
            "sys.modules['paho.mqtt.client'] = _client\n"
            "sys.path.insert(0, %r)\n"
            "import agent\n"
            "assert agent.updater is None, 'updater should be None when unimportable'\n"
            "assert agent.AGENT_VERSION == '1.2.3', agent.AGENT_VERSION\n"
            "sys.stdout.write('OK')\n"
        ) % d
        out = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            timeout=30,
            # -c puts '' (i.e. the inherited cwd, resolved dynamically at
            # import time) ahead of nothing at all in sys.path. Without
            # pinning cwd here, running this suite from inside agent/ (which
            # holds the real updater.py) would let the import succeed against
            # that real file, defeating the whole point of the test.
            cwd=d,
        )
        self.assertEqual(out.stdout.strip(), "OK", out.stderr)

    def test_maybe_update_is_a_noop_when_updater_is_unavailable(self):
        with mock.patch.object(agent, "updater", None):
            with mock.patch.object(agent, "restart") as restart_mock:
                agent.maybe_update({}, None, "9.9.9")
        restart_mock.assert_not_called()

    def test_confirm_update_is_skipped_when_updater_is_unavailable(self):
        # Without the `updater is not None` guard on the confirm_update call,
        # this would raise AttributeError inside command_loop's try block and
        # never reach the maybe_update call below it on the same iteration.
        cfg = {
            "cloud_url": "https://example.test/api/agent/ingest",
            "token": "tok",
            "http_timeout_sec": 1,
            "command_poll_interval_sec": 60,
        }
        rec = test_agent._SleepRecorder(1)
        with mock.patch.object(agent, "updater", None), mock.patch.object(
            agent, "maybe_update"
        ) as maybe_update_mock, mock.patch.object(
            agent.time, "sleep", rec
        ), mock.patch.object(
            agent.urllib.request, "urlopen", test_agent._JsonUrlopen({"commands": []})
        ):
            try:
                agent.command_loop(cfg)
            except test_agent._StopLoop:
                pass
        maybe_update_mock.assert_called_once()


class RestartExecvFailureTest(unittest.TestCase):
    """Review Minor 2: restart() closes LOCK_FD unconditionally, then calls
    execv outside any try/except. If execv itself raised, the exception would
    propagate into command_loop's broad `except Exception`, the thread would
    survive, and the process would keep running with the lock released — a
    second agent could then start alongside this one. Dying is the only safe
    outcome; the launcher restarts it cleanly on the next menu navigation."""

    def test_execv_failure_exits_rather_than_run_unlocked(self):
        with mock.patch.object(agent.os, "execv", side_effect=OSError("boom")):
            with mock.patch.object(agent.os, "_exit") as exit_mock:
                with self.assertLogs(agent.log, level="ERROR"):
                    agent.restart()
        exit_mock.assert_called_once_with(1)


class AgentIsRunningTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-lockprobe-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_no_lock_file_means_no_agent(self):
        self.assertFalse(updater.agent_is_running(self.dir))

    def test_probing_does_not_create_the_lock_file(self):
        # A probe that created the file would leave a stray artefact in the
        # share on every menu navigation of a box that never ran an agent.
        updater.agent_is_running(self.dir)
        self.assertFalse(os.path.exists(os.path.join(self.dir, updater.LOCK_NAME)))

    def test_a_free_lock_reads_as_not_running(self):
        with open(os.path.join(self.dir, updater.LOCK_NAME), "w") as f:
            f.write("1")
        self.assertFalse(updater.agent_is_running(self.dir))

    def test_a_held_lock_reads_as_running(self):
        # flock arbitrates between OPEN FILE DESCRIPTIONS, not processes, so a
        # second descriptor opened here is refused exactly as another process
        # would be.
        fd = os.open(os.path.join(self.dir, updater.LOCK_NAME), os.O_CREAT | os.O_RDWR, 0o644)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertTrue(updater.agent_is_running(self.dir))

    def test_the_probe_releases_the_lock_it_took(self):
        # The launcher exec's agent.py microseconds later; a probe that kept
        # the lock would make every start fail with "another agent holds it".
        with open(os.path.join(self.dir, updater.LOCK_NAME), "w") as f:
            f.write("1")
        updater.agent_is_running(self.dir)
        fd = os.open(os.path.join(self.dir, updater.LOCK_NAME), os.O_RDWR)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_the_lock_name_matches_the_one_agent_py_uses(self):
        # agent.py hard-codes a fallback so it can still take its lock when
        # updater.py is missing or corrupt (same reason as
        # _read_version_fallback). This asserts the two never drift — a
        # launcher probing the wrong file would believe no agent is running
        # and restore over a healthy one.
        self.assertEqual(agent._LOCK_NAME_FALLBACK, updater.LOCK_NAME)
        self.assertEqual(os.path.basename(agent.lock_path()), updater.LOCK_NAME)


def _drive_one_successful_poll(agent_dir, agent_version):
    """Fait tourner command_loop sur exactement une interrogation reussie."""
    cfg = {
        "cloud_url": "https://example.test/api/agent/ingest",
        "token": "tok",
        "http_timeout_sec": 1,
        "command_poll_interval_sec": 60,
    }
    rec = test_agent._SleepRecorder(1)
    with mock.patch.object(agent, "HERE", agent_dir), mock.patch.object(
        agent, "AGENT_VERSION", agent_version
    ), mock.patch.object(agent, "maybe_update"), mock.patch.object(
        agent.time, "sleep", rec
    ), mock.patch.object(
        agent.urllib.request, "urlopen", test_agent._JsonUrlopen({"commands": []})
    ):
        try:
            agent.command_loop(cfg)
        except test_agent._StopLoop:
            pass


class ConfirmOnlyOwnVersionTest(unittest.TestCase):
    """command_loop confirmait le temoin a CHAQUE interrogation reussie, sans
    verifier qu'il decrit la version de ce processus-ci. Deux sequences
    atteignent cette ligne avec un temoin qui parle d'autre chose, et le
    confirmer detruit le seul signal qui reclame une reparation."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-confirm-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def test_a_partial_swap_is_not_confirmed_by_the_old_process(self):
        # stage_and_swap writes the witness, then dies inside the os.replace
        # loop. It returns False, maybe_update logs and returns WITHOUT
        # restarting — so this very process, still on 1.0.0, keeps polling.
        real_replace = os.replace
        calls = {"n": 0}

        def flaky_replace(src, dst):
            calls["n"] += 1
            if calls["n"] > 2:
                raise OSError("EIO")
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", flaky_replace):
            self.assertFalse(
                updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
            )
        _drive_one_successful_poll(self.dir, "1.0.0")
        witness = updater.read_witness(self.dir)
        self.assertIsNotNone(witness)
        self.assertFalse(witness.get("confirmed"))

    def test_a_kept_witness_survives_a_poll_after_an_interrupted_rollback(self):
        # rollback KEEPS the witness when _copy_from_backup fails partway, so
        # the next boot retries. launch.py exec's the agent anyway, and its
        # first successful poll used to confirm that witness — destroying the
        # retry signal.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        real_copy2 = shutil.copy2
        calls = {"n": 0}

        def flaky_copy2(src, dst):
            calls["n"] += 1
            if calls["n"] > 1:
                raise OSError("card full")
            return real_copy2(src, dst)

        with mock.patch.object(shutil, "copy2", side_effect=flaky_copy2):
            self.assertFalse(updater.rollback(self.dir))
        self.assertIsNotNone(updater.read_witness(self.dir))
        _drive_one_successful_poll(self.dir, "1.0.0")
        witness = updater.read_witness(self.dir)
        self.assertIsNotNone(witness)
        self.assertFalse(witness.get("confirmed"))

    def test_the_swapped_version_still_confirms_its_own_witness(self):
        # The guard must not break the mechanism it protects: after a clean
        # swap-and-execv, AGENT_VERSION equals the witness's `to`.
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        _drive_one_successful_poll(self.dir, "1.1.0")
        self.assertTrue(updater.read_witness(self.dir).get("confirmed"))


if __name__ == "__main__":
    unittest.main()
