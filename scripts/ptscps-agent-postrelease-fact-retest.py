#!/usr/bin/env python3
"""Exactly three previously FAILED cases; do not repeat the PASS vi_service_first.

Original source-grounded QA is reused, with no raw responses persisted.
"""
import importlib.util
import json
from pathlib import Path

source = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('ptscps_fact_grounded', source)
if spec is None or spec.loader is None:
    raise RuntimeError('Missing source-grounded case evaluator')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
previous_failures = ('en_service_first', 'vi_client_first', 'en_client_first')
qa.CASES = tuple(case for case in qa.CASES if case[0] in previous_failures)
if tuple(case[0] for case in qa.CASES) != previous_failures:
    raise RuntimeError('Recheck scope drift')
exit_code = 0
try:
    qa.main()
except SystemExit as exc:
    exit_code = exc.code if isinstance(exc.code, int) else 1
p = Path('audit/ptscps-agent-fact-intent-summary.json')
result = json.loads(p.read_text(encoding='utf-8'))
if len(result.get('results', [])) != 3:
    raise RuntimeError('Wrong request count')
result['scope'] = 'post_release_retest_three_failed_fact_intent_cases_only'
result['source_php'] = '43dc22895f009f6b57d3c9ee855b2d464dabedf4'
result['baseline_run'] = 41584499949
output = Path('audit/ptscps-agent-postrelease-fact-summary.json')
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
p.unlink()
print('PTSCPS_FACT_POSTRELEASE=' + json.dumps(result['summary'], sort_keys=True))
raise SystemExit(exit_code)
