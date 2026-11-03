#!/usr/bin/env python3
"""Recheck ONLY the two still-failing customer ordinal cases after guarded PHP release."""
import importlib.util
import json
from pathlib import Path

path = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('grounded', path)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
qa.CASES = tuple(case for case in qa.CASES if case[0] in ('vi_client_first', 'en_client_first'))
if [c[0] for c in qa.CASES] != ['vi_client_first', 'en_client_first']:
    raise RuntimeError('Ordinal customer QA scope mismatch')
exit_code = 0
try:
    qa.main()
except SystemExit as exc:
    exit_code = exc.code if isinstance(exc.code, int) else 1
p = Path('audit/ptscps-agent-fact-intent-summary.json')
report = json.loads(p.read_text(encoding='utf-8'))
if len(report.get('results', [])) != 2:
    raise RuntimeError('Wrong request count')
report['scope'] = 'first_client_vi_en_only_after_original_query_retrieval_fix'
report['source_php'] = '4f8e755c6a9f11c3b1fd22b2bfc5fc8fa7a0c1ab'
report['baseline_run'] = 41601228430
Path('audit/ptscps-agent-first-client-only-summary.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
p.unlink()
print('PTSCPS_CLIENT_ORIGINAL_QUERY_QA=' + json.dumps(report['summary'], sort_keys=True))
raise SystemExit(exit_code)
