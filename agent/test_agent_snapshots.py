#!/usr/bin/env python3
"""Tests for the snapshot loop's disable switch.

Stdlib unittest only: the agent is deliberately dependency-free. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import sys
import types
import unittest
from unittest import mock

# agent.py imports paho at module level. It ships with RecalboxOS but is not needed
# to exercise the config logic, so stub it to keep the import cheap.
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

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import agent  # noqa: E402


class SnapshotLoopDisabled(unittest.TestCase):
	def test_returns_immediately_when_interval_is_zero(self):
		"""A zero interval must not enter the infinite loop, and must push nothing."""
		cfg = {"cloud_url": "https://x/api/agent/ingest", "snapshot_interval_sec": 0}
		# If the guard is missing this blocks forever inside `while True`.
		with mock.patch.object(agent, "http_post_json") as post:
			agent.snapshot_loop(cfg)
		post.assert_not_called()

	def test_returns_immediately_when_interval_is_negative(self):
		cfg = {"cloud_url": "https://x/api/agent/ingest", "snapshot_interval_sec": -1}
		with mock.patch.object(agent, "http_post_json") as post:
			agent.snapshot_loop(cfg)
		post.assert_not_called()

	def test_default_config_disables_snapshots(self):
		"""Serverless no longer reads snapshots, so the shipped default is off."""
		self.assertEqual(agent.load_config()["snapshot_interval_sec"], 0)


if __name__ == "__main__":
	unittest.main()
