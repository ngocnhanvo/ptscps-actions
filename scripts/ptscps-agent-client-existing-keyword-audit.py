#!/usr/bin/env python3
"""Read exactly two EXISTING opt-in first-customer logs; no new LLM call.

Only categorical comparisons to canonical QA questions may leave the runner.
Never persist the selected keyword, source IDs, prompt, answer or raw events.
"""
import ftplib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import ssl
from urllib.parse import urlsplit

SOURCE = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('fact_qa', SOURCE)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
CASES = [(case, lang, question) for case, lang, table, question in qa.CASES
         if case in ('vi_client_first', 'en_client_first')]
assert [x[0] for x in CASES] == ['vi_client_first', 'en_client_first']
RUN = 'clienttrace41601228430'
ROOT = '/domains/admin-ptscps.thegioihosting.io.vn/public_html/wp-content/esc-agent-debug/regression/' + RUN


def inspect(events, question, lang):
    selected = [e for e in events if isinstance(e, dict)
                and e.get('event') == 'skill_start' and e.get('skill') == 'knowledge'
                and e.get('action') == 'search']
    params = selected[0].get('params', {}) if selected else {}
    params = params if isinstance(params, dict) else {}
    keyword = params.get('keyword')
    keyword = keyword if isinstance(keyword, str) else ''
    norm = qa.norm(keyword)
    canonical = qa.norm(question)
    ordinal = 'dau tien' if lang == 'vi' else 'first'
    subject = 'khach hang' if lang == 'vi' else 'customer'
    locator = ('trang chu', 'muc') if lang == 'vi' else ('homepage', 'section')
    return {
        'knowledge_selected':bool(selected),
        'keyword_nonempty':bool(norm),
        'keyword_equals_original':norm == canonical,
        'keyword_logger_may_truncate':len(keyword) >= 160,
        'keyword_contains_ordinal':ordinal in norm,
        'keyword_contains_subject':subject in norm,
        'keyword_contains_locator':any(x in norm for x in locator),
        'requested_mode':params.get('mode') if params.get('mode') in ('fact','auto','collection','articles') else 'unknown',
        'keyword_word_count':min(len(norm.split()), 200),
    }


def main():
    assert inspect([{'event':'skill_start','skill':'knowledge','action':'search','params':{'keyword':CASES[0][2]}}], CASES[0][2], 'vi')['keyword_equals_original']
    u = urlsplit(os.environ['FTP_SERVER'] if '://' in os.environ['FTP_SERVER'] else 'ftp://' + os.environ['FTP_SERVER'])
    if u.scheme not in ('ftp','ftps') or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
        raise RuntimeError('Unsafe FTPS configuration')
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
    result = {'schema':1, 'scope':'existing_two_regression_logs_keyword_comparison_only', 'run_id':RUN, 'cases':[]}
    try:
        ftp.connect(u.hostname, u.port or 21)
        ftp.auth()
        ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        ftp.prot_p()
        for case,lang,question in CASES:
            ftp.cwd(ROOT + '/' + case)
            files = [x.rsplit('/',1)[-1] for x in ftp.nlst()]
            matches = [name for name in files if re.fullmatch(r'turn-01_req_[0-9a-f]{24}\.jsonl', name)]
            if len(matches) != 1: raise RuntimeError('Exact opt-in case trace missing or ambiguous')
            contents = io.BytesIO()
            ftp.retrbinary('RETR ' + matches[0], contents.write)
            if len(contents.getvalue()) > 256000: raise RuntimeError('Oversized trace')
            events = []
            for line in contents.getvalue().splitlines():
                try:
                    entry = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(entry, dict) and entry.get('event') == 'skill_start':
                    events.append(entry)
            flags = inspect(events, question, lang)
            item = {'case':case, **flags}
            result['cases'].append(item)
            print('PTSCPS_HISTORICAL_KEYWORD_FLAGS=' + json.dumps(item,sort_keys=True))
    finally:
        try: ftp.quit()
        except (ftplib.all_errors, OSError, EOFError): pass
    Path('audit/ptscps-agent-client-existing-keyword-summary.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    if len(result['cases']) != 2 or not all(x['knowledge_selected'] for x in result['cases']):
        raise RuntimeError('Two historical knowledge tool traces were not available')

if __name__ == '__main__':
    main()
