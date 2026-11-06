#!/usr/bin/env python3
"""Omit only unchanged Astro public HTML/CSS/JS/JSON, verified later by signed PHP.

Never reuse server/ SSR, metadata, or mandatory client/index.html. If this
server does not advertise static hashes, keep the complete static ZIP.
"""
import hashlib
import json
import os
from pathlib import Path
import re

SEGMENT = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]*$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
EXTENSION = re.compile(r"\.(?:html|css|js|json)$")
MAX_FILES = 5000
MAX_TOTAL = 104857600
MAX_SINGLE = 26214400


def eligible(name):
    return (isinstance(name, str) and 0 < len(name) <= 240
            and name != "index.html" and not name.startswith("images/")
            and EXTENSION.search(name) is not None
            and all(part not in (".", "..") and SEGMENT.fullmatch(part)
                    for part in name.split("/")))


def sha256(path):
    hash_value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hash_value.update(chunk)
    return hash_value.hexdigest()


def collect_local(root):
    if not root.is_dir() or root.is_symlink():
        return None
    result = {}
    total = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            return None
        if path.is_dir():
            continue
        if not path.is_file():
            return None
        rel = path.relative_to(root).as_posix()
        if rel == "index.html" or rel.startswith("images/") or not EXTENSION.search(rel):
            continue
        if not eligible(rel) or len(result) >= MAX_FILES:
            return None
        size = path.stat().st_size
        total += size
        if size > MAX_SINGLE or total > MAX_TOTAL:
            return None
        result[rel] = {"size": size, "sha256": sha256(path)}
    return result


def main():
    root = Path("deploy/client")
    signed_file = Path(".ptscps-remote-image-manifest.json")
    if not signed_file.is_file():
        print("PTSCPS_STATIC_DELTA=FULL_ZIP no-signed-inventory")
        return
    remote = json.loads(signed_file.read_text(encoding="utf-8")).get("static")
    if remote is None:
        print("PTSCPS_STATIC_DELTA=FULL_ZIP php-static-not-supported")
        return
    if not isinstance(remote, dict):
        raise ValueError("Invalid signed static inventory")
    local = collect_local(root)
    if not local:
        print("PTSCPS_STATIC_DELTA=FULL_ZIP no-safe-static-files")
        return
    reuse = [name for name, meta in local.items() if remote.get(name) == meta]
    if not reuse:
        print("PTSCPS_STATIC_DELTA=FULL_ZIP no-reusable-static-files")
        return
    marker = Path("deploy/ptscps-static-delta.json")
    if marker.exists() or marker.is_symlink():
        raise ValueError("Unexpected static delta marker")
    encoded = json.dumps({
        "format": 1, "files": local, "reuse": reuse,
    }, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode('utf-8')) > 1048576:
        print("PTSCPS_STATIC_DELTA=FULL_ZIP marker-exceeds-php-limit")
        return
    marker.write_text(encoded, encoding="utf-8")
    saved = sum(local[name]["size"] for name in reuse)
    for name in reuse:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("Reusable static file disappeared during packaging")
        path.unlink()
    print("PTSCPS_STATIC_DELTA=ENABLED total=%d reuse=%d bytes_saved=%d" %
          (len(local), len(reuse), saved))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("- PTSCPS static delta: %d/%d unchanged HTML/CSS/JS/JSON, "
                         "%d bytes omitted; PHP verifies restored staging.\n" %
                         (len(reuse), len(local), saved))


if __name__ == "__main__":
    main()
