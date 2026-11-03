#!/usr/bin/env python3
"""One-shot provider-only confirmation for the final compact Qwen EN paraphrase case."""
from __future__ import annotations
import importlib.util, json, subprocess
from pathlib import Path

MODULE = Path(__file__).with_name('ptscps-agent-groq-qwen-compact-probe.py')
spec = importlib.util.spec_from_file_location('qwen_compact_probe', MODULE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

CASE = 'en_projects_paraphrase'
QUESTION = "Which projects demonstrate PPS's capabilities?"

def main():
    prompt = subprocess.run(
        ['php','scripts/ptscps-agent-compact-planner-helper.php','source-php'],
        text=True,capture_output=True,timeout=20,check=True
    ).stdout
    code, raw, provider_error, usage = probe.call(probe.key(), prompt, QUESTION)
    validated = probe.validate(raw)
    expected = bool(
        code == 200 and validated.get('valid')
        and validated.get('skill') == 'knowledge'
        and validated.get('action') == 'search'
        and validated.get('mode') == 'collection'
    )
    item = {
        'case': CASE,
        'status': 'PASS' if expected else 'FAIL',
        'http_status': code,
        'provider_error': provider_error,
        'valid_plan': bool(validated.get('valid')),
        'reason': str(validated.get('reason') or '')[:40],
        'skill': str(validated.get('skill') or '')[:32],
        'action': str(validated.get('action') or '')[:32],
        'mode': str(validated.get('mode') or '')[:24],
        'prompt_chars': len(prompt),
    }
    for key in ('prompt_tokens','completion_tokens','total_tokens'):
        if isinstance(usage.get(key), int): item[key] = usage[key]
    report = {
        'schema': 1,
        'scope': 'groq_qwen38_compact_en_projects_one_shot',
        'source_php': probe.SOURCE,
        'model': probe.MODEL,
        'result': item,
        'notes': [
            'Provider-only one-shot confirmation after the six-case burst hit model token rate limit.',
            'No Agent chat, CMS/index mutation, credential, raw provider response or source fact persisted.',
        ],
    }
    out = Path('audit/ptscps-agent-groq-qwen-compact-en-one-shot-summary.json')
    out.write_text(json.dumps(report, indent=2, sort_keys=True)+'\n', encoding='utf-8')
    print('PTSCPS_GROQ_QWEN_COMPACT_EN_ONE_SHOT=' + json.dumps(item, sort_keys=True))
    if not expected: raise SystemExit(1)

if __name__ == '__main__': main()
