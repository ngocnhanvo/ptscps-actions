#!/usr/bin/env python3
"""Package only modified Astro client/images for PTSCPS's verified signed PHP v2.

No changes to Astro build, WordPress data/cache, SSR or full ZIP fallback.
The manifest is populated from compiler output, never from guessed WP paths.
"""
import hashlib
import json
import os
from pathlib import Path
import re

NAME = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]*$")
HASH = re.compile(r"^[0-9a-f]{64}$")
MAX_FILES = 5000
MAX_TOTAL = 524288000
MAX_SINGLE = 26214400


def safe_name(name):
    return (isinstance(name, str) and 0 < len(name) <= 240
            and all(x not in (".", "..") and NAME.fullmatch(x)
                    for x in name.split("/")))


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def collect_local(root):
    if not root.is_dir() or root.is_symlink():
        return None
    local = {}
    total = 0
    for entry in sorted(root.rglob("*")):
        if entry.is_symlink():
            return None  # Fallback to FULL ZIP; do not infer symlink assets.
        if entry.is_dir():
            continue
        if not entry.is_file():
            return None
        name = entry.relative_to(root).as_posix()
        if not safe_name(name) or len(local) >= MAX_FILES:
            return None
        size = entry.stat().st_size
        total += size
        if size > MAX_SINGLE or total > MAX_TOTAL:
            return None
        local[name] = {"size": size, "sha256": digest(entry)}
    return local


def main():
    root = Path("deploy/client/images")
    remote_path = Path(".ptscps-remote-image-manifest.json")
    if not remote_path.is_file():
        print("PTSCPS_IMAGE_DELTA=FULL_ZIP remote-manifest-not-available")
        return
    local = collect_local(root)
    if local is None or not local:
        print("PTSCPS_IMAGE_DELTA=FULL_ZIP local-images-not-eligible")
        return
    obj = json.loads(remote_path.read_text(encoding="utf-8"))
    old = obj.get("images")
    if not isinstance(old, dict):
        raise ValueError("Invalid authenticated remote image manifest")
    reused = []
    for name, meta in local.items():
        if old.get(name) == meta:
            reused.append(name)
    if not reused:
        print("PTSCPS_IMAGE_DELTA=FULL_ZIP no-reusable-images")
        return
    # This file is ZIP-private; the signed PHP activator deletes it before
    # publishing. Its full inventory allows exact restore/verify/rollback.
    marker = Path("deploy/ptscps-image-delta.json")
    if marker.exists():
        raise ValueError("Unexpected existing image delta marker")
    encoded = json.dumps({
        "format": 1, "files": local, "reuse": reused
    }, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode('utf-8')) > 1048576:
        print("PTSCPS_IMAGE_DELTA=FULL_ZIP marker-exceeds-php-limit")
        return
    marker.write_text(encoded, encoding="utf-8")
    saved = sum(local[name]["size"] for name in reused)
    for name in reused:
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Image disappeared during packaging")
        path.unlink()
    print("PTSCPS_IMAGE_DELTA=ENABLED total=%d reuse=%d bytes_saved=%d" %
          (len(local), len(reused), saved))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("- PTSCPS image delta: %d/%d reused, %d bytes omitted from ZIP; "
                         "signed PHP will verify before activation.\n" %
                         (len(reused), len(local), saved))


if __name__ == "__main__":
    main()
