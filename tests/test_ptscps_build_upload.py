"""Run the real transfer script against a controlled FTPS executable boundary."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TransferTests(unittest.TestCase):
    def invoke(self, status):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'payload.zip').write_bytes(b'compiled-astro-fixture')
            fake = root / 'lftp'
            fake.write_text('#!/bin/bash\ncat > "$TRANSFER_CAPTURE"\nexit "$TRANSFER_EXIT"\n')
            fake.chmod(0o755)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'],
                       ZIP_PATH=str(root/'payload.zip'), ASTRO_FTP_TARGET='/domains/site.example/public_html/',
                       PTSCPS_CLIENT_HOST='site.example', FTP_SERVER='ftp.example',
                       FTP_USERNAME='fixture-user', FTP_PASSWORD='fixture-password',
                       TRANSFER_CAPTURE=str(root/'capture'), TRANSFER_EXIT=str(status),
                       GITHUB_STEP_SUMMARY=str(root/'summary'))
            result = subprocess.run(['bash', str(ROOT/'scripts/ptscps-resumable-ftp.sh')],
                                    env=env, text=True, capture_output=True)
            return result, (root/'capture').read_text()

    def test_success_keeps_resumable_verified_tls_with_large_socket_buffer(self):
        result, commands = self.invoke(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        for command in ('set net:socket-buffer 4194304', 'set ftp:ssl-force yes',
                        'set ftp:ssl-protect-data yes', 'set ssl:verify-certificate yes',
                        'set net:max-retries 3', 'set net:timeout 25', 'put -c ', '.zip.uploading'):
            self.assertIn(command, commands)
        self.assertIn('Resumable FTP complete', result.stdout)

    def test_failure_preserves_original_exit_and_partial_upload(self):
        result, commands = self.invoke(7)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn('partial SHA-specific archive retained', result.stderr)
        self.assertNotIn('Resumable FTP complete', result.stdout)


if __name__ == '__main__':
    unittest.main()
