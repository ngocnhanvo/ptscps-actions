#!/usr/bin/env python3
"""Three-request opt-in LLM health trace after RAG/ordinal fixes.

Exactly three source-grounded ordinal requests, no retry loop. Export only bounded
provider/health state metadata; never raw prompts, answers, source labels/IDs,
credentials, sessions, model responses, or log lines.
"""
import importlib.util
import json
from pathlib import Path
from urllib.parse import quote

BASE = Path(__file__).parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, BASE / path)
    if spec is None or spec.loader is None:
        raise RuntimeError('module unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

diag = load('routing_trace', 'ptscps-agent-client-routing-trace.py')
facts = load('independent_fact', 'ptscps-agent-independent-fact-sample.py')
diag.ALLOWED_EVENTS.update({
    'llm_candidate_skipped',
    'llm_provider_cooldown',
    'llm_provider_half_open',
    'llm_provider_recovered',
})

CASES = (
    ('health_vi_service_second', 'vi', 'home_01', 'lĩnh vực dịch vụ', 'second'),
    ('health_vi_service_last', 'vi', 'home_01', 'lĩnh vực dịch vụ', 'last'),
    ('health_vi_client_second', 'vi', 'home_15', 'khách hàng tiêu biểu', 'second'),
)

SAFE_ERRORS = {
    'quota_exceeded', 'rate_limit', 'http_5xx', 'timeout', 'network_error',
    'dns_error', 'tls_error', 'invalid_plan', 'invalid_json', 'empty_response',
    'max_tokens', 'provider_error', 'synthesis_error',
}
SAFE_SKIP_REASONS = {'cooldown', 'probe_locked', 'unavailable', 'healthy', 'half_open_probe'}

def safe_error(value):
    value = str(value or '')
    return value if value in SAFE_ERRORS else ('other' if value else '')

def safe_skip(value):
    value = str(value or '')
    return value if value in SAFE_SKIP_REASONS else ('other' if value else '')

def compact(events, expected_count):
    llm_responses = []
    for e in events:
        if e.get('event') != 'llm_response':
            continue
        status = e.get('http_status')
        if type(status) is not int or status < 100 or status > 599:
            status = None
        llm_responses.append({
            'stage': e.get('stage') if e.get('stage') in ('planner','synthesis') else 'unknown',
            'provider': str(e.get('provider') or '')[:24],
            'http_status': status,
            'error_type': safe_error(e.get('error_type')),
        })
    skips = [e for e in events if e.get('event') == 'llm_candidate_skipped']
    cooldowns = [e for e in events if e.get('event') == 'llm_provider_cooldown']
    results = [e for e in events if e.get('event') == 'skill_result'
               and e.get('skill') == 'knowledge' and e.get('action') == 'search']
    counts = [e.get('result_count') for e in results
              if type(e.get('result_count')) is int and 0 <= e['result_count'] <= 100]
    return {
        'llm_responses': llm_responses[:12],
        'candidate_skipped': [
            {'stage': e.get('stage') if e.get('stage') in ('planner','synthesis') else 'unknown',
             'provider': str(e.get('provider') or '')[:24],
             'reason': safe_skip(e.get('reason'))}
            for e in skips[:12]
        ],
        'cooldowns': [
            {'provider': str(e.get('provider') or '')[:24],
             'error_type': safe_error(e.get('error_type'))}
            for e in cooldowns[:12]
        ],
        'half_open_count': min(12, sum(e.get('event') == 'llm_provider_half_open' for e in events)),
        'recovered_count': min(12, sum(e.get('event') == 'llm_provider_recovered' for e in events)),
        'failover_count': min(12, sum(e.get('event') == 'llm_failover' for e in events)),
        'plan_rejected_count': min(12, sum(e.get('event') == 'plan_rejected' for e in events)),
        'planner_failed': any(e.get('event') == 'planner_failed' for e in events),
        'knowledge_result_count': counts[0] if counts else None,
        'knowledge_count_matches_public_rows': bool(counts and counts[0] == expected_count),
        'request_end_success': any(e.get('event') == 'request_end' and e.get('result') == 'success'
                                   for e in events),
    }

def main():
    wp = diag.qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = diag.qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {
        'schema': 1,
        'scope': 'three_request_provider_health_sequence_no_retry',
        'source_php': 'a73b33da2f8fbf12d2e59c4d1f5aa8ada42733e1',
        'cases': [],
        'notes': [
            'Exactly three synthetic source-grounded requests; no retry loop.',
            'No raw prompts, answers, source labels/IDs, credentials, sessions or raw logs exported.',
            'No CMS/index writes, PHP release, reindex or Astro build.',
        ],
    }
    ftp = None
    try:
        ftp = diag.connect_ftps()
        for case, lang, table_id, subject, position in CASES:
            source_http, source = diag.qa.request_json(
                wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
            rows = source.get('items') if isinstance(source, dict) else None
            valid = (source_http == 200 and isinstance(source, dict)
                     and source.get('success') is True and source.get('id') == table_id
                     and isinstance(rows, list) and len(rows) >= 2)
            item = {
                'case': case,
                'source_http': source_http,
                'source_valid': bool(valid),
                'source_rows': len(rows) if isinstance(rows, list) else 0,
                'trace_status': 'not_run',
            }
            if not valid:
                report['cases'].append(item)
                continue
            labels = [diag.qa.first_label(row) for row in rows]
            index = 1 if position == 'second' else len(labels) - 1
            expected = labels[index]
            question = facts.make_question(lang, subject, position)
            code, answer, elapsed = diag.send(front, case, lang, question)
            item.update({
                'agent_http': code,
                'elapsed_ms': elapsed,
                'expected_label_matched': bool(
                    (' ' + diag.qa.norm(expected) + ' ') in (' ' + diag.qa.norm(answer) + ' ')
                ),
            })
            trace_status, events = diag.read_case(ftp, case)
            item['trace_status'] = trace_status
            if trace_status == 'trace_read':
                item.update(compact(events, len(rows)))
            report['cases'].append(item)
            print('PTSCPS_PROVIDER_HEALTH_CASE=' + json.dumps({
                'case': case,
                'http': code,
                'matched': item['expected_label_matched'],
                'trace_status': trace_status,
                'planner_failed': item.get('planner_failed'),
                'knowledge_result_count': item.get('knowledge_result_count'),
            }, sort_keys=True))
    finally:
        if ftp is not None:
            try:
                ftp.quit()
            except Exception:
                pass
    report['summary'] = {
        'expected': 3,
        'attempted': sum(bool(x.get('source_valid')) for x in report['cases']),
        'trace_read': sum(x.get('trace_status') == 'trace_read' for x in report['cases']),
        'http_200': sum(x.get('agent_http') == 200 for x in report['cases']),
        'http_503': sum(x.get('agent_http') == 503 for x in report['cases']),
    }
    out = Path('audit/ptscps-agent-provider-cooldown-trace-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_PROVIDER_HEALTH_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['attempted'] != 3 or report['summary']['trace_read'] != 3:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
