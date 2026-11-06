"""Exercise Python packaging followed by the real PHP staging restoration."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PHP_ROOT = Path(os.environ.get('PTSCPS_PHP_ROOT', str(ROOT.parent/'php'))).resolve()


@unittest.skipUnless(shutil.which('php'), 'PHP contract runs on GitHub Actions before any release')
class RoundtripTests(unittest.TestCase):
    def test_packaged_delta_restores_exact_new_build(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            files = {'client/images/same.webp': b'keep-image', 'client/images/config.json': b'keep-json', 'client/images/changed.webp': b'new-image',
                     'client/_astro/keep.js': b'keep-js', 'client/about/index.html': b'new-about',
                     'client/index.html': b'new-home', 'server/entry.mjs': b'new-ssr'}
            for name, value in files.items():
                for base in ('deploy', 'old'):
                    path = root/base/name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(value if base == 'deploy' or 'same.webp' in name or 'keep.js' in name or 'config.json' in name else b'old-bytes')
            meta = lambda data: {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            (root/'.ptscps-remote-image-manifest.json').write_text(json.dumps({
                'images': {'same.webp': meta(b'keep-image'), 'config.json': meta(b'keep-json')}, 'static': {'_astro/keep.js': meta(b'keep-js')}}))
            for kind in ('image', 'static'):
                result = subprocess.run(['python3', str(ROOT/'scripts'/('ptscps-'+kind+'-delta-package.py'))],
                                        cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            php = r'''define('ABSPATH', __DIR__); require $argv[1];
                $images=ptscps_delta_restore($argv[2],$argv[3]);
                $static=ptscps_static_restore($argv[2],$argv[3]);
                echo json_encode(array($images,$static));'''
            result = subprocess.run(['php', '-r', php, str(PHP_ROOT/'ptscps-image-delta.php'),
                                     str(root/'deploy'), str(root/'old')], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), [2, 1])
            for name, expected in files.items():
                self.assertEqual((root/'deploy'/name).read_bytes(), expected)
            self.assertFalse((root/'deploy/ptscps-image-delta.json').exists())
            self.assertFalse((root/'deploy/ptscps-static-delta.json').exists())


if __name__ == '__main__':
    unittest.main()
