#!/usr/bin/env python3
"""Three failed fact cases after the ordinal source-order release, no PASS repeats.

Use the existing approved source-grounded evaluator and rewrite only sanitized
artifact metadata to identify the exact newly released PHP source.
"""
import json
from pathlib import Path
import runpy

result_code = 0
try:
    runpy.run_path('scripts/ptscps-agent-postrelease-fact-retest.py', run_name='__main__')
except SystemExit as exc:
    result_code = exc.code if isinstance(exc.code, int) else 1

original = Path('audit/ptscps-agent-postrelease-fact-summary.json')
if not original.is_file():
    raise RuntimeError('Missing sanitized source-grounded retest summary')
result = json.loads(original.read_text(encoding='utf-8'))
if len(result.get('results', [])) != 3:
    raise RuntimeError('Wrong scoped request count')
result['source_php'] = 'b8e5726902835e8274dfcdae803b87e5638a14a1'
result['baseline_run'] = 41586710186
result['scope'] = 'ordinal_source_order_retest_three_previously_failed_cases_only'
output = Path('audit/ptscps-agent-ordinal-fact-summary.json')
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
original.unlink()
print('PTSCPS_ORDINAL_POSTRELEASE=' + json.dumps(result['summary'], sort_keys=True))
raise SystemExit(result_code)
