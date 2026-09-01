#!/usr/bin/env python3
"""Tests du mécanisme de mise à jour automatique.

Stdlib unittest only. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import os
import sys
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
