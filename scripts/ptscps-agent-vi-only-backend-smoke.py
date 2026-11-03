#!/usr/bin/env python3
from __future__ import annotations
import json
import os
import re
import urllib.request
from urllib.parse import urlsplit

NOTICE = 'This feature is currently available in Vietnamese only.'

def env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in os.environ.get('ENV_FILE', '').splitlines():
        line = line.strip()
        if line.startswith('export '):
            line = line[7:].strip()
        match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
        if not match:
            continue
        raw = match.group(2).strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
            raw = raw[1:-1]
        values[match.group(1)] = raw
    return values

values = env_values()
base = values.get('WC_URL', '').rstrip('/')
secret = values.get('WOO_SECRET', '')
key = values.get('WOO_KEY', '')
parts = urlsplit(base)
if (parts.scheme != 'https' or not parts.hostname or parts.port not in (None, 443)
        or parts.path not in ('', '/') or parts.query or parts.fragment
        or parts.username or parts.password or not secret):
    raise SystemExit('PTSCPS_AGENT_VI_ONLY_BACKEND=BLOCKED invalid backend credentials/origin')

url = base + '/wp-json/esc-agent/v1/chat'
for language in ('en', 'fr'):
    payload = json.dumps({
        'message': 'availability check',
        'sessionId': '123e4567-e89b-42d3-a456-426614174000',
        'language': language,
    }).encode('utf-8')
    headers = {
        'Authorization': 'Bearer ' + secret,
        'Content-Type': 'application/json',
    }
    if key:
        headers['X-ESC-Woo-Key'] = key
    request = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.loads(response.read().decode('utf-8'))
        if response.status != 200 or body.get('message') != NOTICE or body.get('status') != 'success':
            raise RuntimeError('Unexpected non-Vietnamese Agent response')
    print(f'PTSCPS_AGENT_VI_ONLY_BACKEND_{language.upper()}=PASS')

print('PTSCPS_AGENT_VI_ONLY_BACKEND=PASS')
