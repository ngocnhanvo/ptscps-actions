#!/usr/bin/env python3
"""Sanitized Gemini auth/model diagnostic for PTSCPS fallback configuration.

Exactly three read-only Google API requests: list models plus one lookup for each
configured fallback model. Also reports only booleans/counts about wp-config provider
configuration. Never persists API keys, provider messages, model response text,
credentials, prompts, sessions or production content.
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
SAFE_REASON = re.compile(r'^[A-Z][A-Z0-9_]{0,79}$')
SAFE_DOMAIN = re.compile(r'^[a-z0-9.-]{1,120}$')


def env_value(name: str) -> str:
    p = re.compile(r'^\s*(?:export\s+)?' + re.escape(name) + r'\s*=\s*(.*)\s*$')
    vals = []
    for line in os.environ.get('ENV_FILE', '').splitlines():
        m = p.match(line)
        if not m:
            continue
        value = m.group(1).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        vals.append(value)
    return vals[0] if len(vals) == 1 else ''


def production_config() -> tuple[str, dict]:
    raw = os.environ.get('FTP_SERVER', '').strip()
    if '://' not in raw:
        raw = 'ftp://' + raw
    ftp_url = urlsplit(raw)
    wc_url = urlsplit(env_value('WC_URL'))
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
        buf = io.BytesIO(); ftp.retrbinary('RETR wp-config.php', buf.write)
    finally:
        try: ftp.quit()
        except Exception:
            try: ftp.close()
            except Exception: pass
    text = buf.getvalue().decode('utf-8', errors='replace')
    direct = env_value('GEMINI_API_KEY')
    key_source = 'env' if direct else 'wp_config'
    key = direct
    if not key:
        m = re.search(r"define\s*\(\s*['\"]GEMINI_API_KEY['\"]\s*,\s*(['\"])(.*?)\1\s*\)", text, re.S)
        if not m or not m.group(2).strip():
            raise RuntimeError('Gemini key not configured')
        key = m.group(2).strip()
    flags = {
        'explicit_provider_config_defined': bool(re.search(r"define\s*\(\s*['\"]ESC_AGENT_LLM_PROVIDERS['\"]", text)),
        'wp_config_gemini_key_defined': bool(re.search(r"define\s*\(\s*['\"]GEMINI_API_KEY['\"]", text)),
        'key_source': key_source,
        'explicit_config_mentions_gemini': bool('ESC_AGENT_LLM_PROVIDERS' in text and re.search(r"['\"]provider['\"]\s*=>\s*['\"]gemini['\"]", text, re.I)),
        'explicit_config_references_gemini_key_constant': bool('ESC_AGENT_LLM_PROVIDERS' in text and 'GEMINI_API_KEY' in text),
    }
    return key, flags


def request_json(url: str) -> tuple[int, dict]:
    req = Request(url, headers={'Accept':'application/json','User-Agent':'PTSCPS-gemini-auth-diagnostic/1.0'}, method='GET')
    try:
        with urlopen(req, timeout=20) as response:
            code, raw = response.status, response.read(250000)
    except HTTPError as error:
        code, raw = error.code, error.read(250000)
    except (URLError, TimeoutError):
        return 0, {}
    try:
        obj = json.loads(raw)
        return code, obj if isinstance(obj, dict) else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return code, {}


def compact(operation: str, code: int, body: dict) -> dict:
    err = body.get('error') if isinstance(body.get('error'), dict) else {}
    status = str(err.get('status') or '')
    if status not in SAFE_STATUS:
        status = 'OTHER' if status else ''
    reasons, domains = [], []
    details = err.get('details') if isinstance(err.get('details'), list) else []
    for detail in details[:8]:
        if not isinstance(detail, dict):
            continue
        reason = str(detail.get('reason') or '')
        domain = str(detail.get('domain') or '')
        if SAFE_REASON.fullmatch(reason) and reason not in reasons:
            reasons.append(reason)
        if SAFE_DOMAIN.fullmatch(domain) and domain not in domains:
            domains.append(domain)
    return {
        'operation': operation,
        'http_status': code,
        'error_status': status,
        'error_reasons': reasons[:4],
        'error_domains': domains[:4],
    }


def main() -> None:
    key, config = production_config()
    base = 'https://generativelanguage.googleapis.com/v1beta/models'
    results = []
    code, body = request_json(base + '?' + urlencode({'key': key, 'pageSize': 1}))
    results.append(compact('models_list', code, body))
    for model in MODELS:
        code, body = request_json(base + '/' + quote(model, safe='') + '?' + urlencode({'key': key}))
        results.append({'model': model, **compact('model_lookup', code, body)})
    report = {
        'schema': 1,
        'scope': 'gemini_auth_model_reason_sanitized',
        'requests_expected': 3,
        'requests_observed': len(results),
        'production_config': config,
        'results': results,
        'notes': [
            'No API key, provider message, response text, prompt, credential or production content persisted.',
            'Only sanitized Google error status/reason/domain and wp-config booleans are retained.',
            'No Agent chat request, CMS/index mutation, PHP release, reindex or Astro build.',
        ],
    }
    out = Path('audit/ptscps-agent-gemini-auth-diagnostic-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print('PTSCPS_GEMINI_AUTH_DIAGNOSTIC=' + json.dumps({
        'requests': len(results),
        'http_200': sum(x['http_status'] == 200 for x in results),
        'http_400': sum(x['http_status'] == 400 for x in results),
    }, sort_keys=True))
    if len(results) != 3:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
