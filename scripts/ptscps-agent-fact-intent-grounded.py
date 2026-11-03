#!/usr/bin/env python3
"""Four bounded source-grounded *fact-intent* live QA probes, not collection QA.

The first CMS row is a factual positional answer, absent from the question.
Never export/log raw source labels, prompts, answers, sessions, or secrets.
No CMS mutations, indexing, PHP release, or Astro build.
"""
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

CASES = (
    ('vi_service_first', 'vi', 'home_01',
     'Lĩnh vực dịch vụ đầu tiên được giới thiệu trên trang chủ PTSC là gì? Hãy chỉ nêu tên của lĩnh vực đó.'),
    ('en_service_first', 'en', 'home_01_en',
     'What is the first service area shown in the PTSC homepage service section? Give only its name.'),
    ('vi_client_first', 'vi', 'home_15',
     'Khách hàng đầu tiên trong mục khách hàng tiêu biểu trên trang chủ PTSC là ai? Hãy chỉ nêu tên.'),
    ('en_client_first', 'en', 'home_15_en',
     'Which customer appears first in the PTSC homepage featured customers section? Give only its name.'),
)


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.words = []
        self.alts = []

    def handle_data(self, content):
        self.words.append(content)

    def handle_starttag(self, tag, attrs):
        if tag == 'img' and dict(attrs).get('alt'):
            self.alts.append(dict(attrs)['alt'])


def as_text(raw):
    parser = Text()
    parser.feed(str(raw or ''))
    return ' '.join(' '.join(parser.words).split()), [x.strip() for x in parser.alts if x.strip()]


def norm(raw):
    text = unicodedata.normalize('NFD', str(raw).casefold().replace('đ', 'd'))
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', text).split())


def first_label(item):
    if not isinstance(item, dict):
        return ''
    label, _ = as_text(item.get('title', ''))
    if label:
        return label
    for field in ('image', 'logo', 'icon'):
        _, labels = as_text(item.get(field, ''))
        if labels:
            return labels[0]
    return ''


def origin(key, required_host):
    matches = [line.strip().removeprefix('export ').split('=', 1)[1].strip().strip('"\'')
               for line in os.environ['ENV_FILE'].splitlines()
               if re.fullmatch(r'\s*(?:export\s+)?' + re.escape(key) + r'\s*=.*', line)]
    if len(matches) != 1:
        raise ValueError('Missing or duplicate origin')
    url = urlsplit(matches[0])
    if (url.scheme != 'https' or url.hostname != required_host or url.port or
            url.username or url.password or url.path not in ('', '/') or url.query or url.fragment):
        raise ValueError('Unexpected configured production origin')
    return 'https://' + url.netloc


def request_json(url, payload=None, timeout=75):
    headers = {'Accept': 'application/json', 'User-Agent': 'PTSCPS-fact-intent-readonly/1.0'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    request = Request(url, headers=headers, method='POST' if payload is not None else 'GET',
                      data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read(350000))
    except HTTPError as error:
        return error.code, {}
    except (URLError, TimeoutError, ValueError):
        return 0, {}


def grade(reply, label, other_labels, lang):
    actual, expected = norm(reply), norm(label)
    matches_first = bool(expected) and (' ' + expected + ' ') in (' ' + actual + ' ')
    unrelated = [value for value in other_labels
                 if value != expected and len(value) >= 7 and
                 (' ' + value + ' ') in (' ' + actual + ' ')]
    too_long = len(actual) > len(expected) + 115
    locale_leak = bool(lang == 'en' and re.search(r'[ăâđêôơưĂÂĐÊÔƠƯ]', reply))
    fallback = bool(re.search(r'no verified information|chưa có thông tin xác thực|'
                              r'cannot process|không tìm thấy dữ liệu', reply, re.I))
    return matches_first and not unrelated and not too_long and not locale_leak and not fallback, {
        'expected_exact_in_answer': matches_first,
        'other_published_labels_in_answer': len(unrelated),
        'overlong_reply': too_long,
        'locale_leak_detected': locale_leak,
        'fallback_detected': fallback,
    }


def selftest():
    assert first_label({'title': '<strong>PTSC Marine</strong>'}) == 'PTSC Marine'
    assert first_label({'image': '<img alt="PTSC Maritime" src="/asset.png" />'}) == 'PTSC Maritime'
    assert first_label({'title': '', 'image': '<img src="/asset.png" />'}) == ''
    assert norm('DỊCH VỤ DẦU KHÍ') == 'dich vu dau khi'
    assert grade('PTSC Marine', 'PTSC Marine', ['other company'], 'en')[0]
    assert not grade('PTSC Marine; Other Company', 'PTSC Marine', ['other company'], 'en')[0]
    assert not grade('Unknown', 'PTSC Marine', [], 'en')[0]
    print('PTSCPS_FACT_INTENT_SELFTEST=PASS 7 assertions')


def main():
    if '--self-test' in sys.argv:
        selftest()
        return
    wp = origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    front = origin('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn')
    report = {'schema': 1, 'scope': 'four_source_grounded_first_item_facts',
              'source_php': 'cb612e024a946b3d87b775a31f8ca70a48aae331',
              'results': [], 'notes': [
                  'Four factual positional prompts, not collection/list questions.',
                  'Expected answers are taken at runtime from published TablePress first rows.',
                  'No raw questions, labels, answers, tokens, credentials or sessions are persisted.',
                  'This is NOT RUN03 recall@5 nor 100-question RUN07 acceptance.',
              ]}
    for case, lang, table_id, question in CASES:
        http, table = request_json(wp + '/wp-json/tablepress/v1/table/' + quote(table_id), timeout=30)
        entry = {'id': case, 'status': 'BLOCKED_SOURCE', 'source_http': http}
        if (http != 200 or not isinstance(table, dict) or table.get('success') is not True or
                table.get('id') != table_id or not isinstance(table.get('items'), list) or
                len(table['items']) < 2):
            report['results'].append(entry)
            continue
        labels = [first_label(row) for row in table['items']]
        if not labels[0] or not norm(labels[0]) or len(norm(labels[0])) < 7:
            report['results'].append(entry)
            continue
        begin = time.monotonic()
        code, answer = request_json(front + '/api/agent/chat',
                                    {'message': question, 'language': lang}, timeout=90)
        reply = answer.get('reply') if isinstance(answer, dict) else ''
        if not isinstance(reply, str):
            reply = ''
        ok, signals = grade(reply, labels[0], [norm(x) for x in labels[1:] if norm(x)], lang)
        entry = {'id': case, 'status': 'PASS' if code == 200 and ok else 'FAIL',
                 'source_http': http, 'source_rows': len(table['items']),
                 'agent_http': code, 'elapsed_ms': round((time.monotonic()-begin)*1000),
                 'expected_label_sha256': hashlib.sha256(norm(labels[0]).encode()).hexdigest(),
                 'answer_sha256': hashlib.sha256(reply.encode()).hexdigest(), **signals}
        report['results'].append(entry)
        print('PTSCPS_FACT_INTENT_PROBE=' + json.dumps({
            'id': case, 'status': entry['status'], 'source_http': http, 'agent_http': code,
            'expected_exact_in_answer': signals['expected_exact_in_answer']}, sort_keys=True))
    report['summary'] = {'total': len(CASES), 'passed': sum(r['status'] == 'PASS' for r in report['results']),
                         'failed': sum(r['status'] == 'FAIL' for r in report['results']),
                         'blocked_source': sum(r['status'] == 'BLOCKED_SOURCE' for r in report['results'])}
    output = Path('audit/ptscps-agent-fact-intent-summary.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_FACT_INTENT_SUMMARY=' + json.dumps(report['summary'], sort_keys=True))
    if report['summary']['passed'] != len(CASES):
        sys.exit(1)


if __name__ == '__main__':
    main()
