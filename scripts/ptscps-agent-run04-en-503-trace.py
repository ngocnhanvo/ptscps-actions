#!/usr/bin/env python3
"""One request only: trace a post-Planner-release EN collection HTTP 503 safely.

Never persist/print user content, answers, credentials, session IDs or raw provider data.
No WordPress writes, PHP deploy, index rebuild, or website build.
"""
import ftplib
import io
import json
import os
import re
import ssl
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

CASE = 'en_services_listed'
QUESTION = "Which service areas are listed on PTSC's homepage?"
FIELDS = {'event', 'stage', 'provider', 'model', 'http_status', 'error_type',
          'reason', 'latency_ms', 'attempt', 'result', 'finish_reason',
          'retry_after_seconds'}
EVENTS = {'llm_request', 'llm_response', 'llm_retry', 'llm_failover',
          'llm_candidate_skipped', 'llm_provider_cooldown',
          'llm_provider_half_open', 'llm_provider_recovered',
          'planner_failed', 'plan_rejected', 'plan_validated',
          'synthesis_failed', 'llm_provider_config_invalid', 'request_end'}


def config(name):
    rows = [line.strip().removeprefix('export ').strip()
            for line in os.environ['ENV_FILE'].splitlines()]
    values = [line.split('=', 1)[1].strip().strip('"\'')
              for line in rows if re.match(r'^' + re.escape(name) + r'\s*=', line)]
    if len(values) != 1:
        raise ValueError('Missing/duplicate required environment origin')
    return values[0]


def origin(key, host):
    u = urlsplit(config(key))
    if (u.scheme != 'https' or u.hostname != host or u.port or u.username or
        u.password or u.path not in ('', '/') or u.query or u.fragment):
        raise ValueError('Unexpected production origin')
    return 'https://' + u.netloc


def safe(value):
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:/@-]{1,100}', value):
        return value
    return None


def trace(ftp, runid):
    # Existing opt-in per-request debug logging; do not crawl unrelated sessions.
    root = ('/domains/admin-ptscps.thegioihosting.io.vn/public_html/'
            'wp-content/esc-agent-debug/regression/' + runid + '/' + CASE + '-frontend')
    try:
        ftp.cwd(root)
        events = []
        for candidate in ftp.nlst():
            name = candidate.rsplit('/', 1)[-1]
            if not re.fullmatch(r'turn-01_req_[0-9a-f]{24}\.jsonl', name):
                continue
            output = io.BytesIO()
            ftp.retrbinary('RETR ' + name, output.write)
            if len(output.getvalue()) > 256000:
                continue
            for line in output.getvalue().splitlines():
                try:
                    item = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(item, dict) or item.get('event') not in EVENTS:
                    continue
                events.append({k: safe(v) for k, v in item.items()
                               if k in FIELDS and isinstance(v, (str, int, float, bool, type(None)))})
        return events[:45]
    except ftplib.all_errors as e:
        return {'unavailable': type(e).__name__}


def main():
    front = origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    runid = 'run04en' + re.sub('[^0-9]', '', os.environ.get('GITHUB_RUN_ID', '0'))
    payload = {'message': QUESTION, 'language': 'en', 'sessionId': str(uuid.uuid4())}
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json',
               'Origin': front, 'X-ESC-Debug': 'regression',
               'X-ESC-Run-Id': runid, 'X-ESC-Test-Case': CASE,
               'X-ESC-Test-Turn': '1'}
    start = time.monotonic()
    status = 0
    data = {}
    transport = None
    try:
        with urlopen(Request(front + '/api/agent/chat',
                             data=json.dumps(payload).encode('utf-8'),
                             headers=headers, method='POST'), timeout=75) as res:
            status = res.status
            raw = res.read(4096)
    except HTTPError as e:
        status, raw = e.code, e.read(4096)
    except (URLError, TimeoutError) as e:
        raw = b''
        transport = type(e).__name__
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    error = data.get('error') if isinstance(data.get('error'), dict) else {}
    reply = data.get('reply')
    record = {'http': status, 'code': safe(data.get('code') or error.get('code')),
              'answered': status == 200 and isinstance(reply, str) and bool(reply.strip()),
              'latency_ms': round((time.monotonic() - start) * 1000),
              'transport_error': transport}
    result = {'schema': 1, 'scope': 'single_en_collection_post_planner_release',
              'source_php': 'cb612e024a946b3d87b775a31f8ca70a48aae331',
              'case': CASE, 'request_count': 1, 'frontend': record, 'events': []}
    try:
        address = urlsplit(os.environ['FTP_SERVER'] if '://' in os.environ['FTP_SERVER']
                           else 'ftp://' + os.environ['FTP_SERVER'])
        if address.scheme not in ('ftp', 'ftps') or not address.hostname or address.path.strip('/'):
            raise ValueError('Unexpected FTPS origin')
        ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
        ftp.connect(address.hostname, address.port or 21)
        ftp.auth()
        ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        ftp.prot_p()
        result['events'] = trace(ftp, runid)
        ftp.quit()
    except Exception as e:
        result['trace_unavailable'] = type(e).__name__
    output = Path('audit/ptscps-agent-run04-en-503-summary.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('PTSCPS_RUN04_EN_SINGLE_TRACE=' +
          json.dumps({'http': status, 'answered': record['answered'],
                      'trace_events': len(result['events']) if isinstance(result['events'], list) else 0,
                      'trace_available': isinstance(result['events'], list) and bool(result['events']),
                      'transport_error': transport}, sort_keys=True))


if __name__ == '__main__':
    main()
