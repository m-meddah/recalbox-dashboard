#!/usr/bin/env python3
"""
ROM audit scanner — runs ON the Recalbox.

Walks one or more `/roms/<system>` directories and emits a JSON manifest on
stdout describing every ROM-shaped file it finds, fingerprinted at the
lowest cost that still yields something a reference catalogue (DAT/Redump/
No-Intro) can match against:

  1. .zip              -> CRC32 read from the central directory, no inflate.
  2. .chd               -> SHA1 / raw SHA1 read straight from the 124-byte
                           header (offsets differ by CHD version).
  3. .rvz / .wia / .iso -> 4-char game code + disc number/version read from
                           the disc header (`dhead`), cross-checked against
                           the GameCube/Wii disc magic.
  4. .7z                -> per-entry CRC32 from `7z(r) l -slt`, no extract.
                           A .zip nested inside a .7z is streamed via
                           `7z(r) e -so` and its own central directory read
                           in memory, so the manifest never carries the
                           useless CRC of the intermediate zip — but only
                           below a size ceiling, since that stream is
                           buffered whole in RAM.
  5. anything else       -> whole-file CRC32, streamed in 1 MiB chunks.

Dependency-free (Python 3 stdlib only — RecalboxOS has no package manager).
Read-only: nothing is ever written to the scanned filesystem. Never aborts:
every failure (corrupt archive, permission denied, truncated header, broken
symlink) increments a counter and the file is omitted; the scan continues.

Output shape must satisfy `apps/dashboard/lib/rom-audit/manifest.ts` — field
names, hash lengths and the kind/field pairing rules come from that schema.
Violating it rejects the *whole* manifest server-side, so anything that
can't be validated is dropped here instead of emitted half-formed.

Usage:
    python3 scan_roms.py --target <mount>|<system>|<romsPath> [--target ...]
"""

import argparse
import io
import json
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import zipfile
import zlib

# Shorter and safer to maintain than a ROM-extension whitelist, which varies
# per system. Measured on a real collection (usb0): 114 805 .png, 34 900
# .mp4, 11 584 .pdf alone — the bulk of what a directory listing turns up.
IGNORED_EXTENSIONS = frozenset(
    'png jpg jpeg gif bmp webp '
    'mp4 mkv avi mp3 ogg wav '
    'pdf txt nfo xml cfg ini dat db log bak backup keep m3u srm state'.split()
)

CHD_MAGIC = b'MComprHD'
CHD_HEADER_LEN = 124
# sha1/rawsha1 byte offsets inside the 124-byte CHD header, verified against
# the libchdr sources (see task brief) — do not recompute from memory.
CHD_OFFSETS = {
    5: {'sha1': 84, 'rawsha1': 64},
    4: {'sha1': 48, 'rawsha1': 88},
    3: {'sha1': 80, 'rawsha1': None},
}

# WIA/RVZ places `wia_disc_t` at file offset 0x48 — but that struct does NOT
# start with `dhead`. Four u32 come first (disc_type, compression,
# compr_level, chunk_size), i.e. 0x10 bytes, so `dhead` (the first 128 bytes
# of the *original* disc image, verbatim) begins at 0x58. Reading it at 0x48
# identifies exactly nothing; the disc-magic cross-check below exists so that
# mistake can never pass unnoticed again. A bare .iso has no such wrapper —
# dhead is just the file's first 128 bytes.
WIA_FILE_MAGICS = (b'WIA\x01', b'RVZ\x01')
WIA_DISC_T_OFFSET = 0x48
WIA_DHEAD_OFFSET = WIA_DISC_T_OFFSET + 0x10  # 0x58
DHEAD_LEN = 0x80
# Big-endian sentinels every GameCube/Wii disc header carries.
WII_DISC_MAGIC = 0x5D1C9EA3  # dhead + 0x18
GAMECUBE_DISC_MAGIC = 0xC2339F3D  # dhead + 0x1C
GAME_CODE_RE = re.compile(r'^[A-Za-z0-9]{4}$')

SEVENZIP_CANDIDATES = ('7z', '7za', '7zr')
CHUNK_SIZE = 1024 * 1024

# A .7z entry's CRC is the one value we copy verbatim from another program's
# output instead of formatting ourselves. The schema wants exactly 8 lowercase
# hex digits and rejects the WHOLE manifest over one bad entry, so it is
# validated here.
CRC32_RE = re.compile(r'^[0-9a-f]{8}$')

# Descending into a nested .zip means buffering the decompressed stream in
# memory twice (subprocess pipe + BytesIO). PS2/PSP sets routinely hold
# multi-gigabyte zips, which would take the console's RAM down with them —
# above this ceiling we keep the intermediate zip's own CRC instead.
MAX_NESTED_ZIP_BYTES = 256 * 1024 * 1024

# `systemId` in the Zod schema: safeFsPath, max 64 chars, no path separator.
MAX_SYSTEM_ID_LEN = 64

STRATEGIES = ('zip-entry', 'chd', 'rvz', 'sevenzip-entry', 'raw')


def find_sevenzip_binary():
    """First of 7z/7za/7zr found on PATH. RecalboxOS ships only 7zr; a dev
    box has all three. None means the strategy falls back to raw hashing."""
    for name in SEVENZIP_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    return None


def is_safe_relpath(value):
    """Mirrors the Zod schema's safeFsPath guard: no control characters (nul
    and newlines included), no ".." segment. Applied to every string field
    that crosses into the manifest, since one unsafe value rejects the
    entire manifest server-side."""
    if not value:
        return False
    if any(ord(ch) <= 0x1F for ch in value):
        return False
    if '..' in value.split('/'):
        return False
    return True


def new_stats():
    """Two per-strategy series, deliberately named apart. One file can yield
    many manifest entries (a multi-ROM archive) or none (a corrupt one), so a
    single counter mixing both units was unreadable. Invariant:
    sum(filesByStrategy) == scanned."""
    return {
        'scanned': 0,
        'skipped': 0,
        'errors': 0,
        'filesByStrategy': dict.fromkeys(STRATEGIES, 0),
        'entriesByStrategy': dict.fromkeys(STRATEGIES, 0),
    }


def iter_files(roms_path, stats):
    """Yields every non-hidden file under roms_path, skipping `media` and
    dot-directories. A directory os.walk can't even list (permission
    denied) is counted as an error and simply not descended into — it
    never aborts the walk."""

    def onerror(_err):
        stats['errors'] += 1

    for dirpath, dirnames, filenames in os.walk(roms_path, onerror=onerror, followlinks=False):
        dirnames[:] = [d for d in dirnames if not d.startswith('.') and d.lower() != 'media']
        for name in filenames:
            yield os.path.join(dirpath, name)


# ── Strategy 1: .zip ──────────────────────────────────────────────────────


def handle_zip(filepath, stats):
    out = []
    try:
        with zipfile.ZipFile(filepath) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if not is_safe_relpath(info.filename):
                    stats['errors'] += 1
                    continue
                out.append({
                    'kind': 'zip-entry',
                    'crc32': '%08x' % (info.CRC & 0xFFFFFFFF),
                    'innerName': info.filename,
                })
    except Exception:
        # Corrupt archive: never partially trust it — omit the whole file
        # rather than risk emitting a bogus entry.
        stats['errors'] += 1
        return []
    return out


# ── Strategy 2: .chd ──────────────────────────────────────────────────────


def handle_chd(filepath, stats):
    try:
        with open(filepath, 'rb') as f:
            header = f.read(CHD_HEADER_LEN)
    except OSError:
        stats['errors'] += 1
        return []
    if len(header) < CHD_HEADER_LEN:
        # Truncated header: an explicit failure mode from the spec — the
        # file is omitted rather than listed with guessed offsets.
        stats['errors'] += 1
        return []

    entry = {'kind': 'chd'}
    if header[0:8] == CHD_MAGIC:
        (version,) = struct.unpack_from('>I', header, 12)
        offsets = CHD_OFFSETS.get(version)
        if offsets:
            sha1_off = offsets['sha1']
            entry['sha1'] = header[sha1_off:sha1_off + 20].hex()
            raw_off = offsets['rawsha1']
            if raw_off is not None:
                entry['rawSha1'] = header[raw_off:raw_off + 20].hex()
        # Unknown version: header is readable but offsets aren't — keep the
        # file listed, just without a fingerprint.
    # Wrong magic: not actually a CHD, but the header was fully readable —
    # this isn't the "truncated/corrupt" failure the spec means to omit, so
    # the file stays listed (extension-routed) without hash fields.
    return [entry]


# ── Strategy 3: .rvz / .wia / .iso ────────────────────────────────────────


def has_disc_magic(dhead):
    """True when `dhead` really is a GameCube or Wii disc header. Both
    sentinels are big-endian and sit at fixed offsets; either one confirms
    that the bytes we read are the header and not whatever happens to live at
    a wrong offset."""
    (wii,) = struct.unpack_from('>I', dhead, 0x18)
    (gamecube,) = struct.unpack_from('>I', dhead, 0x1C)
    return wii == WII_DISC_MAGIC or gamecube == GAMECUBE_DISC_MAGIC


def handle_disc_header(filepath, ext, stats):
    wrapped = ext in ('rvz', 'wia')
    try:
        with open(filepath, 'rb') as f:
            file_magic = f.read(4) if wrapped else b''
            f.seek(WIA_DHEAD_OFFSET if wrapped else 0)
            dhead = f.read(DHEAD_LEN)
    except OSError:
        stats['errors'] += 1
        return []
    if len(dhead) < DHEAD_LEN:
        stats['errors'] += 1
        return []

    entry = {'kind': 'rvz'}
    # Self-verification, and it guards two distinct failures. The container
    # magic says the file is what its extension claims. The disc magic says we
    # landed on a real disc header — which catches a wrong `dhead` offset, but
    # more importantly stops us INVENTING a serial: `.iso` also covers PC
    # Engine CD, Dreamcast and Saturn images, whose first four bytes may well
    # be alphanumeric by accident. A fabricated serial is worse than no match
    # at all — it marks a game as owned when it is not, and that missing ROM
    # then disappears from the audit without anyone noticing. So the disc
    # magic is required for every file routed here, wrapper or not.
    trusted = has_disc_magic(dhead)
    if wrapped:
        trusted = trusted and file_magic in WIA_FILE_MAGICS

    try:
        code = dhead[0:4].decode('ascii')
    except UnicodeDecodeError:
        code = None
    # An unusable game code would fail the schema's serial regex and reject
    # the whole manifest — drop the identifying fields, keep the entry. Same
    # for an unverified header: an unidentified file beats an invented id.
    if trusted and code and GAME_CODE_RE.match(code):
        entry['serial'] = code
        entry['discNumber'] = dhead[6]
        entry['discVersion'] = dhead[7]
    return [entry]


# ── Strategy 4: .7z ────────────────────────────────────────────────────────

_SEVENZIP_LISTING_SEPARATOR = '----------'


def parse_sevenzip_listing(text):
    """Parses `7z(r) l -slt` output into {path, crc, size} dicts. Directories
    are listed with an empty CRC field and are filtered out that way — no
    need to parse the Attributes column."""
    text = text.replace('\r\n', '\n')
    if _SEVENZIP_LISTING_SEPARATOR in text:
        text = text.split(_SEVENZIP_LISTING_SEPARATOR, 1)[1]
    results = []
    for block in text.split('\n\n'):
        fields = {}
        for line in block.splitlines():
            key, sep, value = line.partition('=')
            if not sep:
                continue
            # The format is `Key = Value`: drop the single separator space and
            # nothing more. An entry name may legitimately end in a space, and
            # stripping it would corrupt both `innerName` and the argument
            # handed back to 7z for extraction.
            if value.startswith(' '):
                value = value[1:]
            fields[key.strip()] = value
        path = fields.get('Path')
        crc = fields.get('CRC', '').strip().lower()
        if not path or not crc:
            continue
        size = fields.get('Size', '').strip()
        results.append({
            'path': path,
            'crc': crc,
            'size': int(size) if size.isdigit() else None,
        })
    return results


def may_descend(item, stats):
    """Whether a nested .zip entry is safe to stream out and re-read. The
    stream is buffered whole in RAM, twice, so an unknown or oversized entry
    is refused: we keep the intermediate zip's CRC rather than risk killing
    the scan with a MemoryError halfway through six terabytes."""
    if item['size'] is None or item['size'] > MAX_NESTED_ZIP_BYTES:
        stats['errors'] += 1
        return False
    if item['path'].startswith('-'):
        # 7z would read the extraction argument as a switch.
        stats['errors'] += 1
        return False
    return True


def extract_nested_zip(archive_path, inner_name, sevenzip_bin, stats):
    """The measured trap: a minority of .7z archives contain a .zip rather
    than a bare ROM, and the CRC 7z lists for it is the intermediate zip's
    — useless against the catalogue. Stream the entry out and read its own
    central directory in memory instead."""
    try:
        proc = subprocess.run(
            [sevenzip_bin, 'e', '-so', archive_path, inner_name],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError, MemoryError):
        # TimeoutExpired is a SubprocessError, NOT an OSError: catching only
        # the latter let a single slow archive abort the entire scan.
        stats['errors'] += 1
        return []
    if proc.returncode != 0:
        stats['errors'] += 1
        return []
    out = []
    try:
        with zipfile.ZipFile(io.BytesIO(proc.stdout)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if not is_safe_relpath(info.filename):
                    stats['errors'] += 1
                    continue
                out.append({
                    'kind': 'sevenzip-entry',
                    'crc32': '%08x' % (info.CRC & 0xFFFFFFFF),
                    'innerName': info.filename,
                })
    except Exception:
        stats['errors'] += 1
        return []
    return out


def build_sevenzip_entries(archive_path, listing, sevenzip_bin, stats):
    out = []
    for item in listing:
        name = item['path']
        if not is_safe_relpath(name):
            stats['errors'] += 1
            continue
        if name.lower().endswith('.zip') and may_descend(item, stats):
            out.extend(extract_nested_zip(archive_path, name, sevenzip_bin, stats))
            continue
        # Falls through here for a refused descent too: the intermediate
        # zip's CRC is a poor fingerprint, but it is a valid entry.
        if not CRC32_RE.match(item['crc']):
            # A symlink or an unsupported method can list something that is
            # not 8 hex digits; emitting it would fail the schema and take
            # the whole manifest down with it.
            stats['errors'] += 1
            continue
        out.append({'kind': 'sevenzip-entry', 'crc32': item['crc'], 'innerName': name})
    return out


# RecalboxOS only ships `7zr`, the REDUCED 7-Zip binary, and it rejects `-y` and
# `-p` outright ("Command Line Error"). They were added here once as a guard
# against an encrypted archive prompting for a password, validated against the
# full `7z` of a dev machine, and silently broke every .7z on the real target.
# `stdin=DEVNULL` already covers that case: the prompt reads EOF and 7z gives up
# instead of blocking. Do not add options back without running them on `7zr`.
def handle_sevenzip(filepath, sevenzip_bin, stats):
    try:
        proc = subprocess.run(
            # -y and -p (empty password) with stdin closed: a header-encrypted
            # archive otherwise prints "Enter password:" and blocks forever on
            # the inherited stdin. One such file among 22 500 stalls the scan.
            [sevenzip_bin, 'l', '-slt', filepath],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError):
        stats['errors'] += 1
        return []
    if proc.returncode != 0:
        stats['errors'] += 1
        return []

    text = proc.stdout.decode('utf-8', errors='replace')
    return build_sevenzip_entries(filepath, parse_sevenzip_listing(text), sevenzip_bin, stats)


# ── Strategy 5: raw ────────────────────────────────────────────────────────


def handle_raw(filepath, stats):
    crc = 0
    try:
        with open(filepath, 'rb') as f:
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                crc = zlib.crc32(chunk, crc)
    except OSError:
        stats['errors'] += 1
        return []
    return [{'kind': 'raw', 'crc32': '%08x' % (crc & 0xFFFFFFFF)}]


# ── Dispatch ───────────────────────────────────────────────────────────────


def strategy_fragments(filepath, ext, sevenzip_bin, stats):
    if ext == 'zip':
        strategy, fragments = 'zip-entry', handle_zip(filepath, stats)
    elif ext == 'chd':
        strategy, fragments = 'chd', handle_chd(filepath, stats)
    elif ext in ('rvz', 'wia', 'iso'):
        strategy, fragments = 'rvz', handle_disc_header(filepath, ext, stats)
    elif ext == '7z' and sevenzip_bin is not None:
        strategy, fragments = 'sevenzip-entry', handle_sevenzip(filepath, sevenzip_bin, stats)
    else:
        # Includes .7z with no 7z binary on PATH: an environment choice, not
        # a failure — it is honestly counted as what it actually ran, `raw`.
        strategy, fragments = 'raw', handle_raw(filepath, stats)
    # Counted here, once, at the single dispatch point: every scanned file is
    # attributed to exactly one strategy whether or not it yielded entries.
    stats['filesByStrategy'][strategy] += 1
    stats['entriesByStrategy'][strategy] += len(fragments)
    return fragments


def process_file(filepath, mount, system, sevenzip_bin, stats):
    name = os.path.basename(filepath)
    ext = os.path.splitext(name)[1].lower().lstrip('.')
    if ext in IGNORED_EXTENSIONS:
        stats['skipped'] += 1
        return []

    try:
        st = os.stat(filepath)
    except OSError:
        # Permission denied, broken symlink, or the file vanished mid-walk.
        stats['errors'] += 1
        return []

    if not stat.S_ISREG(st.st_mode):
        stats['skipped'] += 1
        return []
    if st.st_size == 0:
        stats['skipped'] += 1
        return []
    if not is_safe_relpath(filepath):
        stats['errors'] += 1
        return []

    stats['scanned'] += 1
    fragments = strategy_fragments(filepath, ext, sevenzip_bin, stats)

    base = {
        'path': filepath,
        'size': st.st_size,
        # exFAT USB disks do carry pre-1970 timestamps. The schema wants a
        # non-negative integer and rejects the WHOLE manifest over one entry,
        # so a bogus date costs the epoch, not the scan.
        'mtime': max(0, int(st.st_mtime)),
        'system': system,
        'mount': mount,
    }
    entries = []
    for frag in fragments:
        entry = dict(base)
        entry.update(frag)
        entries.append(entry)
    return entries


def parse_target(spec):
    parts = spec.split('|', 2)
    if len(parts) != 3:
        raise ValueError(f'invalid --target (expected mount|system|romsPath): {spec!r}')
    mount, system, roms_path = parts
    return mount, system, roms_path


def scan(targets):
    stats = new_stats()
    entries = []
    sevenzip_bin = find_sevenzip_binary()

    for spec in targets:
        try:
            mount, system, roms_path = parse_target(spec)
        except ValueError as exc:
            print(f'scan_roms: {exc}', file=sys.stderr)
            continue
        if not is_safe_relpath(mount) or not is_safe_relpath(system):
            print(f'scan_roms: unsafe mount/system in target, skipping: {spec!r}', file=sys.stderr)
            continue
        # `systemId` is stricter than `safeFsPath`: bounded length, and no
        # separator so it can never widen into a path. Rejecting the target
        # here beats having the server reject the entire manifest.
        if len(system) > MAX_SYSTEM_ID_LEN or '/' in system or '\\' in system:
            print(
                f'scan_roms: system name rejected by the manifest schema '
                f'(max {MAX_SYSTEM_ID_LEN} chars, no path separator), skipping: {system!r}',
                file=sys.stderr,
            )
            continue
        # Without this, a path holding a ".." segment walks fine but every
        # file it yields fails is_safe_relpath — zero entries and a huge error
        # count, for a target that was merely spelled indirectly.
        roms_path = os.path.abspath(roms_path)
        if not os.path.isdir(roms_path):
            print(f'scan_roms: roms path not found, skipping: {roms_path}', file=sys.stderr)
            continue
        for filepath in iter_files(roms_path, stats):
            entries.extend(process_file(filepath, mount, system, sevenzip_bin, stats))

    return {'entries': entries, 'stats': stats}


def parse_args(argv):
    parser = argparse.ArgumentParser(description='Scan Recalbox ROM directories into a JSON manifest.')
    parser.add_argument(
        '--target',
        action='append',
        default=[],
        metavar='MOUNT|SYSTEM|ROMS_PATH',
        help='One scan target; repeat for multiple. Format: <mount>|<system>|<romsPath>.',
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = scan(args.target)
    json.dump(result, sys.stdout)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
