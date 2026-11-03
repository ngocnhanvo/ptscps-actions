#!/usr/bin/env python3
"""Eight NEW source-grounded positional facts; no earlier PASS case is repeated.

Read published TablePress via public read-only REST, then ask new second/last
questions through the production chatbot. Never log or persist CMS source rows,
question text, LLM answer text, tokens, credentials, or session identifiers.
This tests fact answer support, NOT knowledge.search recall@5 or the RUN07 gate.
"""
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote

# Reuse the previously validated REST origin checks and label normalizer.
import importlib.util

MODULE = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('ptscps_grounded', MODULE)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

SOURCES = (
    ('vi_services', 'vi', 'home_01', 'lĩnh vực dịch vụ', 'service area'),
    ('en_services', 'en', 'home_01_en', 'lĩnh vực dịch vụ', 'service area'),
    ('vi_clients', 'vi', 'home_15', 'khách hàng tiêu biểu', 'featured customer'),
    ('en_clients', 'en', 'home_15_en', 'khách hàng tiêu biểu', 'featured customer'),
)

def make_question(language, subject, position):
    if language == 'vi':
        ordinal = 'thứ hai' if position == 'second' else 'cuối cùng'
        return f'Trong danh sách {subject} trên trang chủ PTSC, mục đứng {ordinal} là gì? Chỉ nêu tên của mục đó.'
    ordinal = 'second' if position == 'second' else 'last'
    return f'Which {subject} is listed {ordinal} in the PTSC homepage section? Give only its exact name.'


def judge(answer, expected_label, other_labels, language):
    actual = qa.norm(answer)
    expected = qa.norm(expected_label)
    matches = bool(expected) and (' ' + expected + ' ') in (' ' + actual + ' ')
    other = [qa.norm(s) for s in other_labels]
    extra = any(s and s != expected and len(s) >= 7 and s not in expected
                and (' ' + s + ' ') in (' ' + actual + ' ') for s in other)
    too_long = len(actual) > len(expected) + 110
    bad_locale = bool(language == 'en' and re.search(r'\b(?:khách hàng|dịch vụ|lĩnh vực|cuối cùng)\b', answer, re.I))
    fallback = bool(re.search(r'no verified information|chưa có thông tin xác thực|cannot process|không tìm thấy dữ liệu', answer, re.I))
    return (matches and not extra and not too_long and not bad_locale and not fallback,
            {'expected_label_matched': matches, 'extra_source_label': extra,
             'overlong': too_long, 'locale_leak': bad_locale, 'fallback': fallback})


def selftest():
    assert qa.first_label({'title': '<strong>A sample title</strong>'}) == 'A sample title'
    assert 'thứ hai' in make_question('vi', 'dịch vụ', 'second')
    assert 'last' in make_question('en', 'service', 'last')
    assert judge('Example Service', 'Example Service', ['Other Company'], 'en')[0]
    assert not judge('Example Service and Other Company', 'Example Service', ['Other Company'], 'en')[0]
    assert not judge('No verified information', 'Example Service', [], 'en')[0]
    print('PTSCPS_INDEPENDENT_FACT_SELFTEST=PASS 6 assertions')


def main():
    if '--self-test' in sys.argv:
        selftest()
        return
    wp = qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    out = {'schema': 1, 'mode': 'read_only', 'scope': 'eight_new_second_and_last_facts',
           'production_php_sha': '4f8e755c6a9f11c3b1fd22b2bfc5fc8fa7a0c1ab', 'results': [],
           'notes': ['No earlier first-item PASS or collection-list question rerun.',
                     'Expected names resolved at runtime from published ordered TablePress items.',
                     'Factual answer sampling only; retrieval recall@5 remains unmeasured by this workflow.',
                     'No CMS/index mutations, PHP FTP release or Astro build.']}
    for base_id, language, table_id, vi_subject, en_subject in SOURCES:
        code, data = qa.request_json(wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
        rows = data.get('items') if isinstance(data, dict) else None
        valid = (code == 200 and isinstance(data, dict) and data.get('success') is True
                 and data.get('id') == table_id and isinstance(rows, list) and len(rows) >= 3)
        labels = [qa.first_label(row) for row in rows] if valid else []
        if valid and (any(not qa.norm(label) for label in labels)
                      or len({qa.norm(label) for label in labels}) != len(labels)):
            valid = False
        for position in ('second', 'last'):
            case_id = f'{base_id}_{position}'
            entry = {'id': case_id, 'source_http': code,
                     'status': 'BLOCKED_SOURCE' if not valid else 'NOT_RUN'}
            if valid:
                target = labels[1] if position == 'second' else labels[-1]
                question = make_question(language, vi_subject if language == 'vi' else en_subject, position)
                start = time.monotonic()
                agent_code, payload = qa.request_json(front + '/api/agent/chat',
                                                       {'message': question, 'language': language}, timeout=90)
                reply = payload.get('reply') if isinstance(payload, dict) else ''
                if not isinstance(reply, str):
                    reply = ''
                passed, signals = judge(reply, target, [x for x in labels if x != target], language)
                entry.update({'status': 'PASS' if agent_code == 200 and passed else 'FAIL',
                              'agent_http': agent_code, 'source_rows': len(labels),
                              'elapsed_ms': round((time.monotonic() - start) * 1000), **signals})
            out['results'].append(entry)
            # Deliberately print just public case names and aggregate non-sensitive diagnostics.
            print('PTSCPS_INDEPENDENT_FACT_CASE=' + json.dumps({k: entry.get(k) for k in
                   ('id', 'status', 'agent_http', 'expected_label_matched')}, sort_keys=True))
    summary = {'total': 8, 'passed': sum(x['status'] == 'PASS' for x in out['results']),
               'failed': sum(x['status'] == 'FAIL' for x in out['results']),
               'blocked': sum(x['status'] == 'BLOCKED_SOURCE' for x in out['results'])}
    out['summary'] = summary
    path = Path('audit/ptscps-agent-independent-fact-summary.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_INDEPENDENT_FACT_SUMMARY=' + json.dumps(summary, sort_keys=True))
    if summary['passed'] != 8:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
