import os
import sys
import tempfile
import time
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.join(HERE, '..')

# agent.py imports paho at module level. It ships with RecalboxOS but is not
# needed here, so stub it to keep the import cheap (same trick as test_agent.py).
if 'paho' not in sys.modules:
    _paho = types.ModuleType('paho')
    _mqtt = types.ModuleType('paho.mqtt')
    _client = types.ModuleType('paho.mqtt.client')
    _client.Client = object
    _paho.mqtt = _mqtt
    _mqtt.client = _client
    sys.modules['paho'] = _paho
    sys.modules['paho.mqtt'] = _mqtt
    sys.modules['paho.mqtt.client'] = _client

sys.path.insert(0, AGENT_DIR)
import agent  # noqa: E402  (le chemin doit être posé d'abord)


def make_tree(root, layout):
    """layout: {relative dir: [system names]}. Crée les dossiers de roms."""
    for rel, systems in layout.items():
        for system in systems:
            os.makedirs(os.path.join(root, rel, system), exist_ok=True)


class DiscoverTargetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self._share = agent.SHARE_ROOT
        agent.SHARE_ROOT = self.root

    def tearDown(self):
        agent.SHARE_ROOT = self._share
        self.tmp.cleanup()

    # Le défaut que le spec relève : ne scanner que externals/usb* rate la carte SD.
    def test_finds_systems_on_share_and_externals(self):
        make_tree(self.root, {
            'roms': ['snes'],
            'externals/usb0/recalbox/roms': ['psx', 'nes'],
        })
        targets = agent.discover_scan_targets()
        systems = sorted(t.split('|')[1] for t in targets)
        self.assertEqual(systems, ['nes', 'psx', 'snes'])

    def test_target_carries_mount_system_and_path(self):
        make_tree(self.root, {'roms': ['snes']})
        mount, system, roms_path = agent.discover_scan_targets()[0].split('|')
        self.assertEqual(mount, self.root)
        self.assertEqual(system, 'snes')
        self.assertEqual(roms_path, os.path.join(self.root, 'roms', 'snes'))

    def test_ignores_a_share_with_no_roms_directory(self):
        os.makedirs(os.path.join(self.root, 'externals', 'usb9', 'system'), exist_ok=True)
        make_tree(self.root, {'roms': ['snes']})
        targets = agent.discover_scan_targets()
        self.assertEqual(len(targets), 1)

    def test_restricts_to_the_requested_systems(self):
        make_tree(self.root, {'roms': ['snes', 'psx', 'nes']})
        targets = agent.discover_scan_targets(['psx'])
        self.assertEqual([t.split('|')[1] for t in targets], ['psx'])

    def test_skips_files_and_keeps_directories(self):
        make_tree(self.root, {'roms': ['snes']})
        with open(os.path.join(self.root, 'roms', 'notes.txt'), 'w') as f:
            f.write('x')
        targets = agent.discover_scan_targets()
        self.assertEqual([t.split('|')[1] for t in targets], ['snes'])

    def test_survives_an_unreadable_share(self):
        agent.SHARE_ROOT = os.path.join(self.root, 'nope')
        self.assertEqual(agent.discover_scan_targets(), [])


class ScanJobTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self._share = agent.SHARE_ROOT
        agent.SHARE_ROOT = self.root
        make_tree(self.root, {'roms': ['snes', 'nes']})

        self.posted = []
        self._post = agent.http_post_json
        agent.http_post_json = lambda url, payload, token, timeout: (
            self.posted.append(payload) or True
        )
        agent._scan_running = False

    def tearDown(self):
        agent.SHARE_ROOT = self._share
        agent.http_post_json = self._post
        agent._scan_running = False
        self.tmp.cleanup()

    def cfg(self):
        return {'cloud_url': 'https://cloud/api/agent/ingest', 'token': 't', 'http_timeout_sec': 5}

    def test_posts_one_request_per_system(self):
        agent.run_scan_job(self.cfg(), 'scan-1', None)
        systems = [p['system'] for p in self.posted]
        self.assertEqual(sorted(systems), ['nes', 'snes'])

    def test_marks_only_the_last_request_final(self):
        agent.run_scan_job(self.cfg(), 'scan-1', None)
        finals = [p.get('final') for p in self.posted]
        self.assertEqual(finals.count(True), 1)
        self.assertTrue(self.posted[-1]['final'])

    def test_reports_the_scan_id_it_was_given(self):
        agent.run_scan_job(self.cfg(), 'scan-42', None)
        self.assertTrue(all(p['scan_id'] == 'scan-42' for p in self.posted))

    def test_announces_the_system_count_it_will_send(self):
        agent.run_scan_job(self.cfg(), 'scan-1', None)
        self.assertEqual(self.posted[0]['systems_total'], 2)
        self.assertEqual([p['systems_done'] for p in self.posted], [1, 2])

    def test_splits_a_large_system_into_chunks(self):
        original = agent.SCAN_CHUNK_ENTRIES
        agent.SCAN_CHUNK_ENTRIES = 1
        try:
            # Deux fichiers dans un seul système : deux chunks, un seul dernier.
            import zipfile
            import zlib
            roms = os.path.join(self.root, 'roms', 'snes')
            for name in ('a', 'b'):
                with zipfile.ZipFile(os.path.join(roms, name + '.zip'), 'w') as z:
                    z.writestr(name + '.sfc', b'payload-' + name.encode())
            agent.run_scan_job(self.cfg(), 'scan-1', ['snes'])
            snes = [p for p in self.posted if p['system'] == 'snes']
            self.assertGreater(len(snes), 1)
            self.assertEqual([p['chunk_index'] for p in snes], list(range(len(snes))))
            self.assertEqual([p['last_chunk'] for p in snes].count(True), 1)
            self.assertTrue(snes[-1]['last_chunk'])
            del zlib
        finally:
            agent.SCAN_CHUNK_ENTRIES = original

    # Un système vide doit quand même être annoncé, sinon le cloud garde
    # éternellement l'ancien audit d'un dossier désormais vide.
    def test_still_posts_a_system_with_no_file(self):
        agent.run_scan_job(self.cfg(), 'scan-1', ['snes'])
        self.assertEqual(len(self.posted), 1)
        self.assertEqual(self.posted[0]['entries'], [])

    # Un agent mis à jour sans scan_roms.py doit le dire, pas planter.
    def test_missing_scan_module_reports_a_clean_failure(self):
        original = agent.load_scan_module
        agent.load_scan_module = lambda: None
        try:
            ok, message = agent.exec_scan(self.cfg(), {'scanId': 'scan-1'})
            self.assertFalse(ok)
            self.assertIn('scan_roms', message)
        finally:
            agent.load_scan_module = original

    def test_exec_scan_returns_immediately(self):
        started = time.time()
        ok, message = agent.exec_scan(self.cfg(), {'scanId': 'scan-1'})
        self.assertTrue(ok)
        self.assertLess(time.time() - started, 1.0)
        agent.wait_for_scan(timeout=10)

    # Deux scans simultanés doubleraient la charge disque de la box.
    def test_a_second_scan_is_refused_while_one_runs(self):
        agent._scan_running = True
        ok, message = agent.exec_scan(self.cfg(), {'scanId': 'scan-2'})
        self.assertFalse(ok)
        self.assertIn('already', message.lower())

    def test_scan_without_a_scan_id_is_refused(self):
        ok, _ = agent.exec_scan(self.cfg(), {})
        self.assertFalse(ok)

    def test_execute_command_routes_the_scan_type(self):
        ok, _ = agent.execute_command({'type': 'scan', 'payload': {'scanId': 'scan-1'}}, self.cfg())
        self.assertTrue(ok)
        agent.wait_for_scan(timeout=10)


if __name__ == '__main__':
    unittest.main()


class NetworkShareTest(unittest.TestCase):
    """Recalbox monte un NAS sous externals/network0..network3. L'agent énumère
    le dossier, donc il les voit ; le chemin SSH doit en faire autant."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self._share = agent.SHARE_ROOT
        agent.SHARE_ROOT = self.root

    def tearDown(self):
        agent.SHARE_ROOT = self._share
        self.tmp.cleanup()

    def test_finds_a_nas_mounted_as_network0(self):
        make_tree(self.root, {'externals/network0/recalbox/roms': ['snes', 'psx']})
        targets = agent.discover_scan_targets()
        mounts = {t.split('|')[0] for t in targets}
        self.assertEqual(mounts, {os.path.join(self.root, 'externals', 'network0')})
        self.assertEqual(sorted(t.split('|')[1] for t in targets), ['psx', 'snes'])

    def test_builds_the_roms_root_of_a_nas_like_any_other_external(self):
        make_tree(self.root, {'externals/network3/recalbox/roms': ['snes']})
        _, _, roms_path = agent.discover_scan_targets()[0].split('|')
        self.assertEqual(
            roms_path,
            os.path.join(self.root, 'externals', 'network3', 'recalbox', 'roms', 'snes'),
        )

    def test_covers_usb2_and_usb3_as_well(self):
        make_tree(self.root, {
            'externals/usb2/recalbox/roms': ['snes'],
            'externals/usb3/recalbox/roms': ['nes'],
        })
        mounts = {t.split('|')[0] for t in agent.discover_scan_targets()}
        self.assertEqual(len(mounts), 2)

    def test_mixes_a_nas_a_usb_disk_and_the_sd_card(self):
        make_tree(self.root, {
            'roms': ['snes'],
            'externals/usb0/recalbox/roms': ['psx'],
            'externals/network0/recalbox/roms': ['nes'],
        })
        mounts = {t.split('|')[0] for t in agent.discover_scan_targets()}
        self.assertEqual(len(mounts), 3)


class FindGamelistsTest(unittest.TestCase):
    """find_gamelists globait externals/usb* : les gamelists d'un NAS n'étaient
    jamais poussées, donc la collection restait vide sans le moindre message."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self._glob = agent.glob.glob
        # find_gamelists code le préfixe /recalbox/share en dur ; on redirige le
        # glob vers l'arborescence temporaire plutôt que de toucher au code.
        agent.glob.glob = lambda pat: self._glob(
            pat.replace('/recalbox/share', self.root, 1)
        )

    def tearDown(self):
        agent.glob.glob = self._glob
        self.tmp.cleanup()

    def make_gamelist(self, support, system):
        d = os.path.join(self.root, 'externals', support, 'recalbox', 'roms', system)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'gamelist.xml'), 'w') as f:
            f.write('<gameList/>')

    def supports_found(self):
        return sorted({p.split('/externals/')[1].split('/')[0] for p in agent.find_gamelists()})

    def test_finds_a_gamelist_on_a_network_share(self):
        self.make_gamelist('network0', 'snes')
        self.assertEqual(self.supports_found(), ['network0'])

    def test_finds_every_support_side_by_side(self):
        for s in ('usb0', 'usb3', 'network0', 'network3'):
            self.make_gamelist(s, 'snes')
        self.assertEqual(self.supports_found(), ['network0', 'network3', 'usb0', 'usb3'])

    def test_still_skips_ports_and_hidden_systems(self):
        self.make_gamelist('network0', 'ports')
        self.make_gamelist('network0', '.hidden')
        self.make_gamelist('network0', 'snes')
        systems = sorted(os.path.basename(os.path.dirname(p)) for p in agent.find_gamelists())
        self.assertEqual(systems, ['snes'])

    def test_finds_a_gamelist_on_the_sd_card(self):
        d = os.path.join(self.root, 'roms', 'zx81')
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'gamelist.xml'), 'w') as f:
            f.write('<gameList/>')
        self.assertEqual(
            [os.path.basename(os.path.dirname(p)) for p in agent.find_gamelists()], ['zx81']
        )

    def test_finds_the_sd_card_and_the_externals_together(self):
        d = os.path.join(self.root, 'roms', 'zx81')
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'gamelist.xml'), 'w') as f:
            f.write('<gameList/>')
        self.make_gamelist('network0', 'snes')
        self.make_gamelist('usb0', 'psx')
        systems = sorted(os.path.basename(os.path.dirname(p)) for p in agent.find_gamelists())
        self.assertEqual(systems, ['psx', 'snes', 'zx81'])
