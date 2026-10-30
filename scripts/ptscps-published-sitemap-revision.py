#!/usr/bin/env python3
"""Read only the last *deployed revision token* via PTSCPS staging FTP-TLS.

A 200-byte deployment provenance JSON is queried, not sitemap.xml. This avoids
public HTTP rewrites/caches when deciding if WP Save happened since build.
"""
import ftplib
import io
import json
import os
import re
from urllib.parse import urlparse

TARGET = "ptscps-staging-build.json"


def main():
    for key in ("FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD"):
        if not os.environ.get(key):
            raise RuntimeError("Missing PTSCPS staging FTPS credential: " + key)
    address = os.environ["FTP_SERVER"]
    parts = urlparse(address if "://" in address else "ftps://" + address)
    if not parts.hostname:
        raise RuntimeError("Invalid FTPS hostname")
    client_host = os.environ["PTSCPS_CLIENT_HOST"]
    target_dir = os.environ["ASTRO_FTP_TARGET"].rstrip("/")
    if target_dir != "/domains/" + client_host + "/public_html":
        raise RuntimeError("PTSCPS target must match approved WordPress frontend")
    import ssl
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
    try:
        ftp.connect(parts.hostname, parts.port or 21, timeout=25)
        ftp.auth()
        ftp.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
        ftp.prot_p()
        ftp.cwd(target_dir)
        if ftp.pwd().rstrip("/") != target_dir:
            raise RuntimeError("PTSCPS FTP PWD differs from exact approved target")
        buffer = io.BytesIO()
        try:
            ftp.retrbinary("RETR " + TARGET, buffer.write)
        except ftplib.error_perm as error:
            if not str(error).startswith("550"):
                raise
            # First deployment may legitimately lack provenance.
            previous = "missing"
        else:
            if buffer.tell() > 4096:
                raise RuntimeError("Unexpectedly large public deployment metadata")
            metadata = json.loads(buffer.getvalue())
            source_branch = os.environ.get("PTSCPS_DEPLOY_SOURCE_BRANCH", "github")
            if source_branch not in ("github", "master"):
                raise RuntimeError("Unexpected PTSCPS deploy branch")
            # First production deployment may follow a verified development
            # release, while subsequent production deployments use master.
            permitted = ("github", "master") if source_branch == "master" else ("github",)
            if metadata.get("branch") not in permitted or \
                    metadata.get("target") != client_host:
                raise RuntimeError("PTSCPS deployed marker source/host mismatch")
            previous = metadata.get("sitemap_revision") or "missing"
            if previous != "missing" and previous != "legacy" and \
                    re.fullmatch(r"[a-f0-9-]{36}", str(previous)) is None:
                raise RuntimeError("Invalid existing sitemap token")
        # UUID contains no credentials; never export file contents or XML.
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf8") as output:
            output.write("PTSCPS_PUBLISHED_SITEMAP_REVISION=" + str(previous) + "\n")
        print("PASS: verified published PTSCPS sitemap revision marker using FTPS only; " +
              ("already deployed" if previous != "missing" else "legacy/initial deployment"))
    finally:
        try:
            ftp.quit()
        except ftplib.all_errors:
            pass


if __name__ == "__main__":
    main()
