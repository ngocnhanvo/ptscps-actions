#!/usr/bin/env python3
"""Bounded Gemini fallback compatibility probe for PTSCPS Agent.

Reads the already-configured Gemini key without printing it and runs exactly four
read-only API checks per configured fallback model: model lookup, minimal generate,
JSON mode without schema, and JSON mode with a tiny schema. Artifacts retain only
HTTP/status/category booleans; no key, prompt, response text, provider message,
credentials, or production content is persisted.
"""
from __future__ import annotations
import ftplib
import io
import json
import os
from pathlib import Path
import re
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

MODELS = ('gemini-3.1-flash-lite', 'gemini-3.5-flash-lite')
SAFE_STATUS = {
    'INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
    'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNKNOWN',
}

def env_file_value(name: str) -> str:
    pattern = re.compile(r'^\s*(?:export\s+)?' + re.escape(name) + r'\s*=\s*(.*)\s*$')
    values = []
    for line in os.environ.get('ENV_FILE', '').splitlines():
        m = pattern.match(line)
        if not m:
            continue
        value = m.group(1).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values.append(value)
    return values[0] if len(values) == 1 else ''

def configured_key() -> str:
    direct = env_file_value('GEMINI_API_KEY')
    if direct:
        return direct

    raw = os.environ.get('FTP_SERVER', '').strip()
    if '://' not in raw:
        raw = 'ftp://' + raw
    ftp_url = urlsplit(raw)
    wc_url = urlsplit(env_file_value('WC_URL'))
    if (not ftp_url.hostname or ftp_url.scheme not in ('ftp', 'ftps') or ftp_url.port not in (None, 21)
            or ftp_url.username or ftp_url.password or ftp_url.path.strip('/')
            or wc_url.scheme != 'https' or not wc_url.hostname or wc_url.port not in (None, 443)
            or wc_url.path not in ('', '/') or wc_url.query or wc_url.fragment
            or not os.environ.get('FTP_USERNAME') or not os.environ.get('FTP_PASSWORD')):
        raise RuntimeError('validated production configuration unavailable')

    root = f'/domains/{wc_url.hostname}/public_html'
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25)
    try:
        ftp.connect(ftp_url.hostname, ftp_url.port or 21)
        ftp.auth(); ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD']); ftp.prot_p()
        ftp.cwd(root)
        if ftp.pwd().rstrip('/') != root.rstrip('/'):
            raise RuntimeError('remote root mismatch')
        buf = io.BytesIO()
        ftp.retrbinary('RETR wp-config.php', buf.write)
    finally:
        try: ftp.quit()
        except Exception:
            try: ftp.close()
            except Exception: pass
    text = buf.getvalue().decode('utf-8', errors='replace')
    m = re.search(r"define\s*\(\s*['\"]GEMINI_API_KEY['\"]\s*,\s*(['\"])(.*?)\1\s*\)", text, re.S)
    if not m or not m.group(2).strip():
        raise RuntimeError('Gemini key not configured')
    return m.group(2).strip()

def request_json(url: str, payload: dict | None = None) -> tuple[int, dict]:
    headers = {'Accept': 'application/json', 'User-Agent': 'PTSCPS-gemini-compat-probe/1.0'}
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    req = Request(url, data=data, headers=headers, method='POST' if payload is not None else 'GET')
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read(250000)
            code = response.status
    except HTTPError as error:
        code = error.code
        raw = error.read(250000)
    except (URLError, TimeoutError):
        return 0, {}
    try:
        decoded = json.loads(raw)
        return code, decoded if isinstance(decoded, dict) else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return code, {}

def compact(operation: str, code: int, body: dict, expect_json: bool = False) -> dict:
    err = body.get('error') if isinstance(body.get('error'), dict) else {}
    status = str(err.get('status') or '')
    if status not in SAFE_STATUS:
        status = 'OTHER' if status else ''
    candidates = body.get('candidates') if isinstance(body.get('candidates'), list) else []
    text = ''
    if candidates and isinstance(candidates[0], dict):
        content = candidates[0].get('content') if isinstance(candidates[0].get('content'), dict) else {}
        parts = content.get('parts') if isinstance(content.get('parts'), list) else []
        if parts and isinstance(parts[0], dict) and isinstance(parts[0].get('text'), str):
            text = parts[0]['text'].strip()
    json_valid = False
    if expect_json and text:
        try:
            json_valid = isinstance(json.loads(text), dict)
        except json.JSONDecodeError:
            json_valid = False
    return {
        'operation': operation,
        'http_status': code,
        'error_status': status,
        'response_has_candidate_text': bool(text),
        'json_valid': json_valid if expect_json else None,
    }

def main() -> None:
    key = configured_key()
    base = 'https://generativelanguage.googleapis.com/v1beta/models/'
    results = []
    for model in MODELS:
        lookup_code, lookup_body = request_json(base + quote(model, safe='') + '?' + urlencode({'key': key}))
        results.append({'model': model, **compact('model_lookup', lookup_code, lookup_body)})

        endpoint = base + quote(model, safe='') + ':generateContent?' + urlencode({'key': key})
        minimal = {
            'contents': [{'role': 'user', 'parts': [{'text': 'Reply with OK.'}]}],
            'generationConfig': {'maxOutputTokens': 64},
        }
        code, body = request_json(endpoint, minimal)
        results.append({'model': model, **compact('minimal_generate', code, body)})

        common = {
            'system_instruction': {'parts': [{'text': 'Return only a JSON object with boolean field ok.'}]},
            'contents': [{'role': 'user', 'parts': [{'text': 'Set ok to true.'}]}],
        }
        no_schema = dict(common)
        no_schema['generationConfig'] = {'maxOutputTokens': 64, 'responseMimeType': 'application/json'}
        code, body = request_json(endpoint, no_schema)
        results.append({'model': model, **compact('json_no_schema', code, body, True)})

        with_schema = dict(common)
        with_schema['generationConfig'] = {
            'maxOutputTokens': 64,
            'responseMimeType': 'application/json',
            'responseJsonSchema': {
                'type': 'object',
                'properties': {'ok': {'type': 'boolean'}},
                'required': ['ok'],
                'additionalProperties': False,
            },
        }
        code, body = request_json(endpoint, with_schema)
        results.append({'model': model, **compact('json_with_schema', code, body, True)})

    report = {
        'schema': 1,
        'scope': 'gemini_fallback_direct_compatibility_bounded',
        'requests_expected': len(MODELS) * 4,
        'requests_observed': len(results),
        'results': results,
        'notes': [
            'No API key, prompt, response text, provider message, credential or production content persisted.',
            'Exactly four bounded read-only API operations per configured Gemini fallback model.',
            'No Agent chat request, CMS/index mutation, PHP release, reindex or Astro build.',
        ],
    }
    out = Path('audit/ptscps-agent-gemini-direct-compat-probe-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_GEMINI_COMPAT_SUMMARY=' + json.dumps({
        'requests': len(results),
        'http_200': sum(x['http_status'] == 200 for x in results),
        'http_400': sum(x['http_status'] == 400 for x in results),
    }, sort_keys=True))
    if len(results) != len(MODELS) * 4:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
