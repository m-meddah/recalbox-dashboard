import base64
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
AGENT_DIR = os.path.join(HERE, '..')
SCRIPT = os.path.join(AGENT_DIR, 'scan_roms.py')

sys.path.insert(0, AGENT_DIR)
import scan_roms  # noqa: E402  (le chemin doit être posé d'abord)


def run_scan_raw(*targets, **kwargs):
    """Lance le script et rend le CompletedProcess brut, pour les cas où
    stderr et le code retour font partie de ce qu'on vérifie."""
    args = [sys.executable, SCRIPT]
    for t in targets:
        args += ['--target', t]
    return subprocess.run(
        args, capture_output=True, text=True, timeout=kwargs.get('timeout', 120)
    )


def run_scan(*targets, **kwargs):
    out = run_scan_raw(*targets, **kwargs)
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


GAMECUBE_DISC_MAGIC = b'\xc2\x33\x9f\x3d'  # dhead + 0x1C, big-endian
WII_DISC_MAGIC = b'\x5d\x1c\x9e\xa3'  # dhead + 0x18, big-endian

DHEAD_OFFSET = 0x58  # 0x48 (wia_disc_t) + 0x10 (quatre u32 qui précèdent dhead)


def disc_header(game_code=b'GW7P', disc=0, ver=1, magic='gamecube'):
    """Les 128 octets de `dhead`, tels qu'ils sont sur un vrai disque."""
    dhead = bytearray(0x80)
    dhead[0:4] = game_code
    dhead[6] = disc
    dhead[7] = ver
    if magic == 'gamecube':
        dhead[0x1C:0x20] = GAMECUBE_DISC_MAGIC
    elif magic == 'wii':
        dhead[0x18:0x1C] = WII_DISC_MAGIC
    return bytes(dhead)


def rvz_bytes(game_code=b'GW7P', disc=0, ver=1, magic='gamecube',
              file_magic=b'RVZ\x01', dhead_offset=DHEAD_OFFSET):
    """RVZ minimal. `wia_disc_t` est bien à 0x48, mais elle **ne commence pas
    par `dhead`** : quatre u32 la précèdent (disc_type, compression,
    compr_level, chunk_size), donc dhead est à **0x58**.

    `dhead_offset` existe pour fabriquer la version fautive (0x48) et prouver
    qu'une lecture à cet offset ne produit plus d'identifiant. Le fichier est
    toujours assez long pour qu'une lecture à 0x58 aboutisse : sinon l'entrée
    serait omise pour en-tête tronqué, et le test ne prouverait rien."""
    buf = bytearray(max(dhead_offset, DHEAD_OFFSET) + 0x80)
    buf[0:4] = file_magic
    buf[dhead_offset:dhead_offset + 0x80] = disc_header(game_code, disc, ver, magic)
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

    # La fixture porte la magie GameCube 0xC2339F3D à dhead+0x1C : un vrai ISO
    # GameCube la porte toujours, donc la version qui en était dépourvue
    # décrivait un fichier ne pouvant pas exister. Les assertions sur le
    # serial et le discNumber sont inchangées.
    def test_reads_the_game_code_from_a_bare_iso(self):
        self.write('Game.iso', disc_header(b'GALE', disc=1) + b'\x00' * 4096)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertEqual(e['serial'], 'GALE')
        self.assertEqual(e['discNumber'], 1)

    # Le vrai gain du recoupement : `.iso` couvre aussi PC Engine CD, Dreamcast
    # et Saturn, dont les quatre premiers octets peuvent être alphanumériques
    # par hasard. Un serial inventé marquerait un jeu comme possédé alors qu'il
    # ne l'est pas — le manquant disparaîtrait de l'audit sans que ça se voie.
    def test_a_bare_iso_without_a_disc_magic_yields_no_identifier(self):
        self.write('Saturn.iso', b'SEGA' + b'\x00' * 4096)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertNotIn('serial', e)
        self.assertNotIn('discNumber', e)
        self.assertNotIn('discVersion', e)

    def test_reads_a_wii_disc_header(self):
        self.write('Wii.rvz', rvz_bytes(b'RSBE', disc=0, ver=2, magic='wii'))
        (e,) = self.entries()
        self.assertEqual(e['serial'], 'RSBE')
        self.assertEqual(e['discVersion'], 2)

    # LE filet qui manquait : si la lecture repartait à 0x48, ce fichier
    # rendrait « GW7P ». Le vrai dhead étant à 0x58, il n'y a à cet endroit
    # que du remplissage — ni code jeu exploitable, ni magie de disque.
    def test_a_dhead_placed_at_the_old_0x48_offset_yields_no_identifier(self):
        self.write('Wrong.rvz', rvz_bytes(b'GW7P', dhead_offset=0x48))
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertNotIn('serial', e)
        self.assertNotIn('discNumber', e)
        self.assertNotIn('discVersion', e)

    # Recoupement : un dhead sans magie GameCube ni Wii n'est pas un dhead.
    def test_ignores_an_rvz_whose_disc_magic_is_absent(self):
        self.write('NoMagic.rvz', rvz_bytes(b'GW7P', magic=None))
        (e,) = self.entries()
        self.assertNotIn('serial', e)

    def test_ignores_a_file_whose_container_magic_is_not_wia_or_rvz(self):
        self.write('NotRvz.rvz', rvz_bytes(b'GW7P', file_magic=b'JUNK'))
        (e,) = self.entries()
        self.assertNotIn('serial', e)

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

    # Le schéma exige un entier positif ou nul ; les disques USB en exFAT
    # portent des horodatages antérieurs à 1970. Une seule occurrence ferait
    # rejeter tout le manifeste.
    def test_clamps_a_pre_1970_mtime_to_zero(self):
        p = self.write('Old.sfc', b'rom')
        os.utime(p, (-86400 * 365, -86400 * 365))
        (e,) = self.entries()
        self.assertEqual(e['mtime'], 0)

    # Un chemin indirect produisait zéro entrée et un compteur d'erreurs
    # énorme : chaque fichier trouvé portait un segment "..", que le garde-fou
    # de sécurité rejette.
    def test_normalises_a_roms_path_containing_a_parent_segment(self):
        self.write('Game.sfc', b'rom')
        indirect = os.path.join(self.roms, '..', 'snes')
        result = run_scan(f'{self.root}|snes|{indirect}')
        (e,) = result['entries']
        self.assertEqual(os.path.basename(e['path']), 'Game.sfc')
        self.assertEqual(result['stats']['errors'], 0)

    # `systemId` côté Zod : 64 caractères max, aucun séparateur de chemin.
    # Mieux vaut écarter la cible ici que faire rejeter tout le manifeste.
    def test_rejects_a_target_whose_system_name_is_too_long(self):
        self.write('Game.sfc', b'rom')
        out = run_scan_raw(f'{self.root}|{"x" * 65}|{self.roms}')
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout)['entries'], [])
        self.assertIn('system name rejected', out.stderr)

    def test_rejects_a_target_whose_system_name_holds_a_path_separator(self):
        self.write('Game.sfc', b'rom')
        out = run_scan_raw(f'{self.root}|snes/sub|{self.roms}')
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout)['entries'], [])
        self.assertIn('system name rejected', out.stderr)

    # Un fichier peut rendre plusieurs entrées (archive multi-ROM) ou aucune
    # (archive corrompue) : les deux unités sont comptées séparément.
    def test_counts_files_and_entries_per_strategy_separately(self):
        with zipfile.ZipFile(os.path.join(self.roms, 'Set.zip'), 'w') as z:
            z.writestr('A.sfc', b'aaa')
            z.writestr('B.sfc', b'bbb')
        self.write('Bare.sfc', b'rom')
        stats = run_scan(self.target())['stats']
        self.assertEqual(stats['filesByStrategy']['zip-entry'], 1)
        self.assertEqual(stats['entriesByStrategy']['zip-entry'], 2)
        self.assertEqual(stats['filesByStrategy']['raw'], 1)
        self.assertEqual(stats['entriesByStrategy']['raw'], 1)
        self.assertEqual(sum(stats['filesByStrategy'].values()), stats['scanned'])

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

    # Une archive à en-tête chiffré fait afficher « Enter password: » à 7z,
    # qui bloque alors en lecture sur le stdin hérité. Sur 22 500 archives il
    # suffit d'une pour figer un scan de plusieurs dizaines de minutes.
    def test_a_header_encrypted_7z_neither_hangs_nor_aborts_the_scan(self):
        staging = tempfile.mkdtemp()
        with open(os.path.join(staging, 'Secret.sfc'), 'wb') as f:
            f.write(b'ROM' * 100)
        dest = os.path.join(self.roms, 'Locked.7z')
        rc = subprocess.run(
            ['7z', 'a', '-bso0', '-bsp0', '-mhe=on', '-psecret', dest, '.'],
            cwd=staging, capture_output=True,
        ).returncode
        self.assertEqual(rc, 0, '7z failed to build the encrypted fixture')
        self.write('Good.sfc', b'rom')

        result = run_scan(self.target(), timeout=60)
        names = [os.path.basename(e['path']) for e in result['entries']]
        self.assertEqual(names, ['Good.sfc'])
        self.assertGreaterEqual(result['stats']['errors'], 1)

    # --- stratégie 4 : le listing, en direct ---

    # Le CRC de 7z est la seule valeur recopiée telle quelle depuis un autre
    # programme. Une entrée exotique (lien symbolique, méthode non supportée)
    # ferait rejeter tout le manifeste.
    def test_a_7z_entry_whose_crc_is_not_8_hex_digits_is_omitted(self):
        stats = scan_roms.new_stats()
        listing = scan_roms.parse_sevenzip_listing(
            '----------\n'
            'Path = Good.sfc\nSize = 10\nCRC = DEADBEEF\n\n'
            'Path = Weird.sfc\nSize = 10\nCRC = NOTHEX\n'
        )
        entries = scan_roms.build_sevenzip_entries('/nowhere.7z', listing, None, stats)
        self.assertEqual([e['innerName'] for e in entries], ['Good.sfc'])
        self.assertEqual(entries[0]['crc32'], 'deadbeef')
        self.assertEqual(stats['errors'], 1)

    # `capture_output` bufferise tout le zip décompressé en mémoire, et
    # `io.BytesIO` en fait une seconde copie. Un zip de plusieurs Gio dans un
    # .7z (courant sur les sets PS2/PSP) ferait exploser la RAM d'une console.
    def test_refuses_to_descend_into_an_oversized_nested_zip(self):
        stats = scan_roms.new_stats()
        listing = scan_roms.parse_sevenzip_listing(
            '----------\nPath = Huge.zip\nSize = %d\nCRC = 0BADF00D\n'
            % (scan_roms.MAX_NESTED_ZIP_BYTES + 1)
        )
        entries = scan_roms.build_sevenzip_entries('/nowhere.7z', listing, None, stats)
        # Repli sur le CRC de l'entrée intermédiaire plutôt que l'extraction.
        self.assertEqual([e['innerName'] for e in entries], ['Huge.zip'])
        self.assertEqual(entries[0]['crc32'], '0badf00d')
        self.assertEqual(stats['errors'], 1)

    def test_descends_into_a_nested_zip_that_stays_under_the_ceiling(self):
        self.assertTrue(scan_roms.may_descend(
            {'path': 'Small.zip', 'crc': 'deadbeef', 'size': 1024}, scan_roms.new_stats()
        ))

    # Le nom d'entrée sert d'`innerName` ET d'argument passé à 7z pour
    # l'extraction : un strip() détruirait un espace final significatif.
    def test_the_listing_parser_preserves_a_trailing_space_in_an_entry_name(self):
        (item,) = scan_roms.parse_sevenzip_listing(
            '----------\nPath = Game (USA) .sfc \nSize = 3\nCRC = 0000000A\n'
        )
        self.assertEqual(item['path'], 'Game (USA) .sfc ')
        self.assertEqual(item['crc'], '0000000a')
        self.assertEqual(item['size'], 3)

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


class ContainerModeTest(unittest.TestCase):
    """Les DAT arcade hashent l'archive elle-même : les 30 038 entrées ROM de
    MAME.dat portent un nom en .zip. Lire le CRC interne ne matcherait jamais."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.roms = os.path.join(self.tmp.name, 'roms', 'mame')
        os.makedirs(self.roms)

    def tearDown(self):
        self.tmp.cleanup()

    def make_zip(self, name, members):
        path = os.path.join(self.roms, name)
        with zipfile.ZipFile(path, 'w') as z:
            for member, payload in members.items():
                z.writestr(member, payload)
        return path

    def file_crc(self, path):
        crc = 0
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                crc = zlib.crc32(chunk, crc)
        return '%08x' % (crc & 0xFFFFFFFF)

    def target(self, mode='container'):
        return f'{self.tmp.name}|mame|{self.roms}|{mode}'

    def test_hashes_the_zip_file_itself_not_its_entries(self):
        path = self.make_zip('005.zip', {'005.rom': b'arcade payload'})
        result = run_scan(self.target())
        entry = result['entries'][0]
        self.assertEqual(entry['crc32'], self.file_crc(path))

    def test_the_container_crc_differs_from_the_inner_crc(self):
        payload = b'arcade payload'
        self.make_zip('005.zip', {'005.rom': payload})
        container = run_scan(self.target())['entries'][0]
        content = run_scan(self.target('content'))['entries'][0]
        self.assertNotEqual(container['crc32'], content['crc32'])
        self.assertEqual(content['crc32'], '%08x' % (zlib.crc32(payload) & 0xFFFFFFFF))

    def test_emits_one_entry_per_archive_not_one_per_rom(self):
        self.make_zip('multi.zip', {'a.rom': b'aaa', 'b.rom': b'bbb', 'c.rom': b'ccc'})
        result = run_scan(self.target())
        self.assertEqual(len(result['entries']), 1)
        self.assertIsNone(result['entries'][0].get('innerName'))

    def test_the_kind_says_container(self):
        self.make_zip('005.zip', {'005.rom': b'x'})
        self.assertEqual(run_scan(self.target())['entries'][0]['kind'], 'container')

    def test_the_entry_keeps_the_archive_path(self):
        path = self.make_zip('005.zip', {'005.rom': b'x'})
        self.assertEqual(run_scan(self.target())['entries'][0]['path'], path)

    def test_content_mode_still_reads_the_inner_crc(self):
        self.make_zip('game.zip', {'game.sfc': b'cartridge'})
        entry = run_scan(self.target('content'))['entries'][0]
        self.assertEqual(entry['kind'], 'zip-entry')
        self.assertEqual(entry['innerName'], 'game.sfc')

    def test_hashes_a_7z_as_a_plain_file_in_container_mode(self):
        # En mode conteneur, aucun binaire 7z n'est nécessaire : c'est le
        # fichier qu'on lit, pas son contenu.
        path = os.path.join(self.roms, 'set.7z')
        with open(path, 'wb') as f:
            f.write(b'7z\xbc\xaf\x27\x1c' + b'not really an archive')
        entry = run_scan(self.target())['entries'][0]
        self.assertEqual(entry['kind'], 'container')
        self.assertEqual(entry['crc32'], self.file_crc(path))

    def test_an_unreadable_archive_is_counted_not_fatal(self):
        self.make_zip('ok.zip', {'a.rom': b'a'})
        bad = os.path.join(self.roms, 'bad.zip')
        with open(bad, 'wb') as f:
            f.write(b'x')
        os.chmod(bad, 0o000)
        try:
            result = run_scan(self.target())
            self.assertEqual(len(result['entries']), 1)
            self.assertGreaterEqual(result['stats']['errors'], 1)
        finally:
            os.chmod(bad, 0o644)

    def test_counts_container_files_under_their_own_strategy(self):
        self.make_zip('a.zip', {'a.rom': b'a'})
        self.make_zip('b.zip', {'b.rom': b'b'})
        stats = run_scan(self.target())['stats']
        self.assertEqual(stats['filesByStrategy']['container'], 2)
        self.assertEqual(stats['entriesByStrategy']['container'], 2)

    def test_an_unknown_hash_mode_falls_back_to_content(self):
        # Un mode inconnu ne doit pas faire hacher 45 Go par surprise.
        self.make_zip('game.zip', {'game.sfc': b'cartridge'})
        entry = run_scan(self.target('nonsense'))['entries'][0]
        self.assertEqual(entry['kind'], 'zip-entry')

    def test_a_target_without_a_hash_mode_still_works(self):
        self.make_zip('game.zip', {'game.sfc': b'cartridge'})
        result = run_scan(f'{self.tmp.name}|mame|{self.roms}')
        self.assertEqual(result['entries'][0]['kind'], 'zip-entry')


class IncrementalScanTest(unittest.TestCase):
    """Le gain : ne pas relire 57 Go d'archives arcade à chaque passage."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.roms = os.path.join(self.tmp.name, 'roms', 'snes')
        os.makedirs(self.roms)

    def tearDown(self):
        self.tmp.cleanup()

    def make_raw(self, name, payload=b'cartridge payload'):
        path = os.path.join(self.roms, name)
        with open(path, 'wb') as f:
            f.write(payload)
        return path

    def cache_for(self, path, crc='deadbeef', size=None, mtime=None, kind='raw'):
        st = os.stat(path)
        entry = {
            'size': st.st_size if size is None else size,
            'mtime': int(st.st_mtime) if mtime is None else mtime,
            'crc32': crc,
            'kind': kind,
        }
        return base64.b64encode(zlib.compress(json.dumps({path: entry}).encode())).decode()

    def run_with_cache(self, cache_b64, mode='content'):
        """Le cache voyage devant le script, comme le fait le transport."""
        with open(SCRIPT, encoding='utf-8') as f:
            source = f.read()
        program = f"CACHE_B64 = '{cache_b64}'\n{source}"
        target = f'{self.tmp.name}|snes|{self.roms}|{mode}'
        out = subprocess.run(
            [sys.executable, '-', '--target', target],
            input=program, capture_output=True, text=True, timeout=120,
        )
        if out.returncode != 0:
            raise AssertionError(f'scan failed rc={out.returncode}: {out.stderr}')
        return json.loads(out.stdout)

    def test_reuses_the_cached_identification_when_size_and_mtime_match(self):
        path = self.make_raw('game.sfc')
        result = self.run_with_cache(self.cache_for(path, crc='aabbccdd'))
        entry = result['entries'][0]
        # La valeur du cache, pas le vrai CRC du fichier : c'est la preuve
        # qu'aucune lecture n'a eu lieu.
        self.assertEqual(entry['crc32'], 'aabbccdd')
        self.assertEqual(entry['kind'], 'raw')

    def test_counts_the_reused_entries_separately(self):
        path = self.make_raw('game.sfc')
        result = self.run_with_cache(self.cache_for(path))
        self.assertEqual(result['stats']['reused'], 1)

    def test_rehashes_when_the_size_changed(self):
        path = self.make_raw('game.sfc')
        result = self.run_with_cache(self.cache_for(path, crc='aabbccdd', size=999999))
        self.assertNotEqual(result['entries'][0]['crc32'], 'aabbccdd')
        self.assertEqual(result['stats']['reused'], 0)

    def test_rehashes_when_the_mtime_changed(self):
        path = self.make_raw('game.sfc')
        result = self.run_with_cache(self.cache_for(path, crc='aabbccdd', mtime=1))
        self.assertNotEqual(result['entries'][0]['crc32'], 'aabbccdd')

    def test_hashes_a_file_absent_from_the_cache(self):
        self.make_raw('game.sfc')
        other = self.make_raw('other.sfc', b'other payload')
        result = self.run_with_cache(self.cache_for(other, crc='aabbccdd'))
        by_name = {os.path.basename(e['path']): e for e in result['entries']}
        self.assertEqual(by_name['other.sfc']['crc32'], 'aabbccdd')
        self.assertNotEqual(by_name['game.sfc']['crc32'], 'aabbccdd')

    def test_reuses_an_arcade_container(self):
        path = os.path.join(self.roms, '005.zip')
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('005.rom', b'arcade')
        result = self.run_with_cache(
            self.cache_for(path, crc='11223344', kind='container'), mode='container'
        )
        self.assertEqual(result['entries'][0]['crc32'], '11223344')
        self.assertEqual(result['stats']['reused'], 1)

    # Le cache ne doit jamais servir aux stratégies bon marché : leurs entrées
    # portent des champs (rawSha1, discNumber) que la base ne conserve pas.
    def test_never_reuses_the_cache_for_a_zip_entry(self):
        path = os.path.join(self.roms, 'game.zip')
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('game.sfc', b'cartridge')
        result = self.run_with_cache(self.cache_for(path, crc='aabbccdd', kind='raw'))
        self.assertEqual(result['entries'][0]['kind'], 'zip-entry')
        self.assertNotEqual(result['entries'][0]['crc32'], 'aabbccdd')
        self.assertEqual(result['stats']['reused'], 0)

    # Dans le doute, on relit : un cache abîmé ne doit pas produire un faux résultat.
    def test_a_malformed_cache_entry_falls_back_to_hashing(self):
        path = self.make_raw('game.sfc')
        packed = base64.b64encode(
            zlib.compress(json.dumps({path: {'size': 'huit', 'crc32': 42}}).encode())
        ).decode()
        result = self.run_with_cache(packed)
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual(result['stats']['reused'], 0)

    def test_a_corrupt_cache_payload_does_not_kill_the_scan(self):
        self.make_raw('game.sfc')
        result = self.run_with_cache('not-valid-base64!!')
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual(result['stats']['reused'], 0)

    def test_an_empty_cache_behaves_exactly_like_no_cache(self):
        self.make_raw('game.sfc')
        packed = base64.b64encode(zlib.compress(b'{}')).decode()
        with_cache = self.run_with_cache(packed)
        without = run_scan(f'{self.tmp.name}|snes|{self.roms}')
        self.assertEqual(with_cache['entries'], without['entries'])

    def test_the_script_still_runs_with_no_cache_injected_at_all(self):
        self.make_raw('game.sfc')
        result = run_scan(f'{self.tmp.name}|snes|{self.roms}')
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual(result['stats']['reused'], 0)
