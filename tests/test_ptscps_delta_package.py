"""Package acceptance fixtures, independent of the package implementation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def metadata(value):
    return {'size': len(value), 'sha256': hashlib.sha256(value).hexdigest()}


class PackageTests(unittest.TestCase):
    def test_omit_only_identical_images_and_public_static(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixtures = {'client/images/same.webp': b'image-one', 'client/images/changed.webp': b'image-new',
                        'client/_astro/app.js': b'same-js', 'client/about/index.html': b'same-about',
                        'client/data.json': b'new', 'client/index.html': b'new-home',
                        'server/entry.mjs': b'new-server', 'robots.txt': b'robots',
                        'client/sitemap.xml': b'sitemap'}
            for name, value in fixtures.items():
                path = root/'deploy'/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)
            (root/'.ptscps-remote-image-manifest.json').write_text(json.dumps({
                'images': {'same.webp': metadata(b'image-one'), 'changed.webp': metadata(b'image-old')},
                'static': {'_astro/app.js': metadata(b'same-js'), 'about/index.html': metadata(b'same-about'),
                           'data.json': metadata(b'old'), 'index.html': metadata(b'new-home')}}))
            for kind in ('image', 'static'):
                script = ROOT/'scripts'/('ptscps-'+kind+'-delta-package.py')
                self.assertTrue(script.is_file(), 'Missing '+kind+' delta packager')
                result = subprocess.run(['python3', str(script)], cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            for name in ('client/images/same.webp', 'client/_astro/app.js', 'client/about/index.html'):
                self.assertFalse((root/'deploy'/name).exists(), name)
            for name in ('client/images/changed.webp', 'client/data.json', 'client/index.html',
                         'server/entry.mjs', 'robots.txt', 'client/sitemap.xml'):
                self.assertEqual((root/'deploy'/name).read_bytes(), fixtures[name])
            self.assertEqual(json.loads((root/'deploy/ptscps-image-delta.json').read_text())['reuse'], ['same.webp'])
            self.assertEqual(json.loads((root/'deploy/ptscps-static-delta.json').read_text())['reuse'],
                             ['_astro/app.js', 'about/index.html'])

    def test_absent_inventory_keeps_full_zip(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            path = root/'deploy/client/images/same.webp'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'keep-image')
            for kind in ('image', 'static'):
                script = ROOT/'scripts'/('ptscps-'+kind+'-delta-package.py')
                self.assertTrue(script.is_file(), 'Missing '+kind+' delta packager')
                result = subprocess.run(['python3', str(script)], cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('FULL_ZIP', result.stdout)
            self.assertEqual(path.read_bytes(), b'keep-image')

    def test_oversize_marker_falls_back_before_deleting_any_file(self):
        for kind, prefix, suffix in [('image', 'images/', '.webp'), ('static', 'assets/', '.js')]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                files = {}
                for index in range(2500):
                    name = 'x'*190+str(index).zfill(4)+suffix
                    relative = name if kind == 'image' else prefix+name
                    files[relative] = metadata(b'x')
                    path = root/'deploy/client'/prefix/name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b'x')
                (root/'.ptscps-remote-image-manifest.json').write_text(json.dumps({
                    'images': files if kind == 'image' else {}, 'static': files if kind == 'static' else {}}))
                result = subprocess.run(['python3', str(ROOT/'scripts'/('ptscps-'+kind+'-delta-package.py'))],
                                        cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('FULL_ZIP', result.stdout)
                self.assertEqual(len(list((root/'deploy/client'/prefix).glob('*'))), 2500)
                self.assertFalse((root/'deploy'/('ptscps-'+kind+'-delta.json')).exists())

    def test_static_packager_leaves_image_subtree_to_image_packager(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name, value in [('images/data.json', b'image-json'), ('_astro/keep.js', b'keep-js')]:
                path=root/'deploy/client'/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)
            (root/'.ptscps-remote-image-manifest.json').write_text(json.dumps({
                'images': {}, 'static': {'images/data.json': metadata(b'image-json'), '_astro/keep.js': metadata(b'keep-js')}}))
            result=subprocess.run(['python3',str(ROOT/'scripts/ptscps-static-delta-package.py')],
                                  cwd=root,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual((root/'deploy/client/images/data.json').read_bytes(),b'image-json')
            self.assertEqual(list(json.loads((root/'deploy/ptscps-static-delta.json').read_text())['files']), ['_astro/keep.js'])


if __name__ == '__main__':
    unittest.main()
