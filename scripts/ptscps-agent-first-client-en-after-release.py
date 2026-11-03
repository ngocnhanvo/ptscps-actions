#!/usr/bin/env python3
"""One EN-only postrelease attribution probe; never repeat the VI PASS.

One opted-in synthetic request. Log output contains ONLY categorical stage evidence.
No raw prompt, answer, source ID, company name, credentials or stack trace.
"""
import importlib.util
import json
from pathlib import Path
from urllib.parse import quote

path = Path(__file__).with_name('ptscps-agent-client-routing-trace.py')
spec = importlib.util.spec_from_file_location('original_trace', path)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)
case = next(c for c in diag.CASES if c[0] == 'en_client_first')
assert len(diag.CASES) == 2


def main():
    name, lang, table_id, question = case
    wp = diag.qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = diag.qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    src_code, table = diag.qa.request_json(wp+'/wp-json/tablepress/v1/table/'+quote(table_id), timeout=30)
    if src_code != 200 or not isinstance(table,dict) or table.get('id') != table_id or len(table.get('items',[])) != 19:
        raise RuntimeError('EN source snapshot did not match verified prior source')
    label = diag.qa.first_label(table['items'][0])
    status,reply,elapsed = diag.send(front,name,lang,question)
    report = {'schema':1, 'source_php':'4f8e755c6a9f11c3b1fd22b2bfc5fc8fa7a0c1ab',
              'scope':'one_failed_EN_first_customer_only', 'source_valid':True,
              'case':name, 'agent_http':status, 'elapsed_ms':elapsed,
              'answer_has_text':bool(reply.strip()),
              'first_label_match':bool((' '+diag.qa.norm(label)+' ') in (' '+diag.qa.norm(reply)+' ')),
              'trace_status':'unavailable'}
    ftp = None
    try:
        ftp = diag.connect_ftps()
        trace_status,events = diag.read_case(ftp,name)
        report['trace_status'] = trace_status
        if trace_status == 'trace_read':
            report.update(diag.interpret(events,len(table['items'])))
            allowed = {200,400,401,403,408,429,500,502,503,504}
            statuses = [int(e.get('http_status')) for e in events
                        if e.get('event') == 'llm_response'
                        and type(e.get('http_status')) is int and e['http_status'] in allowed]
            report['llm_statuses'] = statuses[:12]
            report['llm_failover_event_count'] = min(12,sum(e.get('event')=='llm_failover' for e in events))
            report['planner_failure_event_count'] = min(12,sum(e.get('event') in ('plan_rejected','planner_failed') for e in events))
            report['skill_error_seen'] = any(e.get('event')=='skill_error' for e in events)
    finally:
        if ftp:
            try: ftp.quit()
            except Exception: pass
    Path('audit/ptscps-first-client-en-provider-trace-summary.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print('PTSCPS_EN_503_RECHECK=' + json.dumps(report,sort_keys=True))
    if report['trace_status'] != 'trace_read':
        raise RuntimeError('Cannot attribute HTTP result without opt-in trace')

if __name__ == '__main__':
    main()
