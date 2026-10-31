#!/usr/bin/env python3
"""Public WordPress content inventory for an auditable PTSCPS migration.

Read-only: no login, no POST requests, no writes to either website.
The complete per-record manifest and migration candidates are stored as artifacts.
"""
import argparse
import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlencode
from urllib.request import Request, urlopen

ROOT_COLLECTIONS = ("pages", "posts", "categories", "tags", "media")
MAX_PER_COLLECTION = 3000


def canonical_origin(url: str) -> str:
    value = urlparse(url.strip())
    if (value.scheme != "https" or not value.hostname or value.username or value.password
            or value.port not in (None, 443) or value.path not in ("", "/")
            or value.query or value.fragment):
        raise ValueError("Expected an HTTPS origin without credentials, port, path, or query")
    return "https://" + value.hostname.lower()


def read_env_origin(raw: str, name: str) -> str:
    values = {}
    for line in raw.splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"\'')
    if not values.get(name):
        raise ValueError("Missing " + name + " in ENV_FILE")
    return canonical_origin(values[name])


def wp_get(origin: str, path: str):
    """Fail closed on cross-host redirects, invalid REST and oversized responses."""
    request = Request(origin + path, headers={
        "Accept": "application/json",
        "User-Agent": "PTSCPS-Migration-Inventory/1.0 (read-only)",
    })
    with urlopen(request, timeout=35) as response:
        target = urlparse(response.geturl())
        if target.scheme != "https" or target.hostname != urlparse(origin).hostname:
            raise ValueError("Cross-origin redirect was rejected")
        if response.status != 200:
            raise ValueError("Unexpected REST response status: " + str(response.status))
        data = response.read(12_000_001)
        if len(data) > 12_000_000:
            raise ValueError("Oversized REST response (12 MB limit)")
        result = json.loads(data)
        total_pages = int(response.headers.get("X-WP-TotalPages", "1"))
        total = int(response.headers.get("X-WP-Total", "0"))
    return result, total_pages, total


def collect(origin: str, collection: str):
    if collection not in ROOT_COLLECTIONS:
        raise ValueError("Unsupported collection")
    records, page = [], 1
    allowed_fields = {
        "pages": "id,slug,status,type,link,date,date_gmt,modified,parent,title,excerpt,content,featured_media,menu_order,template,lang,translations,meta",
        "posts": "id,slug,status,type,link,date,date_gmt,modified,title,excerpt,content,featured_media,categories,tags,lang,translations,meta",
        "categories": "id,count,description,link,name,slug,parent",
        "tags": "id,count,description,link,name,slug",
        "media": "id,slug,date,title,source_url,mime_type,alt_text,caption,description,media_details,post",
    }
    total = 0
    while True:
        query = urlencode({"per_page": 100, "page": page, "_fields": allowed_fields[collection]})
        batch, max_pages, total = wp_get(origin, "/wp-json/wp/v2/" + collection + "?" + query)
        if not isinstance(batch, list):
            raise ValueError("WordPress collection is not an array: " + collection)
        records.extend(batch)
        if len(records) > MAX_PER_COLLECTION:
            raise ValueError("Safety limit exceeded for " + collection)
        if page >= max_pages or not batch:
            break
        page += 1
    return {"items": records, "wp_total": total, "count": len(records), "pages_fetched": page}


def strip_title(value):
    if isinstance(value, dict):
        value = value.get("rendered", "")
    return html.unescape(re.sub(r"<[^>]*>", "", str(value or ""))).strip()


def migration_candidates(source):
    """Prepare reviewable items, never invent taxonomy, media IDs or publish state."""
    output = []
    for kind in ("pages", "posts"):
        for record in source.get(kind, {}).get("items", []):
            content = record.get("content", {})
            body = content.get("rendered", "") if isinstance(content, dict) else ""
            output.append({
                "source_type": kind[:-1],
                "source_id": record.get("id"),
                "source_url": record.get("link"),
                "slug": record.get("slug"),
                "title": strip_title(record.get("title")),
                "original_date_gmt": record.get("date_gmt"),
                "parent_source_id": record.get("parent") if kind == "pages" else None,
                "category_source_ids": record.get("categories", []) if kind == "posts" else [],
                "featured_media_source_id": record.get("featured_media", 0),
                "html_rendered": body,
                "needs_review": ["Original editor layout/shortcodes and linked assets require inspection",
                                 "WordPress category/media/parent IDs must be remapped before import"],
                "target_status": "draft",
                "import_state": "NOT_STARTED",
            })
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", default="migration-output")
    args = parser.parse_args()
    source_url = canonical_origin(args.source)
    target_url = canonical_origin(args.target)
    if source_url == target_url:
        parser.error("Source and target must differ")
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source_origin": source_url,
        "target_origin": target_url,
        "mode": "READ_ONLY",
        "source": {},
        "target": {},
        "errors": [],
    }
    for role, origin in (("source", source_url), ("target", target_url)):
        try:
            root, _, _ = wp_get(origin, "/wp-json/")
            if not isinstance(root, dict) or not isinstance(root.get("routes"), dict):
                raise ValueError("Invalid WordPress REST API index")
            # Some installations omit namespaces from the API index. Access to
            # actual wp/v2 collections below is the authoritative capability test.
            manifest[role]["site_name"] = root.get("name", "")
            for collection in ROOT_COLLECTIONS:
                try:
                    manifest[role][collection] = collect(origin, collection)
                except (HTTPError, URLError, ValueError, TimeoutError) as exc:
                    message = f"{role}/{collection}: {type(exc).__name__} {str(exc)[:200]}"
                    manifest["errors"].append(message)
        except (HTTPError, URLError, ValueError, TimeoutError) as exc:
            manifest["errors"].append(f"{role}/root: {type(exc).__name__} {str(exc)[:200]}")

    candidates = migration_candidates(manifest["source"])
    # Store all public records without synthesizing missing source fields.
    (folder / "wordpress-inventory.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "migration-draft-plan.json").write_text(json.dumps({
        "mode": "PLAN_ONLY", "target_status": "draft", "items": candidates
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {role: {key: manifest[role].get(key, {}).get("count", "ERROR")
                     for key in ROOT_COLLECTIONS} for role in ("source", "target")}
    summary = {"source": source_url, "target": target_url, "counts": counts,
               "candidates": len(candidates), "imported": 0, "errors": manifest["errors"]}
    (folder / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("INVENTORY_COUNTS=" + json.dumps(counts, ensure_ascii=False))
    print("IMPORT_NOT_STARTED candidates=" + str(len(candidates)))
    if manifest["errors"]:
        for error in manifest["errors"]:
            print("INVENTORY_WARNING " + error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
