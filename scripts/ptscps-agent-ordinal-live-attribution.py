#!/usr/bin/env python3
"""Bounded opt-in attribution for three current HTTP-200 ordinal misses.

No raw prompts, source labels, answers, IDs, credentials, or log lines are exported.
One synthetic request per case; no retry loop.
"""
import importlib.util
import json
from pathlib import Path
import time
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
independent = load('independent_fact', 'ptscps-agent-independent-fact-sample.py')
CASES = (
    ('vi_services_second', 'vi', 'home_01', 'lĩnh vực dịch vụ', 'second'),
    ('vi_services_last', 'vi', 'home_01', 'lĩnh vực dịch vụ', 'last'),
    ('vi_clients_second', 'vi', 'home_15', 'khách hàng tiêu biểu', 'second'),
)

def main():
    wp = diag.qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = diag.qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {'schema':1, 'scope':'three_current_vi_ordinal_misses_one_shot', 'cases':[],
              'notes':['No raw question, answer, source ID/label, prompt, credential, session or log line exported.',
                       'One synthetic request per case only; no retry burst, CMS write, reindex, PHP release or Astro build.']}
    ftp = None
    try:
        for case, lang, table_id, subject, position in CASES:
            source_http, source = diag.qa.request_json(
                wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
            rows = source.get('items') if isinstance(source, dict) else None
            valid = (source_http == 200 and isinstance(source, dict) and source.get('success') is True
                     and source.get('id') == table_id and isinstance(rows, list) and len(rows) >= 2)
            item = {'case':case, 'source_http':source_http, 'source_valid':bool(valid),
                    'source_rows':len(rows) if isinstance(rows,list) else 0, 'trace_status':'not_run'}
            if not valid:
                report['cases'].append(item)
                continue
            labels = [diag.qa.first_label(row) for row in rows]
            index = 1 if position == 'second' else len(labels)-1
            expected = labels[index] if 0 <= index < len(labels) else ''
            if not diag.qa.norm(expected):
                item['source_valid'] = False
                report['cases'].append(item)
                continue
            question = independent.make_question(lang, subject, position)
            code, answer, elapsed = diag.send(front, case, lang, question)
            item.update({'agent_http':code, 'elapsed_ms':elapsed, 'answer_has_text':bool(answer.strip()),
                         'expected_label_matched':bool((' '+diag.qa.norm(expected)+' ') in (' '+diag.qa.norm(answer)+' '))})
            if ftp is None:
                try: ftp = diag.connect_ftps()
                except Exception: ftp = None
            if ftp is not None:
                time.sleep(0.4)
                try:
                    trace_status, events = diag.read_case(ftp, case)
                    item['trace_status'] = trace_status
                    if trace_status == 'trace_read':
                        interpreted = diag.interpret(events, len(rows))
                        interpreted['knowledge_result_count_matches_source_rows'] = interpreted.pop('count_matches_published_19_rows')
                        item.update(interpreted)
                        starts = [e for e in events if e.get('event') == 'skill_start' and
                                  e.get('skill') == 'knowledge' and e.get('action') == 'search']
                        params = starts[0].get('params') if starts and isinstance(starts[0].get('params'), dict) else {}
                        item['original_keyword_preserved'] = bool(diag.qa.norm(str(params.get('keyword') or '')) == diag.qa.norm(question))
                        item['semantic_variants_supplied'] = bool(str(params.get('semantic_variants') or '').strip())
                        item['llm_http_statuses'] = [e['http_status'] for e in events
                            if e.get('event') == 'llm_response' and type(e.get('http_status')) is int
                            and e['http_status'] in (200,400,401,403,408,429,500,502,503,504)][:12]
                        item['llm_failover_count'] = min(12, sum(e.get('event') == 'llm_failover' for e in events))
                        item['planner_fail_count'] = min(12, sum(e.get('event') in ('plan_rejected','planner_failed') for e in events))
                        item['skill_error'] = any(e.get('event') == 'skill_error' for e in events)
                except Exception:
                    item['trace_status'] = 'read_error'
            report['cases'].append(item)
            print('PTSCPS_ORDINAL_ATTRIBUTION_CASE=' + json.dumps({
                'case':case, 'http':code, 'matched':item['expected_label_matched'],
                'trace_status':item['trace_status']}, sort_keys=True))
    finally:
        if ftp is not None:
            try: ftp.quit()
            except Exception: pass
    report['summary'] = {'expected':3,
        'attempted':sum(bool(x.get('source_valid')) for x in report['cases']),
        'trace_read':sum(x.get('trace_status') == 'trace_read' for x in report['cases'])}
    out = Path('audit/ptscps-agent-ordinal-live-attribution-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, sort_keys=True, indent=2)+'\n', encoding='utf-8')
    print('PTSCPS_ORDINAL_ATTRIBUTION_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['attempted'] != 3 or report['summary']['trace_read'] != 3:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
