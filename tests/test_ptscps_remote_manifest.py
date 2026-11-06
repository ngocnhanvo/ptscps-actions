import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('remote', ROOT/'scripts/ptscps-remote-unzip.py')
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class ManifestTests(unittest.TestCase):
    def invoke(self, response):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root/'source').mkdir()
            # An old manifest must never survive a compatibility fallback.
            marker = root/'source/.ptscps-remote-image-manifest.json'
            marker.write_text('{"images":{"stale":{}}}')
            env = {'ENV_FILE': 'WC_URL=https://admin.example\nWC_URL_CLIENT=https://site.example',
                   'ASTRO_FTP_TARGET': '/domains/site.example/public_html/', 'SOURCE_REPO_PAT': 'x'*30}
            os.chdir(root)
            try:
                with patch.dict(os.environ, env), patch('sys.argv', ['remote', 'manifest']), \
                     patch.object(remote, 'signed_post', side_effect=response if isinstance(response, Exception) else None,
                                  return_value=response):
                    remote.main()
                return json.loads(marker.read_text()) if marker.exists() else None
            finally:
                os.chdir(previous)

    def test_inventory_saved_only_for_expected_target(self):
        self.assertEqual(self.invoke({'ok': True, 'protocol': 2, 'host': 'site.example',
                                     'target': '/domains/site.example/public_html/', 'images': {}, 'static': {}}),
                         {'images': {}, 'static': {}})

    def test_old_php_fallback_removes_stale_inventory(self):
        self.assertIsNone(self.invoke(remote.DeployHTTPError(400, '{"error":"Invalid archive checksum"}')))

    def test_auth_failure_does_not_fallback(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
            self.invoke(RuntimeError('Unpack server returned HTTP 403: Invalid signed request'))

    def test_misleading_forbidden_body_cannot_enable_full_zip_fallback(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
            self.invoke(remote.DeployHTTPError(403, '{"error":"HTTP 400 Invalid archive checksum"}'))

    def test_wrong_target_does_not_publish_inventory(self):
        with self.assertRaisesRegex(RuntimeError, 'unexpected frontend'):
            self.invoke({'ok': True, 'protocol': 2, 'host': 'other.example',
                         'target': '/domains/other.example/public_html/', 'images': {}})

    def test_reject_traversal_from_inventory(self):
        with self.assertRaisesRegex(RuntimeError, 'inventory item'):
            self.invoke({'ok': True, 'protocol': 2, 'host': 'site.example',
                         'target': '/domains/site.example/public_html/',
                         'images': {'../outside.webp': {'size': 4, 'sha256': 'a'*64}}})


if __name__ == '__main__':
    unittest.main()
