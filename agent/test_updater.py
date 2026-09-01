#!/usr/bin/env python3
"""Tests du mécanisme de mise à jour automatique.

Stdlib unittest only. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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

    def test_writes_the_witness_before_swapping(self):
        # os.replace is atomic per file, not across the set: a power cut mid-swap
        # leaves a mix of both versions. With the witness already on disk,
        # launch.py repairs it; written after, nothing would know.
        witness_seen = {}
        real_replace = os.replace

        def spy(src, dst):
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
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write("{ not json")
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


if __name__ == "__main__":
    unittest.main()
