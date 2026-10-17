#!/usr/bin/env python3
"""Mirror the router plugin feed that GitHub Pages serves under /agent/.

Pages replaces the whole site on every deployment, so a website-only deployment has to carry the
live feed along. Pages has no directory listings: the file list is rebuilt from manifest.json and the
feed indexes, and every package is checked against the sha256 and size they record. Any missing or
mismatching file fails the run, so a deployment never ships a partial feed.

Usage: python website/mirror_feed.py <feed url, e.g. https://tsix2019.github.io/RouteLink/agent/> <out dir>
Exit 0 with nothing written when the feed has never been published (manifest.json is 404).
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Index files the OpenWrt SDK writes next to the packages; which ones exist depends on the release.
INDEX_FILES = ['Packages', 'Packages.gz', 'Packages.sig', 'Packages.manifest', 'packages.adb', 'index.json']


class Missing(Exception):
    pass


class FeedError(Exception):
    pass


def fetch(url: str) -> bytes:
    """GET with a few retries; raises Missing on 404."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'routelink-pages-mirror'})
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise Missing(url) from e
            if attempt == 3:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)
    raise AssertionError('unreachable')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_packages(text: str) -> list[dict]:
    """Stanzas of an opkg Packages index as dicts (continuation lines are ignored)."""
    entries = []
    for stanza in text.strip().split('\n\n'):
        entry = {}
        for line in stanza.splitlines():
            if ':' in line and not line.startswith(' '):
                key, value = line.split(':', 1)
                entry[key.strip()] = value.strip()
        if entry:
            entries.append(entry)
    return entries


def mirror_dir(base: str, out: Path, rel_dir: str, targets: list[dict]) -> int:
    """Download and verify one feed directory; returns the number of files written."""
    files = 0
    dest = out / rel_dir
    dest.mkdir(parents=True, exist_ok=True)
    present = set()
    for name in INDEX_FILES:
        try:
            data = fetch(f'{base}{rel_dir}/{name}')
        except Missing:
            continue
        (dest / name).write_bytes(data)
        present.add(name)
        files += 1

    packages: dict[str, tuple[str, int]] = {}  # file name -> (sha256, size)
    if 'Packages' in present:
        for entry in parse_packages((dest / 'Packages').read_text(encoding='utf-8')):
            packages[entry['Filename']] = (entry['SHA256sum'], int(entry['Size']))

    formats = {t['format'] for t in targets}
    if 'ipk' in formats and not {'Packages', 'Packages.sig'} <= present:
        raise FeedError(f'{rel_dir}: opkg feed without a signed Packages index')
    if 'apk' in formats and 'packages.adb' not in present:
        raise FeedError(f'{rel_dir}: apk feed without packages.adb')

    release, arch = rel_dir.split('/')
    for target in targets:
        for f in target['files']:
            if target['format'] == 'apk':
                # the release renames routelinkd-1.0.0-r1.apk to routelinkd-1.0.0-r1_<release>_<arch>.apk
                suffix = f'_{release}_{arch}.apk'
                if not f['name'].endswith(suffix):
                    raise FeedError(f"{rel_dir}: unexpected apk name {f['name']}")
                packages[f['name'][: -len(suffix)] + '.apk'] = (f['sha256'], f['size'])
            elif (f['sha256'], f['size']) not in packages.values():
                raise FeedError(f"{rel_dir}: {f['name']} from the manifest is not in the Packages index")

    for name, (digest, size) in sorted(packages.items()):
        data = fetch(f'{base}{rel_dir}/{name}')
        if len(data) != size or sha256(data) != digest:
            raise FeedError(f'{rel_dir}/{name}: sha256 or size does not match the index')
        (dest / name).write_bytes(data)
        files += 1
    return files


def main(base: str, out: Path) -> int:
    base = base.rstrip('/') + '/'
    try:
        raw_manifest = fetch(base + 'manifest.json')
    except Missing:
        print(f'no feed at {base}manifest.json; nothing to mirror')
        return 0
    manifest = json.loads(raw_manifest)
    print(f"mirroring {manifest['tag']} ({len(manifest['targets'])} targets) from {base}")

    # "<release>/<arch>" or "<release>/<arch>/<format>": both formats of a release share one directory
    dirs: dict[str, list[dict]] = {}
    for key, target in manifest['targets'].items():
        release, arch = key.split('/')[:2]
        dirs.setdefault(f'{release}/{arch}', []).append(target)

    with ThreadPoolExecutor(max_workers=8) as pool:
        try:
            files = sum(pool.map(lambda item: mirror_dir(base, out, *item), sorted(dirs.items())))
        except FeedError as e:
            print(f'error: {e}', file=sys.stderr)
            return 1

    (out / 'manifest.json').write_bytes(raw_manifest)
    print(f'{files + 1} files in {len(dirs)} feeds -> {out}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[-2], file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], Path(sys.argv[2])))
