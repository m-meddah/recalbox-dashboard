import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'scan_roms.py')


def run_scan(*targets):
    args = [sys.executable, SCRIPT]
    for t in targets:
        args += ['--target', t]
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise AssertionError(f'scan failed rc={out.returncode}: {out.stderr}')
    return json.loads(out.stdout)


def chd_header(version, sha1=b'\x11' * 20, rawsha1=b'\x22' * 20):
    """En-tête CHD de 124 octets, aux offsets réels de libchdr."""
    h = bytearray(124)
    h[0:8] = b'MComprHD'
    struct.pack_into('>I', h, 12, version)
    if version == 5:
        h[84:104] = sha1
        h[64:84] = rawsha1
    elif version == 4:
        h[48:68] = sha1
        h[88:108] = rawsha1
    elif version == 3:
        h[80:100] = sha1
    return bytes(h)


def rvz_bytes(game_code=b'GW7P', disc=0, ver=1):
    """RVZ minimal : wia_disc_t à 0x48, dont dhead porte l'en-tête disque."""
    buf = bytearray(0x48 + 0x80)
    buf[0:4] = b'RVZ\x01'
    dhead = bytearray(0x80)
    dhead[0:4] = game_code
    dhead[6] = disc
    dhead[7] = ver
    buf[0x48:0x48 + 0x80] = dhead
    return bytes(buf)


class ScanRomsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.roms = os.path.join(self.root, 'roms', 'snes')
        os.makedirs(self.roms)

    def tearDown(self):
        self.tmp.cleanup()

    def target(self):
        return f'{self.root}|snes|{self.roms}'

    def write(self, name, data):
        p = os.path.join(self.roms, name)
        with open(p, 'wb') as f:
            f.write(data)
        return p

    def entries(self):
        return run_scan(self.target())['entries']

    # --- stratégie 1 : zip ---

    def test_reads_zip_entry_crc_without_decompressing(self):
        payload = b'ROMDATA' * 100
        p = os.path.join(self.roms, 'Game.zip')
        with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('Game (Europe).sfc', payload)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'zip-entry')
        self.assertEqual(e['innerName'], 'Game (Europe).sfc')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
        self.assertEqual(e['system'], 'snes')
        self.assertEqual(e['mount'], self.root)

    def test_emits_one_entry_per_file_in_a_multi_entry_zip(self):
        p = os.path.join(self.roms, 'Set.zip')
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('A.sfc', b'aaa')
            z.writestr('B.sfc', b'bbb')
        names = sorted(e['innerName'] for e in self.entries())
        self.assertEqual(names, ['A.sfc', 'B.sfc'])

    # --- stratégie 2 : chd ---

    def test_reads_chd_v5_header_hashes(self):
        self.write('Disc.chd', chd_header(5) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'chd')
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertEqual(e['rawSha1'], '22' * 20)

    def test_reads_chd_v4_header_hashes(self):
        self.write('Disc.chd', chd_header(4) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertEqual(e['rawSha1'], '22' * 20)

    def test_chd_v3_has_no_rawsha1(self):
        self.write('Disc.chd', chd_header(3) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertNotIn('rawSha1', e)

    def test_a_file_that_only_pretends_to_be_a_chd_is_not_one(self):
        self.write('Fake.chd', b'NOTACHD!' + b'\x00' * 200)
        (e,) = self.entries()
        self.assertNotIn('sha1', e)
        self.assertNotIn('rawSha1', e)

    # --- stratégie 3 : rvz / iso ---

    def test_reads_the_game_code_from_an_rvz_header(self):
        self.write('Game.rvz', rvz_bytes(b'GW7P', disc=0, ver=1))
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertEqual(e['serial'], 'GW7P')
        self.assertEqual(e['discNumber'], 0)
        self.assertEqual(e['discVersion'], 1)

    def test_reads_the_game_code_from_a_bare_iso(self):
        dhead = bytearray(0x80)
        dhead[0:4] = b'GALE'
        dhead[6] = 1
        self.write('Game.iso', bytes(dhead) + b'\x00' * 4096)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertEqual(e['serial'], 'GALE')
        self.assertEqual(e['discNumber'], 1)

    # Un code non alphanumérique ferait rejeter tout le manifeste par le schéma.
    def test_drops_an_unusable_game_code_rather_than_emitting_it(self):
        self.write('Bad.rvz', rvz_bytes(b'\x00\x01\x02\x03'))
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertNotIn('serial', e)
        self.assertNotIn('discNumber', e)

    # --- stratégie 5 : fichier nu ---

    def test_hashes_a_bare_rom_in_full(self):
        payload = b'\x01\x02\x03' * 5000
        self.write('Game.sfc', payload)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'raw')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
        self.assertEqual(e['size'], len(payload))

    # --- filtrage ---

    def test_ignores_artwork_video_and_document_files(self):
        for name in ('cover.png', 'video.mp4', 'manual.pdf', 'notes.txt', 'list.m3u'):
            self.write(name, b'x' * 100)
        self.write('Game.sfc', b'rom')
        kinds = [os.path.basename(e['path']) for e in self.entries()]
        self.assertEqual(kinds, ['Game.sfc'])

    def test_ignores_hidden_directories_and_empty_files(self):
        os.makedirs(os.path.join(self.roms, '.hidden'))
        with open(os.path.join(self.roms, '.hidden', 'Game.sfc'), 'wb') as f:
            f.write(b'rom')
        self.write('Empty.sfc', b'')
        self.assertEqual(self.entries(), [])

    # --- robustesse ---

    def test_a_corrupt_archive_does_not_abort_the_scan(self):
        self.write('Broken.zip', b'this is not a zip at all')
        self.write('Good.sfc', b'rom')
        names = [os.path.basename(e['path']) for e in self.entries()]
        self.assertIn('Good.sfc', names)

    def test_reports_counters(self):
        self.write('Game.sfc', b'rom')
        self.write('Broken.zip', b'nope')
        stats = run_scan(self.target())['stats']
        self.assertGreaterEqual(stats['scanned'], 1)
        self.assertIn('errors', stats)

    def test_emits_nothing_for_a_missing_directory(self):
        result = run_scan(f'{self.root}|snes|{self.root}/does-not-exist')
        self.assertEqual(result['entries'], [])

    # --- stratégie 4 : 7z ---

    def sevenzip(self, name, build):
        """Construit une archive .7z dans le dossier scanné. Renvoie son chemin."""
        staging = tempfile.mkdtemp()
        build(staging)
        dest = os.path.join(self.roms, name)
        rc = subprocess.run(
            ['7z', 'a', '-bso0', '-bsp0', dest, '.'],
            cwd=staging, capture_output=True,
        ).returncode
        self.assertEqual(rc, 0, '7z failed to build the fixture archive')
        return dest

    def test_reads_the_entry_crc_of_a_bare_rom_in_a_7z(self):
        payload = b'ROMDATA' * 321

        def build(d):
            with open(os.path.join(d, 'Game (USA).sfc'), 'wb') as f:
                f.write(payload)

        self.sevenzip('Game.7z', build)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'sevenzip-entry')
        self.assertEqual(e['innerName'], 'Game (USA).sfc')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))

    # Le piège mesuré sur la collection réelle : une minorité d'archives
    # contiennent des .zip, pas des roms. Le CRC listé par 7z est alors celui du
    # zip intermédiaire, que le catalogue ne reconnaîtra jamais.
    def test_descends_into_a_zip_nested_inside_a_7z(self):
        payload = b'NESTED' * 500

        def build(d):
            with zipfile.ZipFile(os.path.join(d, 'Game (Japan).zip'), 'w') as z:
                z.writestr('Game (Japan).sfc', payload)

        self.sevenzip('Set.7z', build)
        (e,) = self.entries()
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
        self.assertNotEqual(e['crc32'], '%08x' % zlib.crc32(b''))
        self.assertEqual(e['innerName'], 'Game (Japan).sfc')

    def test_a_multi_entry_7z_yields_one_entry_per_rom(self):
        def build(d):
            for n in ('A.sfc', 'B.sfc', 'C.sfc'):
                with open(os.path.join(d, n), 'wb') as f:
                    f.write(n.encode() * 50)

        self.sevenzip('Set.7z', build)
        self.assertEqual(sorted(e['innerName'] for e in self.entries()), ['A.sfc', 'B.sfc', 'C.sfc'])

    # Sur RecalboxOS il n'y a que 7zr, jamais 7z/7za. Si même 7zr est absent
    # (PATH neutralisé), les .7z doivent basculer sur la stratégie 5 sans
    # faire échouer le scan.
    def test_falls_back_to_raw_hashing_when_no_7z_binary_is_on_path(self):
        payload = b'not a real 7z archive, just bytes to hash whole'
        self.write('Something.7z', payload)

        args = [sys.executable, SCRIPT, '--target', self.target()]
        env = dict(os.environ)
        env['PATH'] = tempfile.mkdtemp()  # empty dir: no 7z, 7za, or 7zr to find
        out = subprocess.run(args, capture_output=True, text=True, timeout=120, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        result = json.loads(out.stdout)
        (e,) = result['entries']
        self.assertEqual(e['kind'], 'raw')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
