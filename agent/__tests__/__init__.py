"""Marks this directory as a package so `unittest discover` recurses into it.

Without this file `python3 -m unittest discover -s agent` walks only the top level
of `agent/` and silently reports 23 tests instead of 105 — a partial run that looks
identical to a green one. Discovery does not descend into plain directories.

Deliberately empty otherwise: each test module puts `agent/` on `sys.path` itself
and imports `agent` / `scan_roms` directly.
"""
