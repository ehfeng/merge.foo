"""Exercise the operator helper in isolated temporary directories with fake inputs."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class AuthSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(Path(__file__).with_name('setup_auth.py'), self.root / 'scripts/setup_auth.py')

    def tearDown(self):
        self.temp.cleanup()

    def run_helper(self, slug='merge-foo-fixture', origin=''):
        return subprocess.run([sys.executable, str(self.root / 'scripts/setup_auth.py')],
                              input=f'{origin}\nIv1.fixture\nfixture-secret\n{slug}\n', text=True, capture_output=True)

    def test_public_configuration_and_installation_guidance(self):
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.root / '.env.local').read_text()
        self.assertNotIn('AUTH_ALLOWED_GITHUB_ID', content)
        self.assertIn('GITHUB_APP_SLUG="merge-foo-fixture"', content)
        self.assertEqual(content, (self.root / '.dev.vars').read_text())
        self.assertEqual(os.stat(self.root / '.env.local').st_mode & 0o777, 0o600)
        self.assertNotIn('fixture-secret', result.stdout + result.stderr)

    def test_existing_configuration_is_preserved(self):
        (self.root / '.dev.vars').write_text('existing\n')
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('never overwrites', result.stderr)
        self.assertEqual((self.root / '.dev.vars').read_text(), 'existing\n')
        self.assertFalse((self.root / '.env.local').exists())

    def test_invalid_app_slug_never_saves_files(self):
        result = self.run_helper('../redirect')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / '.env.local').exists())

    def test_invalid_origins_do_not_create_unusable_configuration(self):
        for origin in ['https://example.com/path', 'https://name:password@example.com',
                       'https://example.com?redirect=evil', 'https://example.com/#fragment',
                       'ftp://localhost', 'https://example.com:abc', 'https://:443',
                       'https://example.com:99999', 'https://exa mple.com']:
            with self.subTest(origin=origin):
                result = self.run_helper(origin=origin)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / '.env.local').exists())


if __name__ == '__main__':
    unittest.main()
