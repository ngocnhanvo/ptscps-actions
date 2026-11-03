#!/usr/bin/env python3
"""Read one existing regression trace at the exact header-derived case path.

No new LLM request, visitor data, CMS call, file write, or production change.
Only categorical tool names/HTTP statuses are retained; no prompts or answers.
"""
import ftplib
import io
import json
import os
import re
import ssl
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

ROOT = ('/domains/admin-ptscps.thegioihosting.io.vn/public_html/'
        'wp-content/esc-agent-debug/regression')
RUN = 'run04en41573588673'
# Exact X-ESC-Test-Case header value from the original request, not a suffix.
CASE = 'en_services_listed'
EVENTS = {
    'llm_request', 'llm_response', 'llm_retry', 'llm_failover',
    'plan_validated', 'plan_rejected', 'planner_failed',
    'plan_execution_start', 'skill_start', 'skill_result', 'skill_error',
    'synthesis_failed', 'request_end',
}
KEYS = {
    'skill', 'action', 'stage', 'provider', 'http_status', 'error_type',
    'result', 'result_type', 'result_count', 'status', 'requires_synthesis',
    'direct_response', 'attempt',
}


def scalar(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', value):
        return value
    return None


def main():
    raw = os.environ.get('FTP_SERVER', '')
    u = urlsplit(raw if '://' in raw else 'ftp://' + raw)
    if u.scheme not in ('ftp', 'ftps') or not u.hostname or u.username or u.password \
            or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('Invalid FTPS endpoint')
    report = {'schema': 1, 'scope': 'existing_single_regression_trace_only',
              'case': CASE, 'run': RUN, 'status': 'unknown', 'events': [],
              'notes': 'No question, response, tokens, session IDs, or source content exported'}
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=22)
    try:
        ftp.connect(u.hostname, u.port or 21)
        ftp.auth()
        ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        ftp.prot_p()
        try:
            ftp.cwd(ROOT + '/' + RUN + '/' + CASE)
            files = [s.rsplit('/', 1)[-1] for s in ftp.nlst()]
            matches = sorted(s for s in files if re.fullmatch(r'turn-01_req_[0-9a-f]{24}\.jsonl', s))
            if len(matches) != 1:
                report['status'] = 'trace_file_missing_or_ambiguous'
            else:
                buf = io.BytesIO()
                ftp.retrbinary('RETR ' + matches[0], buf.write)
                if len(buf.getvalue()) > 256000:
                    report['status'] = 'trace_oversized'
                else:
                    for line in buf.getvalue().splitlines():
                        try:
                            record = json.loads(line)
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if not isinstance(record, dict) or record.get('event') not in EVENTS:
                            continue
                        # Explicit field allowlist ensures no raw prompts/answers are exported.
                        report['events'].append({'event': record['event'], **{
                            k: scalar(v) for k, v in record.items()
                            if k in KEYS and scalar(v) is not None
                        }})
                    report['status'] = 'trace_read' if report['events'] else 'no_allowed_events'
        except ftplib.error_perm:
            report['status'] = 'case_denied_or_missing'
    finally:
        try:
            ftp.quit()
        except (ftplib.Error, OSError, EOFError):
            pass
    summary = {'status': report['status'], 'events': len(report['events']),
               'event_types': dict(sorted(Counter(e['event'] for e in report['events']).items()))}
    print('PTSCPS_EXISTING_PLAN_TRACE=' + json.dumps(summary, sort_keys=True))
    out = Path('audit/ptscps-agent-historical-plan-trace-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
