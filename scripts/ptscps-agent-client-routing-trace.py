#!/usr/bin/env python3
"""Bounded VI/EN first-customer production path attribution.

Exactly two opt-in regression requests. Probe canonical published source first, then
inspect only the synthetic run's files over protected FTPS. Never emit/persist
visitor text, prompt, response, source IDs, table rows, credential or raw logs.
No PHP/CMS/index/build/FTP writes (opt-in Agent regression logging excepted).
"""
import ftplib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import ssl
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

BASE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('grounded', BASE / 'ptscps-agent-fact-intent-grounded.py')
if spec is None or spec.loader is None:
    raise RuntimeError('Existing fact-intent QA unavailable')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
CASES = tuple(case for case in qa.CASES if case[0] in ('vi_client_first', 'en_client_first'))
assert len(CASES) == 2 and [c[0] for c in CASES] == ['vi_client_first', 'en_client_first']
RUN = 'clienttrace' + re.sub(r'[^0-9]', '', os.environ.get('GITHUB_RUN_ID', ''))
if not re.fullmatch(r'clienttrace[0-9]{8,16}', RUN):
    raise RuntimeError('Unsafe synthetic run ID')
ROOT = '/domains/admin-ptscps.thegioihosting.io.vn/public_html/wp-content/esc-agent-debug/regression'
ALLOWED_EVENTS = {'llm_request', 'llm_response', 'llm_retry', 'llm_failover', 'plan_validated',
                  'plan_rejected', 'planner_failed', 'plan_execution_start', 'skill_start',
                  'skill_result', 'skill_error', 'synthesis_failed', 'request_end'}


def send(front, case, lang, question):
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json',
               'Origin': front, 'X-ESC-Debug': 'regression', 'X-ESC-Run-Id': RUN,
               'X-ESC-Test-Case': case, 'X-ESC-Test-Turn': '1'}
    payload = json.dumps({'message': question, 'language': lang, 'sessionId': str(uuid.uuid4())}).encode()
    begin = time.monotonic()
    try:
        with urlopen(Request(front + '/api/agent/chat', data=payload, headers=headers, method='POST'),
                     timeout=85) as response:
            code, raw = response.status, response.read(64000)
    except HTTPError as exc:
        code, raw = exc.code, exc.read(64000)
    except (URLError, TimeoutError, OSError):
        code, raw = 0, b''
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    reply = data.get('reply') if isinstance(data.get('reply'), str) else ''
    return code, reply, int((time.monotonic() - begin) * 1000)


def connect_ftps():
    address = os.environ.get('FTP_SERVER', '')
    url = urlsplit(address if '://' in address else 'ftp://' + address)
    if (url.scheme not in ('ftp', 'ftps') or not url.hostname or url.username or url.password
            or url.path not in ('', '/') or url.query or url.fragment):
        raise RuntimeError('Unsafe FTPS endpoint')
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
    ftp.connect(url.hostname, url.port or 21)
    ftp.auth()
    ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
    ftp.prot_p()
    return ftp


def read_case(ftp, case):
    try:
        ftp.cwd(ROOT + '/' + RUN + '/' + case)
        candidates = [x.rsplit('/', 1)[-1] for x in ftp.nlst()]
        matching = [x for x in candidates if re.fullmatch(r'turn-01_req_[0-9a-f]{24}\.jsonl', x)]
        if len(matching) != 1:
            return 'trace_missing_or_ambiguous', []
        buffer = io.BytesIO()
        ftp.retrbinary('RETR ' + matching[0], buffer.write)
        if len(buffer.getvalue()) > 256000:
            return 'trace_oversized', []
    except ftplib.all_errors:
        return 'trace_missing_or_denied', []
    events = []
    for line in buffer.getvalue().splitlines():
        try:
            obj = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        if isinstance(obj, dict) and obj.get('event') in ALLOWED_EVENTS:
            events.append(obj)
    return ('trace_read' if events else 'trace_empty'), events


def interpret(events, expected_count):
    # Do not export free-text params, raw mode source IDs, error strings, or model responses.
    selected = [e for e in events if e.get('event') == 'skill_start']
    knowledge_steps = [e for e in selected if e.get('skill') == 'knowledge' and e.get('action') == 'search']
    knowledge_results = [e for e in events if e.get('event') == 'skill_result'
                         and e.get('skill') == 'knowledge' and e.get('action') == 'search']
    first_params = knowledge_steps[0].get('params') if knowledge_steps else None
    first_params = first_params if isinstance(first_params, dict) else {}
    mode = first_params.get('mode')
    if mode not in ('fact', 'auto', 'collection', 'articles'):
        mode = 'unspecified_or_unknown'
    result_counts = [r.get('result_count') for r in knowledge_results
                     if type(r.get('result_count')) is int and 0 <= r['result_count'] <= 1000]
    return {
        'plan_validated': any(e.get('event') == 'plan_validated' for e in events),
        'knowledge_search_selected': bool(knowledge_steps),
        'other_skill_selected': any(e.get('skill') != 'knowledge' for e in selected),
        'knowledge_requested_mode': mode,
        'source_scope_supplied': bool(first_params.get('source_type') and first_params.get('source_id')),
        'knowledge_result_count': result_counts[0] if result_counts else None,
        'count_matches_published_19_rows': bool(result_counts and result_counts[0] == expected_count),
        'synthesis_llm_attempted': any(e.get('event') == 'llm_request' and e.get('stage') == 'synthesis'
                                       for e in events),
        'synthesis_llm_responded': any(e.get('event') == 'llm_response' and e.get('stage') == 'synthesis'
                                       and e.get('http_status') == 200 for e in events),
        'request_end_success': any(e.get('event') == 'request_end' and e.get('result') == 'success'
                                   for e in events),
    }


def self_test():
    assert interpret([{'event':'skill_start','skill':'knowledge','action':'search','params':{'mode':'fact'}},
                      {'event':'skill_result','skill':'knowledge','action':'search','result_count':19},
                      {'event':'llm_request','stage':'synthesis'}], 19)['count_matches_published_19_rows']
    assert not interpret([{'event':'skill_start','skill':'company','action':'services'}], 19)['knowledge_search_selected']
    print('PTSCPS_CLIENT_PATH_SELFTEST=PASS')


def main():
    self_test()
    wp = qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {'schema': 1, 'scope': 'two_failed_first_client_cases_optin_telemetry_only',
              'source_php': 'b8e5726902835e8274dfcdae803b87e5638a14a1', 'cases': [],
              'notes': ['No raw questions, answers, source IDs, labels, index rows, log lines, sessions, credentials or prompts persisted.',
                        'A 19-row skill result is supporting evidence only; without a source-id match it does not prove the selected TablePress source.']}
    ftp = None
    try:
        for case, lang, table_id, question in CASES:
            code, table = qa.request_json(wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
            item = {'case':case,'source_http':code,'source_valid':False,'trace_status':'not_run'}
            if (code != 200 or not isinstance(table, dict) or table.get('success') is not True
                    or table.get('id') != table_id or not isinstance(table.get('items'), list)
                    or len(table['items']) != 19):
                report['cases'].append(item)
                continue
            expected = qa.first_label(table['items'][0])
            if not qa.norm(expected):
                report['cases'].append(item)
                continue
            item['source_valid'] = True
            status, reply, elapsed = send(front, case, lang, question)
            item['agent_http'] = status
            item['elapsed_ms'] = elapsed
            item['answer_first_label_match'] = bool((' ' + qa.norm(expected) + ' ') in (' ' + qa.norm(reply) + ' '))
            item['answer_has_text'] = bool(reply.strip())
            if ftp is None:
                try:
                    ftp = connect_ftps()
                except (ftplib.all_errors, OSError, ValueError):
                    ftp = None
            if ftp:
                # Allow the synchronous request logger's file to become visible.
                try:
                    trace_status, events = read_case(ftp, case)
                    item['trace_status'] = trace_status
                    if trace_status == 'trace_read':
                        item.update(interpret(events, len(table['items'])))
                except (OSError, EOFError, ftplib.Error):
                    item['trace_status'] = 'trace_transport_failed'
                    ftp = None
            report['cases'].append(item)
            print('PTSCPS_CLIENT_PATH_CASE=' + json.dumps({
                'case':case, 'source_valid':item['source_valid'], 'agent_http':status,
                'first_label_match':item['answer_first_label_match'], 'trace_status':item['trace_status']}, sort_keys=True))
    finally:
        if ftp:
            try:
                ftp.quit()
            except (OSError, EOFError, ftplib.Error):
                pass
    output = Path('audit/ptscps-agent-client-routing-trace-summary.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_CLIENT_PATH_SCOPE=' + json.dumps({'count':len(report['cases']),
        'trace_read':sum(c.get('trace_status')=='trace_read' for c in report['cases'])}, sort_keys=True))
    if len(report['cases']) != 2 or not all(c['source_valid'] for c in report['cases']):
        raise RuntimeError('One of two published sources not available; test not accepted')


if __name__ == '__main__':
    main()
