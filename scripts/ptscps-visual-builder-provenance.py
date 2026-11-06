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
    assert sys.argv[1:] in (['inspect'], ['verify'], ['diagnose'])
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
        if mode == 'diagnose':
            # Only read known runtime log folders; never retrieve .env/config credentials.
            candidates = []
            for folder in [root, root+'/logs', '/domains/'+host+'/logs', '/.pm2/logs']:
                try:
                    client.cwd(folder)
                    names=client.nlst()
                    names=[name.rsplit('/',1)[-1] for name in names]
                    selected=[name for name in names if re.search(r'(?:err|runtime|node|astro).*\.log$|^error_log$',name,re.I)]
                    if folder == '/.pm2/logs': selected=[name for name in selected if re.search('ptscps|astro-app',name,re.I)]
                    print('PTSCPS_BUILDER_LOG_INVENTORY='+json.dumps({'folder':folder.replace(root,'FRONTEND'), 'logs':selected}))
                    for name in selected[:12]: candidates.append((folder,name))
                except ftplib.error_perm: pass
            for folder,name in candidates:
                try:
                    client.cwd(folder);client.voidcmd('TYPE I');size=client.size(name)
                    content=io.BytesIO()
                    client.retrbinary('RETR '+name,content.write,rest=max(0,size-24000))
                    lines=content.getvalue().decode('utf8','replace').splitlines()
                    relevant=[]
                    for line in lines:
                        if not re.search(r'(?:TypeError|ReferenceError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function|SyntaxError|/ptscps[^ /]*/public_html/server/)',line): continue
                        line=re.sub(r'https?://[^\s]+','[URL]',line)
                        line=re.sub(r'(?i)(ticket|nonce|token|password)[=: ]+[\w-]+',r'\1=[REDACTED]',line)
                        line=re.sub(r'/home/[^/]+/','/home/[USER]/',line)
                        relevant.append(line[:500])
                    print('PTSCPS_BUILDER_RUNTIME_ERRORS='+json.dumps({'log':name,'errors':relevant[-30:]}))
                except ftplib.all_errors: pass
    finally:
        try: client.quit()
        except Exception: client.close()

if __name__ == '__main__': main()
