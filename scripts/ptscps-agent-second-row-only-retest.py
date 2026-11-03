#!/usr/bin/env python3
"""Recheck only the two HTTP-200 second-service failures after collection resolver fixes."""
import importlib.util
import json
from pathlib import Path
import time
from urllib.parse import quote

MODULE = Path(__file__).with_name('ptscps-agent-independent-fact-sample.py')
spec = importlib.util.spec_from_file_location('independent_fact', MODULE)
sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sample)
qa = sample.qa

CASES = (
    ('vi_services_second', 'vi', 'home_01', 'lĩnh vực dịch vụ'),
    ('en_services_second', 'en', 'home_01_en', 'service area'),
)


def ask(front, question, language):
    code, payload = qa.request_json(front + '/api/agent/chat',
                                    {'message': question, 'language': language}, timeout=90)
    # One controlled retry only for the previously observed transient HTTP 503.
    if code == 503:
        time.sleep(2)
        code, payload = qa.request_json(front + '/api/agent/chat',
                                        {'message': question, 'language': language}, timeout=90)
    reply = payload.get('reply') if isinstance(payload, dict) else ''
    return code, reply if isinstance(reply, str) else ''


def main():
    wp = qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {'schema': 1, 'scope': 'two_second_service_failures_only',
              'source_php': 'dec0bf3a76ab1036d0ae85aeb4033acfefa41b80', 'results': []}
    for case_id, language, table_id, subject in CASES:
        source_code, data = qa.request_json(wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
        rows = data.get('items') if isinstance(data, dict) else None
        valid = (source_code == 200 and isinstance(data, dict) and data.get('success') is True
                 and data.get('id') == table_id and isinstance(rows, list) and len(rows) >= 3)
        labels = [qa.first_label(row) for row in rows] if valid else []
        valid = valid and all(qa.norm(label) for label in labels)
        item = {'id': case_id, 'source_http': source_code,
                'status': 'BLOCKED_SOURCE' if not valid else 'NOT_RUN'}
        if valid:
            question = sample.make_question(language, subject, 'second')
            agent_code, reply = ask(front, question, language)
            passed, signals = sample.judge(reply, labels[1], [x for x in labels if x != labels[1]], language)
            item.update({'agent_http': agent_code,
                         'expected_label_matched': signals['expected_label_matched'],
                         'status': 'PASS' if agent_code == 200 and passed else 'FAIL'})
        report['results'].append(item)
        print('PTSCPS_SECOND_ROW_ONLY=' + json.dumps({k:item.get(k) for k in
              ('id','status','agent_http','expected_label_matched')}, sort_keys=True))
    report['summary'] = {
        'total': 2,
        'passed': sum(x['status'] == 'PASS' for x in report['results']),
        'failed': sum(x['status'] == 'FAIL' for x in report['results']),
        'blocked': sum(x['status'] == 'BLOCKED_SOURCE' for x in report['results']),
    }
    out = Path('audit/ptscps-agent-second-row-only-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_SECOND_ROW_ONLY_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['passed'] != 2:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
