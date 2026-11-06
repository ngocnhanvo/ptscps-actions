#!/usr/bin/env python3
"""Signed Astro ZIP deployment for PTSCPS. Uses the inherited SOURCE_REPO_PAT token.

verify: read-only readiness + signed target check, before FTP upload.
unpack: verify artifact identity, then POST an authenticated unzip instruction.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
from zipfile import ZipFile

READY = "PTSCPS_ASTRO_UNZIP_PROTOCOL=2"
ORIGIN_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*[a-z0-9]$")
TARGET_PATTERN = re.compile(r"^/domains/[A-Za-z0-9.-]+/public_html/$")


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Deploy endpoint unexpectedly redirected")


OPENER = build_opener(RejectRedirect)


class DeployHTTPError(RuntimeError):
    def __init__(self, status, detail):
        self.status = status
        try:
            data = json.loads(detail)
            self.error = data.get('error') if isinstance(data, dict) else None
        except (ValueError, TypeError):
            self.error = None
        super().__init__('Unpack server returned HTTP %s: %s' %
                         (status, self.error if isinstance(self.error, str) else 'unexpected response'))


def env_value(text, name):
    matches = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith(name + "="):
            value = line.split("=", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            matches.append(value)
    if len(matches) != 1 or not matches[0]:
        raise ValueError("Exactly one " + name + " must appear in ENV_FILE")
    return matches[0]


def validate_url(raw):
    parsed = urlsplit(raw)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.port not in (None, 443)
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("Expected an HTTPS origin URL without paths or query strings")
    host = parsed.hostname.lower()
    if not ORIGIN_PATTERN.fullmatch(host) or "." not in host or ".." in host:
        raise ValueError("Invalid domain name in ENV_FILE")
    return "https://" + parsed.netloc, host


def request(url, body=None, headers=None, timeout=20):
    method = "POST" if body is not None else "GET"
    req = Request(url, data=body, headers=headers or {}, method=method)
    try:
        with OPENER.open(req, timeout=timeout) as response:
            raw = response.read(4194305)
            if len(raw) > 4194304:
                raise RuntimeError("Signed deployment response exceeds size limit")
            return raw.decode("utf-8")
    except HTTPError as exc:
        detail = exc.read(1000).decode("utf-8", "replace")
        raise DeployHTTPError(exc.code, detail) from exc
    except URLError as exc:
        raise RuntimeError("Cannot reach unzip endpoint: %s" % exc.reason) from exc


def signed_post(endpoint, token, data, timeout):
    raw = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = hmac.new(token.encode("utf-8"), timestamp.encode("ascii") + b"\n" + raw, hashlib.sha256).hexdigest()
    response = request(
        endpoint,
        body=raw,
        headers={
            "Content-Type": "application/json",
            "X-Esc-Deploy-Timestamp": timestamp,
            "X-Esc-Deploy-Signature": signature,
        },
        timeout=timeout,
    )
    parsed = json.loads(response)
    if not isinstance(parsed, dict) or parsed.get("ok") is not True or parsed.get("protocol") != 2:
        raise RuntimeError("Server did not confirm signed unzip protocol v2")
    return parsed


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("verify", "manifest", "unpack"):
        raise ValueError("Usage: ptscps-remote-unzip.py verify|manifest|unpack")
    mode = sys.argv[1]
    config = os.environ["ENV_FILE"]
    client_url = env_value(config, "WC_URL_CLIENT")
    admin_url = env_value(config, "WC_URL")
    _, client_host = validate_url(client_url)
    backend, _ = validate_url(admin_url)
    # PTSCPS origin is WordPress-managed; a domain migration changes ENV_FILE,
    # not this deploy tool. The signed PTSCPS-only PHP endpoint verifies the
    # tenant, WordPress-managed frontend domain and FTP destination.
    if not backend or backend == client_url:
        raise ValueError("Invalid PTSCPS WordPress origin")
    ftp_target = os.environ["ASTRO_FTP_TARGET"].strip()
    derived = "/domains/%s/public_html/" % client_host
    if not TARGET_PATTERN.fullmatch(ftp_target) or ".." in ftp_target or "//" in ftp_target:
        raise ValueError("FTP destination must be an explicit website public_html path")
    explicit_override = os.environ.get("FTP_ASTRO_DIR", "").strip()
    # This path is configured per-project and must exactly correspond to the
    # WordPress-administered frontend origin. Never infer deployment from caller.
    if ftp_target != derived:
        raise ValueError("PTSCPS FTP target differs from configured frontend origin")
    token = os.environ["SOURCE_REPO_PAT"]
    if len(token) < 20:
        raise ValueError("Existing SOURCE_REPO_PAT is unavailable")
    common = {
        "host": client_host,
        "target": ftp_target,
        "allow_override": bool(explicit_override and ftp_target != derived),
    }

    if mode == "verify":
        marker = request(backend + "/ptscps-unzip-v2.ready", timeout=12).strip()
        if marker != READY:
            raise RuntimeError("unzip-v2.ready is missing or incorrect; deploy the PHP endpoint first")
        result = signed_post(backend + "/ptscps-unzip.php", token, {"action": "check", **common}, 30)
        if result.get("host") != client_host or result.get("target") != ftp_target:
            raise RuntimeError("Remote WordPress unzip target does not match the verified FTP target")
        print("SIGNED_UNZIP_PREFLIGHT_OK: %s" % ftp_target)
        return

    if mode == "manifest":
        # Existing v2 PHP may not yet support manifest. Only this one expected
        # compatibility response causes FULL ZIP fallback (never auth failure).
        Path("source/.ptscps-remote-image-manifest.json").unlink(missing_ok=True)
        try:
            result = signed_post(backend + "/ptscps-unzip.php", token,
                                 {"action": "image_manifest", **common}, 30)
        except DeployHTTPError as error:
            if (error.status == 400 and error.error == 'Invalid archive checksum') or (
                    error.status == 409 and error.error == 'Image manifest unavailable'):
                print("PTSCPS_IMAGE_DELTA=FULL_FALLBACK (remote manifest unavailable)")
                return
            raise
        if result.get("host") != client_host or result.get("target") != ftp_target:
            raise RuntimeError("Signed image inventory came from unexpected frontend")
        images = result.get("images")
        if not isinstance(images, dict) or len(images) > 5000:
            raise RuntimeError("Invalid signed image inventory")
        total = 0
        for name, meta in images.items():
            if not isinstance(name, str) or len(name) > 240:
                raise RuntimeError("Invalid image name")
            pieces = name.split("/")
            if (not all(re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", p)
                        and p not in (".", "..") for p in pieces) or
                    not isinstance(meta, dict) or type(meta.get("size")) is not int or
                    meta["size"] < 0 or meta["size"] > 26214400 or
                    not isinstance(meta.get("sha256"), str) or
                    not re.fullmatch("[0-9a-f]{64}", meta["sha256"])):
                raise RuntimeError("Invalid signed image inventory item")
            total += meta["size"]
            if total > 524288000:
                raise RuntimeError("Signed image inventory too large")
        inventory = {"images": images}
        # The signed PHP inventory may optionally include client-only HTML,
        # CSS, JS and public JSON. Older PHP has no 'static' key: full ZIP fallback.
        static = result.get("static")
        if static is not None:
            if not isinstance(static, dict) or len(static) > 5000:
                raise RuntimeError("Invalid signed static inventory")
            static_bytes = 0
            for name, meta in static.items():
                if (not isinstance(name, str) or len(name) > 240 or name == "index.html" or name.startswith("images/")
                    or not re.search(r"\.(?:html|css|js|json)$", name)):
                    raise RuntimeError("Invalid signed static asset name")
                pieces = name.split("/")
                if (not all(re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", p)
                            and p not in (".", "..") for p in pieces)
                    or not isinstance(meta, dict) or type(meta.get("size")) is not int
                    or meta["size"] < 0 or meta["size"] > 26214400
                    or not isinstance(meta.get("sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", meta["sha256"])):
                    raise RuntimeError("Invalid signed static asset digest")
                static_bytes += meta["size"]
                if static_bytes > 104857600:
                    raise RuntimeError("Signed static inventory too large")
            inventory["static"] = static
            print("PTSCPS_STATIC_DELTA_REMOTE_FILES=%d remote_bytes=%d" %
                  (len(static), static_bytes))
        target_file = Path("source/.ptscps-remote-image-manifest.json")
        if not target_file.parent.is_dir():
            raise RuntimeError("Expected checked-out production source directory")
        target_file.write_text(json.dumps(inventory, sort_keys=True),
                               encoding="utf-8")
        print("PTSCPS_IMAGE_DELTA_REMOTE_IMAGES=%d remote_bytes=%d" % (len(images), total))
        return

    archive = Path(os.environ.get("ZIP_PATH", "source/upload/ptscps-astro.zip"))
    if not archive.is_file():
        raise ValueError("No Astro deployment ZIP exists")
    # Archived recovery ZIPs from a previous domain must not be deployed to a new domain.
    with ZipFile(archive) as zf:
        staging = os.environ.get("PTSCPS_STAGING_SOURCE") == "github"
        production = os.environ.get("PTSCPS_PRODUCTION_SOURCE") == "master"
        if staging and production:
            raise ValueError("Ambiguous PTSCPS deployment source")
        if staging or production:
            # Both modern deployment paths are credential-free signed ZIPs.
            # The marker name remains compatible with the existing PHP
            # atomic activation and sitemap revision hand-off protocol.
            if ".env" in zf.namelist():
                raise ValueError("Refusing PTSCPS deploy archive containing public-root .env")
            manifest = json.loads(zf.read("ptscps-staging-build.json").decode("utf-8"))
            expected_branch = "master" if production else "github"
            commit = os.environ.get("PTSCPS_DEPLOY_COMMIT" if production else "PTSCPS_STAGING_COMMIT", "")
            if (manifest.get("branch") != expected_branch
                    or manifest.get("commit") != commit
                    or not re.fullmatch(r"[0-9a-f]{40}", commit)
                    or manifest.get("target") != client_host
                    or ftp_target != derived):
                raise ValueError("Unsigned or mismatched PTSCPS source provenance")
        else:
            packaged_env = zf.read(".env").decode("utf-8")
            packaged_url = env_value(packaged_env, "WC_URL_CLIENT")
            if validate_url(packaged_url)[1] != client_host:
                raise ValueError("Archived ZIP was built for a different frontend domain")
        if "server/entry.mjs" not in zf.namelist():
            raise ValueError("Deployment ZIP is missing Astro server entry")
        if "client/index.html" not in zf.namelist():
            raise ValueError("Deployment ZIP missing Astro client index")
        has_delta = any(name in zf.namelist() for name in
                        ('ptscps-image-delta.json', 'ptscps-static-delta.json'))
    sha = hashlib.sha256()
    with archive.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            sha.update(chunk)
    expected = sha.hexdigest()
    result = signed_post(backend + "/ptscps-unzip.php", token, {
        "action": "unpack_delta" if has_delta else "unpack", **common, "sha256": expected,
    }, 180)
    if (result.get("host") != client_host or result.get("target") != ftp_target
            or result.get("sha256") != expected or result.get("files_activated", 0) < 2):
        raise RuntimeError("Unzip response did not match the uploaded deployment package")
    print("SIGNED_UNZIP_SUCCESS: target=%s files=%s" % (ftp_target, result["files_activated"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("::error::Signed unzip failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
