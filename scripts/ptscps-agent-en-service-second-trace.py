#!/usr/bin/env python3
"""One-shot EN second-service trace after DB-only ordinal retriever release.

Exports only sanitized stage/status metadata. No raw prompt, answer, source label,
source ID, credentials, session ID or log lines are persisted.
"""
import importlib.util
import json
from pathlib import Path
from urllib.parse import quote

BASE = Path(__file__).parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError('module unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

diag = load('routing_trace', 'ptscps-agent-client-routing-trace.py')
independent = load('independent_fact', 'ptscps-agent-independent-fact-sample.py')

CASE = 'en_services_second'
LANG = 'en'
TABLE = 'home_01_en'
SUBJECT = 'service area'

def main():
    wp = diag.qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = diag.qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    source_http, source = diag.qa.request_json(
        wp + '/wp-json/tablepress/v1/table/' + quote(TABLE), timeout=30)
    rows = source.get('items') if isinstance(source, dict) else None
    valid = (source_http == 200 and isinstance(source, dict)
             and source.get('success') is True and source.get('id') == TABLE
             and isinstance(rows, list) and len(rows) >= 3)
    report = {
        'schema': 1,
        'scope': 'en_second_service_one_shot_trace',
        'source_http': source_http,
        'source_valid': bool(valid),
        'trace_status': 'not_run',
        'notes': [
            'Exactly one synthetic EN request; no retry loop.',
            'No raw question, answer, label, source ID, session, prompt, credential or log line persisted.',
            'Read-only public source plus opt-in regression telemetry only.'
        ],
    }
    if not valid:
        _write(report)
        raise SystemExit(1)

    labels = [diag.qa.first_label(row) for row in rows]
    if any(not diag.qa.norm(x) for x in labels):
        report['source_valid'] = False
        _write(report)
        raise SystemExit(1)

    question = independent.make_question(LANG, SUBJECT, 'second')
    http, answer, elapsed = diag.send(front, CASE, LANG, question)
    report.update({
        'agent_http': http,
        'elapsed_ms': elapsed,
        'answer_has_text': bool(answer.strip()),
        'expected_label_matched': bool(
            (' ' + diag.qa.norm(labels[1]) + ' ') in (' ' + diag.qa.norm(answer) + ' ')
        ),
    })

    ftp = None
    try:
        ftp = diag.connect_ftps()
        trace_status, events = diag.read_case(ftp, CASE)
        report['trace_status'] = trace_status
        if trace_status == 'trace_read':
            interpreted = diag.interpret(events, len(rows))
            report.update(interpreted)
            report['knowledge_count_matches_source_rows'] = report.pop(
                'count_matches_published_19_rows')
            report['llm_http_statuses'] = [
                e['http_status'] for e in events
                if e.get('event') == 'llm_response'
                and type(e.get('http_status')) is int
                and e['http_status'] in (200,400,401,403,408,429,500,502,503,504)
            ][:12]
            report['llm_failover_count'] = min(
                12, sum(e.get('event') == 'llm_failover' for e in events))
            report['plan_rejected_count'] = min(
                12, sum(e.get('event') == 'plan_rejected' for e in events))
            report['planner_failed'] = any(
                e.get('event') == 'planner_failed' for e in events)
            report['skill_error'] = any(
                e.get('event') == 'skill_error' for e in events)
    finally:
        if ftp is not None:
            try:
                ftp.quit()
            except Exception:
                pass

    _write(report)
    if report['trace_status'] != 'trace_read':
        raise SystemExit(1)

def _write(report):
    out = Path('audit/ptscps-agent-en-service-second-trace-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_EN_SECOND_TRACE=' + json.dumps({
        k: report.get(k) for k in (
            'source_valid','agent_http','expected_label_matched','trace_status',
            'plan_validated','knowledge_search_selected','knowledge_result_count',
            'synthesis_llm_attempted','synthesis_llm_responded','request_end_success',
            'llm_http_statuses','llm_failover_count','plan_rejected_count','planner_failed',
            'skill_error'
        )
    }, sort_keys=True))

if __name__ == '__main__':
    main()
