#!/usr/bin/env python3
"""PTSCPS: deterministic WordPress migration staging from a verified inventory.

Dry run is the default. A one-record draft pilot must pass all dependency,
backup-proof and authentication checks. No deletes, edits or publishing.
"""
import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

SOURCE = 'https://ptscps.com.vn'
MAX_BODY = 1_000_000


def origin(value):
    u = urlsplit(value.strip())
    if (u.scheme != 'https' or not u.hostname or u.username or u.password
            or u.port not in (None, 443) or u.path not in ('', '/')
            or u.query or u.fragment):
        raise ValueError('Expected bare HTTPS origin')
    return 'https://' + u.hostname.lower()


def env_target(raw):
    values = {}
    for line in raw.splitlines():
        m = re.match(r'^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$', line)
        if m:
            values[m.group(1)] = m.group(2).strip().strip('"\'')
    return origin(values['WC_URL'])


def request(target, path, user=None, password=None, data=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'PTSCPS-Migration-Pilot/1.0'}
    if user and password:
        token = base64.b64encode((user + ':' + password).encode()).decode()
        headers['Authorization'] = 'Basic ' + token
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(target + path, data=(json.dumps(data, ensure_ascii=False).encode()
                                   if data is not None else None), headers=headers)
    with urlopen(req, timeout=35) as response:
        if origin(response.geturl().split('/wp-json/')[0]) != target:
            raise ValueError('Cross-site API redirect rejected')
        if response.status not in (200, 201):
            raise ValueError('Unexpected HTTP status: ' + str(response.status))
        raw = response.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise ValueError('Oversized API reply')
    return json.loads(raw)


def reasons(record, source, target):
    kind = record['source_type']
    errors = []
    if kind not in ('page', 'post') or not isinstance(record.get('source_id'), int):
        errors.append('invalid_source_identity')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', str(record.get('slug', ''))):
        errors.append('invalid_slug')
    if not record.get('title') or not record.get('original_date_gmt'):
        errors.append('missing_title_or_date')
    if record.get('featured_media_source_id'):
        errors.append('featured_media_not_mapped')
    if record.get('parent_source_id'):
        errors.append('page_parent_not_mapped')
    if record.get('category_source_ids'):
        errors.append('post_categories_not_mapped')
    html = record.get('html_rendered', '')
    if not isinstance(html, str) or len(html.encode('utf-8')) > 600_000:
        errors.append('invalid_or_oversized_content')
    elif re.search(r'<(?:img|video|audio|iframe|source|script)\b|(?:src|srcset)\s*=|\[\w+[^]]*\]|(?:https?:)?//', html, re.I):
        errors.append('embedded_media_shortcodes_or_external_links_need_review')
    if kind == 'post' and not record.get('category_source_ids'):
        errors.append('post_category_missing')
    if record.get('source_url') and not str(record['source_url']).startswith(source + '/'):
        errors.append('source_url_mismatch')
    return errors


def assert_backup_receipt(path, target):
    if not path:
        raise ValueError('Missing independent backup + restore verification receipt')
    doc = json.loads(Path(path).read_text(encoding='utf8'))
    if (doc.get('target_origin') != target or doc.get('restore_tested') is not True
            or not re.fullmatch(r'[a-f0-9]{64}', str(doc.get('backup_sha256', '')))
            or not doc.get('restore_tested_utc') or not doc.get('backup_location')):
        raise ValueError('Backup/restore receipt incomplete or wrong target')
    stamp = datetime.fromisoformat(doc['restore_tested_utc'].replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds()
    if not 0 <= age <= 7 * 86400:
        raise ValueError('Restore verification older than 7 days or in future')
    # A receipt is an operator attestation; it cannot independently prove restore.


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--inventory', required=True)
    ap.add_argument('--target', required=True)
    ap.add_argument('--mode', choices=('dry-run', 'pilot'), default='dry-run')
    ap.add_argument('--source-id', type=int)
    ap.add_argument('--backup-receipt')
    ap.add_argument('--report', default='migration-stage-report.json')
    args = ap.parse_args()
    target = origin(args.target)
    data = json.loads(Path(args.inventory).read_text(encoding='utf8'))
    if data.get('mode') != 'PLAN_ONLY' or data.get('target_status') != 'draft':
        raise ValueError('Inventory mode/status mismatch')
    items = data['items']
    if len(items) != 345 or len({(x['source_type'], x['source_id']) for x in items}) != len(items):
        raise ValueError('Unexpected count or duplicate source identities')
    classifications = []
    for x in items:
        blockers = reasons(x, SOURCE, target)
        classifications.append({'type': x['source_type'], 'source_id': x['source_id'],
                                'slug': x['slug'], 'state': 'READY_FOR_PILOT' if not blockers else 'NEEDS_REVIEW',
                                'blockers': blockers})
    result = {'mode': args.mode, 'source': SOURCE, 'target': target,
              'candidates': len(items), 'ready_for_pilot': sum(not v['blockers'] for v in classifications),
              'imported': 0, 'records': classifications}
    if args.mode == 'pilot':
        if args.source_id is None:
            raise ValueError('Pilot requires explicit source ID')
        chosen = [(x, c) for x, c in zip(items, classifications) if x['source_id'] == args.source_id]
        if len(chosen) != 1 or chosen[0][1]['blockers']:
            raise ValueError('Chosen source ID missing, ambiguous or has unresolved dependencies')
        user = os.getenv('WP_APPLICATION_USER', '')
        password = os.getenv('WP_APPLICATION_PASSWORD', '')
        if not user or not password:
            raise ValueError('Missing WordPress Application Password credentials')
        assert_backup_receipt(args.backup_receipt, target)
        x, c = chosen[0]
        collection = 'pages' if x['source_type'] == 'page' else 'posts'
        slug = quote(x['slug'], safe='')
        found = request(target, '/wp-json/wp/v2/' + collection + '?context=edit&status=any&slug=' + slug,
                        user, password)
        if found:  # Do not overwrite existing slug or silently declare it migrated.
            raise ValueError('Target slug already exists; manual origin-ID reconciliation required')
        payload = {'status': 'draft', 'title': x['title'], 'slug': x['slug'],
                   'content': x['html_rendered'], 'date_gmt': x['original_date_gmt']}
        created = request(target, '/wp-json/wp/v2/' + collection, user, password, payload)
        if created.get('status') != 'draft' or not isinstance(created.get('id'), int):
            raise ValueError('Created record not confirmed as draft')
        fetched = request(target, '/wp-json/wp/v2/' + collection + '/' + str(created['id']) + '?context=edit',
                          user, password)
        if (fetched.get('status') != 'draft' or fetched.get('slug') != x['slug']
                or fetched.get('title', {}).get('raw') != x['title']):
            raise ValueError('Read-after-write verification FAILED; do not retry blindly')
        c.update(state='IMPORTED_DRAFT', target_id=created['id'], blockers=[])
        result['imported'] = 1
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print('MIGRATION_STAGE=' + args.mode + ' total=' + str(len(items)) +
          ' eligible=' + str(result['ready_for_pilot']) + ' imported=' + str(result['imported']))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, HTTPError, OSError, TypeError) as exc:
        # Never print request headers or authentication material.
        print('MIGRATION_STAGE_ERROR=' + type(exc).__name__ + ' (check permissions, input and backup receipt)', file=sys.stderr)
        sys.exit(1)
