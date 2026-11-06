import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
script = Path(os.environ.get('PTSCPS_REMOTE_SCRIPT', str(ROOT/'scripts/ptscps-remote-unzip.py')))
spec = importlib.util.spec_from_file_location('activate_remote', script)
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class ActivationTests(unittest.TestCase):
    def test_delta_capability_is_explicit_so_old_php_rejects_incomplete_zip(self):
        for delta in (False, True):
            with self.subTest(delta=delta), tempfile.TemporaryDirectory() as td:
                archive=Path(td)/'release.zip'
                with ZipFile(archive,'w') as z:
                    z.writestr('server/entry.mjs','new server')
                    z.writestr('client/index.html','new home')
                    z.writestr('ptscps-staging-build.json',json.dumps({
                        'commit':'a'*40,'branch':'master','target':'site.example'}))
                    if delta:
                        z.writestr('ptscps-image-delta.json','{"format":1,"files":{},"reuse":[]}')
                env={'ENV_FILE':'WC_URL=https://admin.example\nWC_URL_CLIENT=https://site.example',
                     'ASTRO_FTP_TARGET':'/domains/site.example/public_html/',
                     'SOURCE_REPO_PAT':'x'*30,'PTSCPS_PRODUCTION_SOURCE':'master',
                     'PTSCPS_DEPLOY_COMMIT':'a'*40,'ZIP_PATH':str(archive)}
                sent=[]
                def activate(endpoint, token, payload, timeout):
                    sent.append(payload)
                    return {'host':'site.example','target':'/domains/site.example/public_html/',
                            'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files_activated':3}
                with patch.dict(os.environ,env),patch('sys.argv',['remote','unpack']), \
                     patch.object(remote,'signed_post',side_effect=activate):
                    remote.main()
                self.assertEqual(sent[0]['action'],'unpack_delta' if delta else 'unpack')


if __name__=='__main__':
    unittest.main()
