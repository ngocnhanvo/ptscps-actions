#!/usr/bin/env python3
"""Production paraphrase-consistency QA for PTSCPS knowledge retrieval.

This intentionally does not hardcode a TablePress id or expected answer. It asks
semantically equivalent questions and checks that both routes return verified-looking
non-fallback answers with meaningful overlap. Raw answers/questions are never written
to artifacts or logs.
"""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

MODULE = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('ptscps_grounded', MODULE)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

PAIRS = (
    (
        'vi_projects', 'vi',
        'dự án tiêu biểu của pps là gì',
        'Những công trình khẳng định năng lực PPS là gì',
    ),
    (
        'en_projects', 'en',
        "What are PPS's featured projects?",
        "Which projects demonstrate PPS's capabilities?",
    ),
)

FALLBACK = re.compile(
    r'(?:dữ liệu website hiện tại chưa có thông tin xác thực|chưa có thông tin xác thực|'
    r'không tìm thấy dữ liệu|no verified information|no verified website information|'
    r'cannot process|try again later)', re.I
)
STOP = {
    'la','gi','cua','nhung','cac','duoc','tren','va','cho','mot','pps',
    'what','are','is','the','of','which','does','do','pps','s','a','an','and',
    'projects','project','featured','demonstrate','capabilities',
    'du','an','tieu','bieu','cong','trinh','khang','dinh','nang','luc',
}


def ask(front: str, question: str, language: str):
    code, payload = qa.request_json(
        front + '/api/agent/chat', {'message': question, 'language': language}, timeout=90
    )
    # Exactly one bounded retry for the already-observed transient 503 class.
    if code == 503:
        time.sleep(2)
        code, payload = qa.request_json(
            front + '/api/agent/chat', {'message': question, 'language': language}, timeout=90
        )
    reply = payload.get('reply') if isinstance(payload, dict) else ''
    return code, reply if isinstance(reply, str) else ''


def significant_tokens(text: str) -> set[str]:
    normalized = qa.norm(text)
    words = re.findall(r'[a-z0-9]+', normalized)
    return {w for w in words if len(w) >= 3 and w not in STOP}


def compare(left: str, right: str, language: str):
    left_fallback = bool(FALLBACK.search(left)) or not qa.norm(left)
    right_fallback = bool(FALLBACK.search(right)) or not qa.norm(right)
    left_tokens = significant_tokens(left)
    right_tokens = significant_tokens(right)
    shared = left_tokens & right_tokens
    union = left_tokens | right_tokens
    similarity = (len(shared) / len(union)) if union else 0.0
    locale_leak = language == 'en' and bool(
        re.search(r'\b(?:dự án|công trình|khẳng định|năng lực|không có dữ liệu)\b', left + ' ' + right, re.I)
    )
    passed = (
        not left_fallback and not right_fallback and not locale_leak
        and len(shared) >= 3 and similarity >= 0.12
    )
    return passed, {
        'left_fallback': left_fallback,
        'right_fallback': right_fallback,
        'shared_significant_tokens': len(shared),
        'token_similarity_milli': round(similarity * 1000),
        'locale_leak': locale_leak,
    }


def selftest():
    good_a = 'FPSO Alpha; FSO Beta; Offshore Gamma project.'
    good_b = 'The featured projects include FPSO Alpha, FSO Beta and Offshore Gamma.'
    bad = 'No verified website information is available.'
    assert compare(good_a, good_b, 'en')[0]
    assert not compare(bad, good_b, 'en')[0]
    assert not compare('', good_b, 'en')[0]
    print('PTSCPS_SEMANTIC_PARAPHRASE_SELFTEST=PASS assertions=3')


def main():
    if '--self-test' in sys.argv:
        selftest()
        return
    front = qa.origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {
        'schema': 1,
        'mode': 'production_read_only_chat',
        'scope': 'semantic_paraphrase_consistency_vi_en',
        'source_php': 'a5d65e8df6748b055b10967d96e88d33afe19d66',
        'results': [],
        'notes': [
            'No answer text, question text, credentials, session ids or source ids are persisted.',
            'This validates paraphrase consistency only; it does not promote RUN03 corpus recall to PASS.',
            'No CMS/index mutation and no Astro build.',
        ],
    }
    for case_id, language, left_q, right_q in PAIRS:
        started = time.monotonic()
        left_code, left_reply = ask(front, left_q, language)
        right_code, right_reply = ask(front, right_q, language)
        passed, signals = compare(left_reply, right_reply, language)
        item = {
            'id': case_id,
            'left_http': left_code,
            'right_http': right_code,
            'status': 'PASS' if left_code == 200 and right_code == 200 and passed else 'FAIL',
            'elapsed_ms': round((time.monotonic() - started) * 1000),
            **signals,
        }
        report['results'].append(item)
        print('PTSCPS_SEMANTIC_PARAPHRASE_CASE=' + json.dumps(item, sort_keys=True))

    report['summary'] = {
        'total': len(PAIRS),
        'passed': sum(x['status'] == 'PASS' for x in report['results']),
        'failed': sum(x['status'] == 'FAIL' for x in report['results']),
    }
    out = Path('audit/ptscps-agent-semantic-paraphrase-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_SEMANTIC_PARAPHRASE_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['passed'] != len(PAIRS):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
