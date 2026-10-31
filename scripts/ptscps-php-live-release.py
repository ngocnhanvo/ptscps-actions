#!/usr/bin/env python3
"""Install only PTSCPS's GitHub Trigger + signed unzip PHP via verified FTPS.

One-shot release: input is checked-out ptscps-php/master, target is the validated
PTSCPS WordPress docroot. STOR temporary + verified readback; old files are renamed
to rollback backups before atomic activation. Never touch Astro/frontend root.
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
from urllib.parse import urlsplit

SOURCE = Path("source-php")
DEFAULT_FILES = (
    "ptscps-unzip.php",
    "ptscps-unzip-v2.ready",
    "wp-content/mu-plugins/esc-github-trigger-config.php",
    "wp-content/mu-plugins/esc-seo-files.php",
    "wp-content/plugins/github-trigger/vcs-build-trigger.php",
    "wp-content/plugins/github-trigger/vcs-build-trigger.js",
)
FILES = (
    "wp-content/mu-plugins/ptscps-folders-accurate-counts.php",
) if os.environ.get("PTSCPS_FOLDERS_ONLY") == "1" else DEFAULT_FILES

raw = os.environ.get("FTP_SERVER", "").strip()
if "://" not in raw:
    raw = "ftp://" + raw
u = urlsplit(raw)
assert u.hostname and u.scheme in ("ftp", "ftps") and u.port in (None,21)
assert not u.username and not u.password and not u.path.strip("/")
assert os.environ.get("FTP_USERNAME") and os.environ.get("FTP_PASSWORD")
env = os.environ.get("ENV_FILE", "")
vals = {}
for line in env.splitlines():
    line = line.strip()
    if line.startswith("export "):
        line=line[7:].strip()
    if line.startswith("WC_URL="):
        vals["WC_URL"]=line.split("=",1)[1].strip().strip("'\"")
base=urlsplit(vals.get("WC_URL",""))
assert base.scheme=="https" and base.hostname and base.port in (None,443) and base.path in ("","/")
assert not base.query and not base.fragment and not base.username and not base.password
root=f"/domains/{base.hostname}/public_html"
for name in FILES:
    assert (SOURCE/name).is_file() and (SOURCE/name).stat().st_size>0, name
assert (SOURCE/"ptscps-unzip-v2.ready").read_text().strip()=="PTSCPS_ASTRO_UNZIP_PROTOCOL=2"
trigger_php = (SOURCE / "wp-content/plugins/github-trigger/vcs-build-trigger.php").read_text()
assert "VCS_GH_REPO" in trigger_php
assert "nghiencuukhoahoc-actions" not in trigger_php

ftp=ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
id=secrets.token_hex(8)
processed=[]
def in_dir(directory):
    ftp.cwd(directory)
    actual=ftp.pwd().rstrip("/")
    if actual!=directory.rstrip("/"):
        raise RuntimeError("Remote folder mismatch (abort without write)")
def exists(name):
    ftp.voidcmd("TYPE I")
    try:
        ftp.size(name)
        return True
    except ftplib.error_perm as e:
        if str(e).startswith("550"):
            return False
        raise
def remote_hash(name):
    target=io.BytesIO()
    ftp.retrbinary("RETR "+name,target.write)
    return hashlib.sha256(target.getvalue()).hexdigest()
def delete_if_exists(name):
    if exists(name):
        ftp.delete(name)

try:
    ftp.connect(u.hostname,u.port or 21)
    ftp.auth()
    ftp.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
    ftp.prot_p()
    in_dir(root)
    for required in ("wp-load.php","wp-admin","wp-content"):
        # wp-load.php must be readable, WordPress dirs navigable.
        if required.endswith(".php"):
            assert exists(required), "PTSCPS WordPress root not recognized"
        else:
            in_dir(root+"/"+required)
            in_dir(root)
    print("PTSCPS_PHP_RELEASE tls=PASS identity=PASS wp_docroot=PASS")

    for rel in FILES:
        directory=root+"/"+str(Path(rel).parent).replace("\\","/")
        if directory.endswith("/."):directory=root
        in_dir(directory)
        name=Path(rel).name
        b=(SOURCE/rel).read_bytes()
        digest=hashlib.sha256(b).hexdigest()
        if exists(name) and remote_hash(name)==digest:
            print("PTSCPS_PHP_RELEASE unchanged="+rel)
            continue
        tmp=f".ptscps-release-{id}-{name}.tmp"
        bak=f".ptscps-release-{id}-{name}.backup"
        assert not exists(tmp) and not exists(bak), "Unexpected release tmp/backup collision"
        entry={"dir":directory,"name":name,"tmp":tmp,"bak":bak,"was_there":False,"activated":False}
        processed.append(entry)
        ftp.storbinary("STOR "+tmp,io.BytesIO(b))
        assert remote_hash(tmp)==digest, "FTP temporary readback differs"
        entry["was_there"]=exists(name)
        if entry["was_there"]:
            ftp.rename(name,bak)
        ftp.rename(tmp,name)
        entry["activated"]=True
        assert remote_hash(name)==digest, "FTP activation hash mismatch"
        print("PTSCPS_PHP_RELEASE installed="+rel+" sha256_verified=PASS")
    # Only after ALL activated and verified, remove rollback backups.
    for ent in processed:
        in_dir(ent["dir"])
        if ent["was_there"]:
            ftp.delete(ent["bak"])
    print("PTSCPS_PHP_RELEASE completed=PASS files_checked="+str(len(FILES)))
    print("PTSCPS_PHP_RELEASE no_astro_build=PASS")
except BaseException as err:
    print("PTSCPS_PHP_RELEASE FAILED; restoring previous PHP files where possible")
    rollback_ok=True
    for ent in reversed(processed):
        try:
            in_dir(ent["dir"])
            if ent["was_there"] and exists(ent["bak"]):
                delete_if_exists(ent["name"])
                ftp.rename(ent["bak"],ent["name"])
            elif ent["activated"]:
                delete_if_exists(ent["name"])
            delete_if_exists(ent["tmp"])
        except Exception:
            rollback_ok=False
    print("PTSCPS_PHP_RELEASE rollback="+("PASS" if rollback_ok else "PARTIAL_MANUAL_REVIEW_REQUIRED"))
    print("PTSCPS_PHP_RELEASE error_class="+type(err).__name__)
    raise SystemExit(1)
finally:
    try:ftp.quit()
    except Exception:ftp.close()
