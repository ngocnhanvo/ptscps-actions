#!/usr/bin/env python3
"""Opt-in trace exactly two previously FAILED second-row facts, not PASS cases.

No raw prompts, source labels, Agent answers, user sessions, IDs or credentials
leave this process. Read only categorical events from this synthetic run over FTPS.
"""
import importlib.util
import json
from pathlib import Path
from urllib.parse import quote

BASE = Path(__file__).parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, BASE / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

diag = load('first_client_trace', 'ptscps-agent-client-routing-trace.py')
original = load('independent_fact', 'ptscps-agent-independent-fact-sample.py')
CASES = (
    ('vi_services_second', 'vi', 'home_01', 'lĩnh vực dịch vụ'),
    ('en_services_second', 'en', 'home_01_en', 'service area'),
)


def table_language(table_id):
    table_id = str(table_id or '')
    if table_id.count('_') >= 2:
        if table_id.endswith('_en'):
            return 'en'
        if table_id.endswith('_vi'):
            return 'vi'
    return 'vi'


def probe_home_candidates(wp):
    candidates = []
    for page in range(1, 6):
        status, payload = diag.qa.request_json(
            wp + f'/wp-json/tablepress/v1/tables/prefix/home_?page={page}&per_page=30', timeout=30)
        if status != 200 or not isinstance(payload, list):
            break
        for table in payload:
            if not isinstance(table, dict):
                continue
            table_id = str(table.get('id') or '')
            items = table.get('items')
            rows = len(items) if isinstance(items, list) else -1
            meta = diag.qa.norm(str(table.get('title') or '') + ' ' + str(table.get('description') or ''))
            service_hint = ('service' in meta or 'dich vu' in meta or 'linh vuc' in meta)
            if service_hint or rows == 5:
                candidates.append({'table_id': table_id, 'language': table_language(table_id),
                                   'rows': rows, 'service_hint': service_hint})
        if len(payload) < 30:
            break
    return sorted(candidates, key=lambda x: (x['language'], x['table_id']))


def main():
    wp = diag.qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = diag.qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {'schema': 1, 'source_php': 'dec0bf3a76ab1036d0ae85aeb4033acfefa41b80',
              'scope': 'two_previously_failed_second_row_cases_only', 'cases': [],
              'home_collection_candidates': probe_home_candidates(wp),
              'notes': ['Opt-in synthetic trace; no response/source text, params, prompts or secrets are exported.',
                        'Trace reveals planner, tool and provider stages; source identity requires separate trusted validation.',
                        'Public TablePress IDs, row counts and service-like flags are exported only for source attribution.',
                        'No CMS/index/FTP write, PHP release, Astro build, or already-PASS case rerun.']}
    ftp = None
    try:
        for case, lang, table_id, subject in CASES:
            status, data = diag.qa.request_json(wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
            rows = data.get('items') if isinstance(data, dict) else None
            valid = (status == 200 and isinstance(data, dict) and data.get('success') is True and data.get('id') == table_id
                     and isinstance(rows, list) and len(rows) >= 3)
            labels = [diag.qa.first_label(row) for row in rows] if valid else []
            valid = valid and bool(diag.qa.norm(labels[1])) and all(diag.qa.norm(x) for x in labels)
            item = {'case': case, 'source_http': status, 'source_valid': valid,
                    'trace_status': 'not_run', 'answer_second_label_matched': False}
            if not valid:
                report['cases'].append(item)
                continue
            q = original.make_question(lang, subject, 'second')
            code, answer, duration = diag.send(front, case, lang, q)
            item.update({'agent_http': code, 'elapsed_ms': duration,
                         'answer_has_text': bool(answer.strip()),
                         'answer_second_label_matched': bool((' ' + diag.qa.norm(labels[1]) + ' ')
                                                             in (' ' + diag.qa.norm(answer) + ' '))})
            if ftp is None:
                try:
                    ftp = diag.connect_ftps()
                except Exception:
                    ftp = None
            if ftp is not None:
                try:
                    trace_status, events = diag.read_case(ftp, case)
                    item['trace_status'] = trace_status
                    if trace_status == 'trace_read':
                        interpreted = diag.interpret(events, len(rows))
                        interpreted['knowledge_result_count_matches_source_rows'] = interpreted.pop('count_matches_published_19_rows')
                        item.update(interpreted)
                        item['llm_http_statuses'] = [e['http_status'] for e in events
                            if e.get('event') == 'llm_response' and type(e.get('http_status')) is int
                            and e['http_status'] in (200, 400, 401, 403, 408, 429, 500, 502, 503, 504)][:12]
                        item['llm_failover_count'] = min(12, sum(e.get('event') == 'llm_failover' for e in events))
                        item['planner_fail_count'] = min(12, sum(e.get('event') in ('plan_rejected', 'planner_failed') for e in events))
                        item['skill_error'] = any(e.get('event') == 'skill_error' for e in events)
                except Exception:
                    item['trace_status'] = 'read_error'
            report['cases'].append(item)
            print('PTSCPS_SECOND_TRACE=' + json.dumps({'case':case,'http':code,
                  'source_valid':True,'matched':item['answer_second_label_matched'],
                  'trace_status':item['trace_status']}, sort_keys=True))
    finally:
        if ftp is not None:
            try:
                ftp.quit()
            except Exception:
                pass
    report['summary'] = {'expected':2, 'attempted':sum(x.get('source_valid') for x in report['cases']),
                         'trace_read':sum(x['trace_status'] == 'trace_read' for x in report['cases'])}
    out = Path('audit/ptscps-agent-independent-second-trace-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print('PTSCPS_SECOND_TRACE_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['trace_read'] != 2:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
