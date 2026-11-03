#!/usr/bin/env python3
"""One EN first-service factual request with permissioned provider/skill telemetry.

Reuses existing proven run04 trace transport and strict FTPS origin checks.
Raw questions, answers, customer records, tokens and sessions never enter artifacts.
"""
import importlib.util
import json
from pathlib import Path
import sys

script = Path(__file__).with_name('ptscps-agent-run04-en-503-trace.py')
spec = importlib.util.spec_from_file_location('ptscps_existing_run04_trace', script)
if spec is None or spec.loader is None:
    raise RuntimeError('Unable to load existing validated trace')
trace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trace)

trace.CASE = 'en_service_first'
trace.QUESTION = ('What is the first service area shown in the PTSC homepage service '
                  'section? Give only its name.')
trace.EVENTS = trace.EVENTS | {
    'plan_execution_start', 'skill_start', 'skill_result', 'skill_error',
}
trace.FIELDS = trace.FIELDS | {
    'skill', 'action', 'result_count', 'requires_synthesis', 'direct_response', 'status',
}

trace.main()
original = Path('audit/ptscps-agent-run04-en-503-summary.json')
result = json.loads(original.read_text(encoding='utf-8'))
if result.get('case') != 'en_service_first' or result.get('request_count') != 1:
    raise RuntimeError('Unexpected telemetry case or request count')
result['scope'] = 'single_en_fact_first_service_provider_and_skill_trace'
original.unlink()
output = Path('audit/ptscps-agent-en-fact-trace-summary.json')
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
print('PTSCPS_EN_FACT_TRACE=' + json.dumps({
    'http': result.get('frontend', {}).get('http'),
    'answered': result.get('frontend', {}).get('answered'),
    'trace_events': len(result.get('events', [])) if isinstance(result.get('events'), list) else 0,
    'trace_readable': bool(result.get('events')) and isinstance(result.get('events'), list),
}, sort_keys=True))
if not isinstance(result.get('events'), list) or not result.get('events'):
    sys.exit(2)
