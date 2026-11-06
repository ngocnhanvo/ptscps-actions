#!/usr/bin/env python3
"""PTSCPS Visual Builder-only FTPS release: exact PHP source, verified rollback.

Does not touch the Astro frontend, other WordPress plugins, CMS content or DB.
"""
from __future__ import annotations

import ftplib
import hashlib
import io
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
from urllib.parse import urlsplit

PLUGIN = "wp-content/plugins/esc-visual-builder"
SOURCE = Path("source-php") / PLUGIN
FILES = (
    "includes/change-index.php",
    "includes/image-editor-ui.php",
    "includes/image-editor.php",
    "includes/item-manager.php",
    "includes/item-section-ui.php",
    "includes/page-image.php",
    "includes/page-text.php",
    "includes/section-order.php",
    "includes/shared-footer-assets-ui.php",
    "includes/shared-footer-assets.php",
    "includes/shared-footer-media-ui.php",
    "includes/shared-footer-media.php",
    "includes/shared-footer-ui.php",
    "includes/shared-footer.php",
    "includes/shared-menu-ui.php",
    "includes/shared-menu.php",
    "includes/shared-preview.php",
    "includes/site-config.php",
    "includes/text-editor-ui.php",
    "includes/text-editor.php",
    # Main entrypoint activates the new include graph ONLY after files exist.
    "esc-visual-builder.php",
)

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def parse_origin() -> str:
    values = []
    for line in os.environ.get("ENV_FILE", "").splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?WC_URL\s*=\s*(.*?)\s*", line)
        if match:
            values.append(match.group(1).strip().strip("'\""))
    if len(values) != 1:
        raise RuntimeError("Missing or ambiguous WordPress origin")
    u = urlsplit(values[0])
    if not (u.scheme == "https" and u.hostname and u.port in (None, 443)
            and u.path in ("", "/") and not u.username and not u.password
            and not u.query and not u.fragment):
        raise RuntimeError("Invalid WordPress origin")
    return "/domains/" + u.hostname + "/public_html"

def main() -> None:
    expected_sha = os.environ.get("PTSCPS_PHP_SOURCE_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        raise RuntimeError("Invalid pinned PHP commit")
    actual_sha = subprocess.check_output(['git','-C','source-php','rev-parse','HEAD'],text=True).strip()
    if actual_sha != expected_sha:
        raise RuntimeError("PHP source differs from pinned release")
    # The tests/ directory is intentionally NOT deployed. Audit only the
    # plugin entrypoint and executable include graph.
    files_on_disk = {"esc-visual-builder.php"} | {
        "includes/" + p.name for p in (SOURCE / "includes").glob("*.php")
    }
    if files_on_disk != set(FILES):
        raise RuntimeError("Visual Builder manifest does not match source tree")
    for name in FILES:
        if not (SOURCE / name).is_file() or (SOURCE / name).stat().st_size == 0:
            raise RuntimeError("Missing Visual Builder code file: " + name)
    entry = (SOURCE / "esc-visual-builder.php").read_text(encoding="utf-8")
    for include in FILES[:-1]:
        if ("'/"+include+"'") in entry:
            # A legacy literal include format is permitted.
            continue
        if ("'/"+include.replace("includes/", "includes/")+"'") not in entry and (
            "'" + "/" + include + "'" not in entry
        ):
            # The entrypoint uses '/includes/<file>' in require_once lines.
            raise RuntimeError("Builder entrypoint omits dependency: " + include)
    if "esc-builder/v1" not in entry:
        raise RuntimeError("Unexpected Visual Builder entrypoint")

    raw = os.environ.get("FTP_SERVER", "").strip()
    if "://" not in raw:
        raw = "ftp://" + raw
    u = urlsplit(raw)
    if not (u.scheme in ("ftp", "ftps") and u.hostname and u.port in (None, 21)
            and not u.username and not u.password and not u.path.strip("/")
            and not u.query and not u.fragment):
        raise RuntimeError("Invalid FTPS server")
    if not os.environ.get("FTP_USERNAME") or not os.environ.get("FTP_PASSWORD"):
        raise RuntimeError("Missing FTPS credentials")

    docroot = parse_origin()
    root = docroot + "/" + PLUGIN
    client = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=35)
    token = secrets.token_hex(8)
    items = []
    changed = []
    try:
        client.connect(u.hostname, u.port or 21)
        client.auth()
        client.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
        client.prot_p()

        def cwd(folder: str) -> None:
            client.cwd(folder)
            if client.pwd().rstrip("/") != folder.rstrip("/"):
                raise RuntimeError("FTPS path identity mismatch")

        def exists(name: str) -> bool:
            client.voidcmd("TYPE I")
            try:
                client.size(name)
                return True
            except ftplib.error_perm as error:
                if str(error).startswith("550"):
                    return False
                raise

        def read(name: str) -> bytes:
            out = io.BytesIO()
            client.retrbinary("RETR " + name, out.write)
            return out.getvalue()

        def remove(name: str) -> None:
            if exists(name):
                client.delete(name)

        cwd(docroot)
        if not exists("wp-load.php"):
            raise RuntimeError("Wrong WordPress document root")
        cwd(root)
        if not exists("esc-visual-builder.php"):
            raise RuntimeError("Builder plugin does not exist on target")
        existing = read("esc-visual-builder.php")
        if b"Plugin Name:" not in existing or b"Visual Builder" not in existing:
            raise RuntimeError("Remote plugin identity mismatch")
        print("PTSCPS_BUILDER_FTPS identity=PASS tls=PASS plugin=PASS")

        # Stage *every* changed file before activating anything. The current
        # entrypoint remains live until all dependencies have been activated.
        for rel in FILES:
            folder = root + "/" + str(Path(rel).parent).replace("\\", "/")
            if folder.endswith("/."):
                folder = root
            cwd(folder)
            name = Path(rel).name
            data = (SOURCE / rel).read_bytes()
            digest = sha(data)
            if exists(name) and sha(read(name)) == digest:
                print("PTSCPS_BUILDER_FTPS unchanged=" + rel)
                continue
            tmp = ".ptscps-builder-" + token + "-" + name + ".stage"
            backup = ".ptscps-builder-" + token + "-" + name + ".backup"
            if exists(tmp) or exists(backup):
                raise RuntimeError("Temporary FTPS filename collision")
            item = dict(folder=folder, name=name, rel=rel, tmp=tmp, backup=backup,
                        had_original=False, activated=False, digest=digest, original_digest=None)
            items.append(item)
            client.storbinary("STOR " + tmp, io.BytesIO(data))
            if sha(read(tmp)) != digest:
                raise RuntimeError("Staging checksum mismatch")
        print("PTSCPS_BUILDER_FTPS staging=PASS files=" + str(len(items)))

        for item in items:
            cwd(item["folder"])
            item["had_original"] = exists(item["name"])
            if item["had_original"]:
                item["original_digest"] = sha(read(item["name"]))
                client.rename(item["name"], item["backup"])
            client.rename(item["tmp"], item["name"])
            item["activated"] = True
            if sha(read(item["name"])) != item["digest"]:
                raise RuntimeError("Activated checksum mismatch")
            changed.append(item["rel"])
            print("PTSCPS_BUILDER_FTPS activated=" + item["rel"] + " sha256=PASS")

        # Cleanup is post-activation. On a cleanup problem, preserve the
        # remaining backups and report that manual cleanup is necessary.
        cleanup_errors = 0
        for item in items:
            cwd(item["folder"])
            if item["had_original"] and exists(item["backup"]):
                try:
                    client.delete(item["backup"])
                except ftplib.all_errors:
                    cleanup_errors += 1
        print("PTSCPS_BUILDER_FTPS result=PASS source_sha=" + expected_sha +
              " changed=" + str(len(changed)) +
              " checked=" + str(len(FILES)) +
              " cleanup_pending=" + str(cleanup_errors))
        print("PTSCPS_BUILDER_FTPS NO_ASTRO_BUILD=PASS NO_CMS_WRITE=PASS")
        if cleanup_errors:
            raise SystemExit("PTSCPS_BUILDER_FTPS cleanup_manual_review_required")
    except BaseException as e:
        # Never delete a good live file after successful activation merely
        # because optional backup cleanup failed.
        if len(changed) == len(items):
            raise
        print("PTSCPS_BUILDER_FTPS activation_failed rollback=BEGIN error_class=" +
              type(e).__name__)
        rollback_ok = True
        for item in reversed(items):
            try:
                cwd(item["folder"])
                if item["had_original"] and exists(item["backup"]):
                    remove(item["name"])
                    client.rename(item["backup"], item["name"])
                    if sha(read(item["name"])) != item["original_digest"]:
                        raise RuntimeError("Rollback readback mismatch")
                elif item["activated"]:
                    remove(item["name"])
                remove(item["tmp"])
            except Exception:
                rollback_ok = False
        print("PTSCPS_BUILDER_FTPS rollback=" + ("PASS" if rollback_ok else "PARTIAL"))
        raise
    finally:
        try:
            client.quit()
        except Exception:
            client.close()

if __name__ == "__main__":
    main()
