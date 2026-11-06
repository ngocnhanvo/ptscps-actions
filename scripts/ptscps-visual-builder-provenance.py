#!/usr/bin/env python3
"""Read-only FTPS provenance: the deployment marker is outside the public client tree."""
import ftplib
import io
import json
import os
from pathlib import Path
import re
import ssl
import sys
from urllib.parse import urlsplit

def main():
    assert sys.argv[1:] in (['inspect'], ['verify'])
    mode = sys.argv[1]
    expected = os.environ['PTSCPS_ASTRO_SOURCE_SHA']
    assert re.fullmatch('[a-f0-9]{40}', expected)
    values = []
    for line in os.environ['ENV_FILE'].splitlines():
        match = re.fullmatch(r'\s*(?:export\s+)?WC_URL_CLIENT\s*=\s*(.*?)\s*', line)
        if match: values.append(match[1].strip().strip('\'"'))
    assert values == ['https://ptscps.thegioihosting.io.vn']
    host = urlsplit(values[0]).hostname
    root = '/domains/' + host + '/public_html'
    raw = os.environ['FTP_SERVER'].strip()
    server = urlsplit(raw if '://' in raw else 'ftp://' + raw)
    assert server.scheme in ('ftp', 'ftps') and server.hostname and server.port in (None, 21)
    assert not server.username and not server.password and not server.path.strip('/')
    assert not server.query and not server.fragment
    client = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=35)
    try:
        client.connect(server.hostname, server.port or 21)
        client.auth()
        client.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        client.prot_p()
        client.cwd(root)
        assert client.pwd().rstrip('/') == root
        out = io.BytesIO()
        client.retrbinary('RETR ptscps-staging-build.json', out.write)
        assert 0 < len(out.getvalue()) <= 10000
        marker = json.loads(out.getvalue())
        assert marker['target'] == host and marker['branch'] == 'master'
        assert re.fullmatch('[a-f0-9]{40}', marker['commit'])
        for required in ['server/entry.mjs', 'client/index.html']:
            client.voidcmd('TYPE I')
            assert client.size(required) > 0
        if mode == 'verify': assert marker['commit'] == expected, 'Deployed Astro source differs'
        output = Path('artifacts/visual-builder')
        output.mkdir(parents=True, exist_ok=True)
        (output / 'build.json').write_text(json.dumps({'source_verified': marker['commit'] == expected,
            'provenance': marker, 'transport': 'read-only verified FTPS'}, indent=2))
        print('PTSCPS_BUILDER_PROVENANCE=' + json.dumps({'mode': mode, 'commit': marker['commit'],
            'source_verified': marker['commit'] == expected, 'tls': 'PASS', 'no_write': True}))
    finally:
        try: client.quit()
        except Exception: client.close()

if __name__ == '__main__': main()
