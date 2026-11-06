from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


class TreeTests(unittest.TestCase):
    def test_full_zip_without_inventory_rejects_compiled_symlinks(self):
        script=ROOT/'scripts/ptscps-validate-deploy-tree.py'
        self.assertTrue(script.is_file(), 'Missing pre-ZIP symlink validation')
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/'deploy/client').mkdir(parents=True)
            (root/'outside').write_bytes(b'private-file')
            (root/'deploy/client/leak.txt').symlink_to(root/'outside')
            result=subprocess.run(['python3',str(script)],cwd=root,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('symlink',result.stderr)
            self.assertFalse((root/'upload/ptscps-astro.zip').exists())


if __name__=='__main__':
    unittest.main()
