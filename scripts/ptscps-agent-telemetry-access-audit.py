#!/usr/bin/env python3
"""Check only FTPS CWD accessibility for the existing Agent telemetry tree.

No directory listing, file reads, writes, LLM requests, WordPress calls, or
production state changes. Never output the FTP username, host, or actual path.
FTP 550 is intentionally labeled denied_or_missing: it cannot distinguish both.
"""
import ftplib
import json
import os
import ssl
from pathlib import Path
from urllib.parse import urlsplit

PREFIX = '/domains/admin-ptscps.thegioihosting.io.vn/public_html'
# Previously observed regression ID; no visitor data or directory listing.
RUN = 'run04en41573588673'
CASE = 'en_services_listed-frontend'
LEVELS = (
    ('webroot', PREFIX),
    ('wp_content', PREFIX + '/wp-content'),
    ('logger_root', PREFIX + '/wp-content/esc-agent-debug'),
    ('regression', PREFIX + '/wp-content/esc-agent-debug/regression'),
    ('run', PREFIX + '/wp-content/esc-agent-debug/regression/' + RUN),
    ('case', PREFIX + '/wp-content/esc-agent-debug/regression/' + RUN + '/' + CASE),
)


def main():
    raw = os.environ.get('FTP_SERVER', '')
    u = urlsplit(raw if '://' in raw else 'ftp://' + raw)
    if u.scheme not in ('ftp', 'ftps') or not u.hostname or u.username or u.password \
            or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('Unexpected FTPS endpoint configuration')
    report = {'schema': 1, 'scope': 'ftps_cwd_only', 'run': RUN,
              'statuses': {}, 'note': '550 means missing or permission denied; no file contents read'}
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=20)
    try:
        ftp.connect(u.hostname, u.port or 21)
        ftp.auth()
        ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        ftp.prot_p()
        for label, directory in LEVELS:
            try:
                ftp.cwd(directory)
                report['statuses'][label] = 'accessible'
            except ftplib.error_perm:
                report['statuses'][label] = 'denied_or_missing'
            except ftplib.error_temp:
                report['statuses'][label] = 'temporary_failure'
            except (OSError, EOFError, ftplib.Error) as error:
                report['statuses'][label] = 'transport_' + type(error).__name__
                break
    finally:
        try:
            ftp.quit()
        except (OSError, EOFError, ftplib.Error):
            pass
    out = Path('audit/ptscps-agent-telemetry-access-summary.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print('PTSCPS_TELEMETRY_ACCESS=' + json.dumps(report['statuses'], sort_keys=True))


if __name__ == '__main__':
    main()
