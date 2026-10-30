#!/usr/bin/env python3
"""Strict, resumable FTPS-only initial WordPress file installation for PTSCPS.

Does not install a database, generate wp-config.php, delete server content,
modify uploads, or invoke Astro. An existing WP installation is rejected.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from ftplib import FTP_TLS, error_perm
from hashlib import sha256
from io import BytesIO
import os
from pathlib import Path, PurePosixPath
import secrets
import re
import ssl
import subprocess
from urllib.parse import urlsplit

SOURCE = Path("source-php")
MARKER = ".ptscps-wp-bootstrap-incomplete.php"
MARKER_PREFIX = b"<?php http_response_code(404); exit; /* PTSCPS_WP_BOOTSTRAP_V1 "
EXCLUDE_PREFIXES = ("wp-content/uploads/", "wp-content/updraft/", "wp-content/cache/", "wp-content/upgrade/", "docs/", ".github/")
EXCLUDE_FILES = {"wp-config.php", ".env", ".env.local", ".gitignore", ".gitattributes", ".editorconfig", "AGENTS.md", "README.md", "PTSCPS_DEPLOY_CONFIG.md"}
FTP_TIMEOUT = 45


def config() -> tuple[str, str, str]:
    env = os.environ.get("ENV_FILE", "")
    values = []
    for line in env.splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?WC_URL\s*=\s*(.*?)\s*", line)
        if match:
            values.append(match[1].strip().strip('"\''))
    if len(values) != 1:
        raise ValueError("Exactly one WC_URL is required")
    parsed = urlsplit(values[0])
    if (parsed.scheme != "https" or not parsed.hostname or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment
            or not re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", parsed.hostname)
            or ".." in parsed.hostname or "." not in parsed.hostname):
        raise ValueError("Invalid admin HTTPS origin")
    raw = os.environ.get("FTP_SERVER", "").strip()
    if "://" not in raw:
        raw = "ftps://" + raw
    ftp_url = urlsplit(raw)
    if (ftp_url.scheme not in ("ftp", "ftps") or not ftp_url.hostname
            or ftp_url.username or ftp_url.password or ftp_url.port not in (None, 21)
            or ftp_url.path not in ("", "/") or ftp_url.query or ftp_url.fragment):
        raise ValueError("Expected FTP_SERVER hostname or FTPS explicit-TLS port 21")
    if not os.environ.get("FTP_USERNAME") or not os.environ.get("FTP_PASSWORD"):
        raise ValueError("Missing FTPS credentials")
    project_config = (SOURCE / "PTSCPS_DEPLOY_CONFIG.md").read_text(encoding="utf-8")
    if f"WordPress: https://{parsed.hostname}" not in project_config:
        raise ValueError("WC_URL must match PTSCPS WordPress domain in reviewed source")
    return ftp_url.hostname, f"/domains/{parsed.hostname}/public_html", parsed.hostname


def source_inventory() -> tuple[list[tuple[str, Path, str]], set[str], str]:
    if not (SOURCE / "wp-load.php").is_file() or not (SOURCE / "wp-admin").is_dir():
        raise ValueError("Complete WordPress source missing")
    proc = subprocess.run(["git", "-C", str(SOURCE), "ls-files", "-z"], check=True, capture_output=True)
    files = []
    dirs = set()
    for item in proc.stdout.split(b"\0"):
        if not item:
            continue
        rel = item.decode("utf-8")
        path = PurePosixPath(rel)
        if (path.is_absolute() or ".." in path.parts or "\\" in rel
                or any(rel.startswith(prefix) for prefix in EXCLUDE_PREFIXES)
                or rel in EXCLUDE_FILES or rel.startswith(".git/")
                or (rel.startswith(".") and rel != ".htaccess")):
            continue
        local = SOURCE.joinpath(*path.parts)
        if not local.is_file() or local.is_symlink():
            raise ValueError("Source contains missing file or symlink: " + rel)
        # One SHA can be used to ensure a resumed bootstrap uses the same source.
        files.append((rel, local, sha256(local.read_bytes()).hexdigest()))
        for i in range(1, len(path.parts)):
            dirs.add("/".join(path.parts[:i]))
    if len(files) < 30000 or not any(rel == "wp-includes/version.php" for rel, _, _ in files):
        raise ValueError("Unexpectedly incomplete WordPress checkout")
    head = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", head):
        raise ValueError("Invalid source SHA")
    return files, dirs, head


def connect(host: str) -> FTP_TLS:
    client = FTP_TLS(context=ssl.create_default_context(), timeout=FTP_TIMEOUT)
    client.connect(host, 21)
    client.auth()
    client.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
    client.prot_p()  # Encrypted control and data channel, CA/hostname verified.
    return client


def cd_exact(ftp: FTP_TLS, root: str) -> None:
    ftp.cwd(root)
    if ftp.pwd().rstrip("/") != root:
        raise RuntimeError("FTP docroot identity mismatch")


def size_or_none(ftp: FTP_TLS, name: str) -> int | None:
    ftp.voidcmd("TYPE I")
    try:
        return ftp.size(name)
    except error_perm as exc:
        if str(exc).startswith("550"):
            return None
        raise


def remote_hash(ftp: FTP_TLS, path: str) -> str:
    digest = sha256()
    ftp.retrbinary("RETR " + path, digest.update, blocksize=1024 * 256)
    return digest.hexdigest()


def guard(host: str, root: str, marker_bytes: bytes, deploy: bool) -> bool:
    ftp = connect(host)
    try:
        cd_exact(ftp, root)
        if size_or_none(ftp, "wp-config.php") is not None:
            raise RuntimeError("Existing wp-config.php detected: no bootstrap or database changes permitted")
        marker_exists = size_or_none(ftp, MARKER) is not None
        core_exists = any(size_or_none(ftp, n) is not None for n in ("wp-load.php", "wp-settings.php", "wp-login.php"))
        if marker_exists:
            if remote_hash(ftp, MARKER) != sha256(marker_bytes).hexdigest():
                raise RuntimeError("Foreign or stale bootstrap marker; do not overwrite")
        elif core_exists:
            raise RuntimeError("WordPress source already exists without PTSCPS marker; refusing overwrite")
        for dirname in ("wp-admin", "wp-includes"):
            try:
                ftp.cwd(dirname)
            except error_perm as exc:
                if not str(exc).startswith("550"):
                    raise
            else:
                if not marker_exists:
                    raise RuntimeError("Existing " + dirname + " directory: refusing initial bootstrap")
            finally:
                cd_exact(ftp, root)
        if deploy and not marker_exists:
            ftp.storbinary("STOR " + MARKER, BytesIO(marker_bytes))
            if remote_hash(ftp, MARKER) != sha256(marker_bytes).hexdigest():
                raise RuntimeError("Bootstrap marker readback failed")
        return marker_exists
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def make_directories(host: str, root: str, dirs: set[str]) -> None:
    ftp = connect(host)
    try:
        cd_exact(ftp, root)
        for d in sorted(dirs, key=lambda p: (p.count("/"), p)):
            try:
                ftp.mkd(d)
            except error_perm as exc:
                if not str(exc).startswith("550"):
                    raise
                # 550 can also mean permission denied: verify the path is a directory.
                ftp.cwd(d)
                cd_exact(ftp, root)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def upload_partition(host: str, root: str, jobs: list[tuple[str, Path, str]]) -> tuple[int, int]:
    ftp = connect(host)
    installed = unchanged = 0
    try:
        cd_exact(ftp, root)
        for rel, local, expected in jobs:
            old_size = size_or_none(ftp, rel)
            if old_size is not None:
                if old_size != local.stat().st_size or remote_hash(ftp, rel) != expected:
                    raise RuntimeError("Existing destination differs; refusing overwrite: " + rel)
                unchanged += 1
                continue
            tmp = rel + ".ptscps-" + secrets.token_hex(8) + ".tmp"
            try:
                with local.open("rb") as stream:
                    ftp.storbinary("STOR " + tmp, stream, blocksize=1024 * 256)
                if remote_hash(ftp, tmp) != expected:
                    raise RuntimeError("FTPS temporary checksum mismatch: " + rel)
                if size_or_none(ftp, rel) is not None:
                    raise RuntimeError("Destination appeared during upload: " + rel)
                ftp.rename(tmp, rel)
                if remote_hash(ftp, rel) != expected:
                    raise RuntimeError("FTPS activation checksum mismatch: " + rel)
                installed += 1
            finally:
                if size_or_none(ftp, tmp) is not None:
                    ftp.delete(tmp)
        return installed, unchanged
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("preflight", "deploy"))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 8:
        raise ValueError("Allowed FTPS workers: 1..8")
    host, root, admin_host = config()
    files, dirs, head = source_inventory()
    marker_bytes = MARKER_PREFIX + head.encode() + b" */ ?>\n"
    print(f"PTSCPS_WP_BOOTSTRAP_PREPARED source={head} files={len(files)} host={admin_host} no_astro=YES")
    existing_marker = guard(host, root, marker_bytes, args.mode == "deploy")
    print("PTSCPS_WP_FTPS_PREFLIGHT=PASS resumed=" + str(existing_marker))
    if args.mode == "preflight":
        print("PTSCPS_WP_BOOTSTRAP=DRY_RUN no_files_uploaded=YES")
        return
    make_directories(host, root, dirs)
    buckets = [files[i::args.workers] for i in range(args.workers)]
    total_installed = total_unchanged = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(upload_partition, host, root, jobs) for jobs in buckets if jobs]
        for future in as_completed(futures):
            added, same = future.result()
            total_installed += added
            total_unchanged += same
    if total_installed + total_unchanged != len(files):
        raise RuntimeError("Incomplete file coverage")
    ftp = connect(host)
    try:
        cd_exact(ftp, root)
        for required in ("wp-load.php", "wp-settings.php", "wp-admin/index.php", "wp-includes/version.php"):
            if size_or_none(ftp, required) is None:
                raise RuntimeError("Missing installed WordPress component: " + required)
        if size_or_none(ftp, "wp-config.php") is not None:
            raise RuntimeError("wp-config.php appeared during deployment: refusing completion")
        ftp.delete(MARKER)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()
    print(f"PTSCPS_WP_BOOTSTRAP=PASS added={total_installed} matching_existing={total_unchanged}")
    print("PTSCPS_WP_DATABASE=UNTOUCHED wp-config.php=UNTOUCHED uploads=UNTOUCHED astro=UNTOUCHED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("::error::PTSCPS WP bootstrap failed: " + str(error))
        raise SystemExit(1)
