import importlib.util
import json
import stat
import socket
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_github', Path(__file__).with_name('setup_github.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def app():
    return {'owner': {'id': 279398}, 'permissions': setup.PERMISSIONS.copy(), 'events': [],
            'client_id': 'Iv1.fixture', 'client_secret': 'fixture-secret', 'slug': 'merge-foo-fixture'}


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.calls = []
        self.responses = []
        def convert(code):
            self.calls.append(code)
            return app()
        self.server = setup.SetupServer(('127.0.0.1', 0), self.root, convert)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        for response in self.responses:
            response.close()
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.temp.cleanup()

    def get(self, path='/', headers=None):
        try:
            response = urllib.request.urlopen(urllib.request.Request(self.url + path, headers=headers or {}), timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        self.responses.append(response)
        return response

    def callback(self, **kwargs):
        path = '/callback?state=' + self.server.state + '&code=fixture-registration-code'
        return self.get(path, {'Cookie': 'merge_setup=' + self.server.browser_token, **kwargs})

    def test_manifest_has_only_read_permissions_and_separate_authorization(self):
        data = setup.manifest(3002)
        self.assertEqual(data['default_permissions'], setup.PERMISSIONS)
        self.assertTrue(data['public'])
        self.assertFalse(data['hook_attributes']['active'])
        self.assertFalse(data['request_oauth_on_install'])
        self.assertEqual(len(data['callback_urls']), 2)
        page = self.get()
        self.assertIn('form-action https://github.com', page.headers['Content-Security-Policy'])
        self.assertIn('HttpOnly; SameSite=Lax', page.headers['Set-Cookie'])
        self.assertEqual(page.headers['Cache-Control'], 'no-store')
        body = page.read()
        self.assertIn(b'Review registration on GitHub', body)
        self.assertIn(b'Your public GitHub App is ready to review.', body)
        self.assertIn(b'Other GitHub users and organizations can install it.', body)
        self.assertIn(b'merge.foo sign-in accepts any GitHub user.', body)
        self.assertIn(b'&quot;public&quot;: true', body)
        self.assertEqual(self.calls, [])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_hosting_origins_are_explicit_and_provider_independent(self):
        data = setup.manifest(3002, 'http://127.0.0.1:3007', 'https://merge-fixture.vercel.app')
        self.assertEqual(data['callback_urls'], ['http://127.0.0.1:3007/api/auth/callback', 'https://merge-fixture.vercel.app/api/auth/callback'])
        self.assertEqual(data['url'], 'https://merge-fixture.vercel.app')
        self.assertEqual(data['hook_attributes']['url'], 'https://merge-fixture.vercel.app/api/github/webhook')
        for origin in ['https://example.com/path', 'https://:443', 'https://example.com:bad', 'https://evil.example?next=other', 'ftp://localhost']:
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    setup.manifest(3002, hosted_origin=origin)

    def test_wrong_host_is_rejected_and_link_navigation_is_allowed(self):
        self.assertEqual(self.get(headers={'Host': 'attacker.example'}).status, 403)
        self.assertEqual(self.get(headers={'Sec-Fetch-Site': 'cross-site'}).status, 200)
        self.assertEqual(self.calls, [])

    def test_callback_requires_state_and_browser_cookie(self):
        self.assertEqual(self.get('/callback?state=wrong&code=fixture-registration-code').status, 400)
        self.assertEqual(self.get('/callback?state=' + self.server.state + '&code=fixture-registration-code').status, 400)
        self.assertEqual(self.calls, [])

    def test_user_callback_saves_private_files_once_without_displaying_secrets(self):
        response = self.callback(**{'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(response.status, 200)
        self.assertNotIn(b'fixture-secret', response.read())
        for name in ['.env.local', '.dev.vars']:
            path = self.root / name
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertIn('GITHUB_CLIENT_SECRET="fixture-secret"', path.read_text())
        self.assertEqual(self.callback().status, 409)
        self.assertEqual(len(self.calls), 1)

    def test_existing_configuration_is_not_overwritten(self):
        (self.root / '.dev.vars').write_text('existing')
        self.assertEqual(self.callback().status, 409)
        self.assertEqual((self.root / '.dev.vars').read_text(), 'existing')
        self.assertFalse((self.root / '.env.local').exists())
        self.assertEqual(self.calls, [])

    def test_wrong_owner_or_expanded_permissions_never_save(self):
        for data in [dict(app(), owner={'id': 1}), dict(app(), permissions={'contents': 'read'}), dict(app(), events=['push'])]:
            with self.assertRaises(ValueError):
                setup.save_config(self.root, data)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_browser_preconnection_does_not_block_registration_page(self):
        with socket.create_connection(('127.0.0.1', self.server.server_port)):
            self.assertEqual(self.get().status, 200)
        self.assertEqual(self.calls, [])

    def test_simultaneous_callbacks_exchange_only_once(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _: self.callback(), range(2)))
        self.assertEqual(sorted(response.status for response in responses), [200, 409])
        self.assertEqual(len(self.calls), 1)

    def test_partial_file_failure_rolls_back_and_expired_flow_stops(self):
        (self.root / '.dev.vars').write_text('existing')
        with self.assertRaises(FileExistsError):
            setup.save_config(self.root, app())
        self.assertFalse((self.root / '.env.local').exists())
        self.server.started -= 3601
        self.assertEqual(self.callback().status, 410)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
