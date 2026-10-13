#!/usr/bin/env python3
"""Loopback-only GitHub App manifest handoff. Credentials are created only by the user in GitHub."""
import html
import argparse
import json
import os
import re
import secrets
import time
import threading
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
LOCAL_ORIGIN = 'http://127.0.0.1:3000'
HOSTED_ORIGIN = 'https://merge.foo'
OWNER_ID = 279398
PERMISSIONS = {'pull_requests': 'read', 'checks': 'read', 'statuses': 'read', 'metadata': 'read'}


def exact_origin(value):
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        raise ValueError('Use a valid exact HTTPS or localhost origin.') from None
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or re.search(r'[\s%\\]', parsed.hostname) or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or (parsed.scheme != 'https' and parsed.hostname not in ('localhost', '127.0.0.1')):
        raise ValueError('Use a valid exact HTTPS or localhost origin.')
    return value.rstrip('/')


def manifest(port, local_origin=LOCAL_ORIGIN, hosted_origin=HOSTED_ORIGIN):
    local_origin, hosted_origin = exact_origin(local_origin), exact_origin(hosted_origin)
    return {'name': 'merge-foo-ehfeng-workspace', 'url': hosted_origin,
            'description': 'Read-only PR stack workspace. No GitHub writes.',
            'public': True, 'redirect_url': f'http://127.0.0.1:{port}/callback',
            'callback_urls': [local_origin + '/api/auth/callback', hosted_origin + '/api/auth/callback'],
            'hook_attributes': {'url': hosted_origin + '/api/github/webhook', 'active': False},
            'default_permissions': PERMISSIONS.copy(), 'default_events': [],
            'request_oauth_on_install': False, 'setup_on_update': False}


def exchange(code):
    request = urllib.request.Request('https://api.github.com/app-manifests/' + code + '/conversions',
                                     method='POST', data=b'', headers={
                                         'Accept': 'application/vnd.github+json',
                                         'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'merge.foo-setup'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def save_config(root, app, local_origin=LOCAL_ORIGIN):
    local_origin = exact_origin(local_origin)
    # GitHub may generate additional credentials; this read-only OAuth app does not retain PEM/webhook keys.
    if app.get('owner', {}).get('id') != OWNER_ID or app.get('permissions') != PERMISSIONS or app.get('events') != []:
        raise ValueError('Owner or read-only permissions did not match. No local credentials saved.')
    client_id, client_secret = app.get('client_id'), app.get('client_secret')
    if not all(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', value) for value in [client_id, client_secret]):
        raise ValueError('GitHub did not return valid client credentials.')
    slug = app.get('slug', '')
    if len(slug) > 100 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('GitHub did not return a valid App identifier.')
    values = {'APP_ORIGIN': local_origin, 'GITHUB_CLIENT_ID': client_id,
              'GITHUB_CLIENT_SECRET': client_secret, 'AUTH_SECRET': secrets.token_urlsafe(48),
              'GITHUB_APP_SLUG': slug}
    content = ''.join(f'{key}="{value}"\n' for key, value in values.items())
    created = []
    try:
        for name in ['.env.local', '.dev.vars']:
            path = root / name
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, 'w') as output:
                output.write(content)
    except Exception:
        for path in created:
            path.unlink()
        raise
    return 'https://github.com/apps/' + slug + '/installations/new'


class SetupServer(ThreadingHTTPServer):
    def __init__(self, address, root=ROOT, converter=exchange, local_origin=LOCAL_ORIGIN, hosted_origin=HOSTED_ORIGIN):
        self.local_origin, self.hosted_origin = exact_origin(local_origin), exact_origin(hosted_origin)
        super().__init__(address, Handler)
        self.root, self.converter = root, converter
        self.state, self.browser_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.started, self.used = time.monotonic(), False
        self.state_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log callback codes, cookies, credentials, or request queries.

    def page(self, title, body, status=200, cookie=False):
        self.send_response(status)
        for key, value in {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                           'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
                           'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'"}.items():
            self.send_header(key, value)
        if cookie:
            self.send_header('Set-Cookie', f'merge_setup={self.server.browser_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600')
        self.end_headers()
        document = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)} · merge.foo</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#faf9fd;color:#473952;font:15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.65}}main{{max-width:700px;margin:6vh auto;padding:38px;background:white;border:1px solid #e5dfed;border-radius:16px;box-shadow:0 12px 50px #4630520b}}.brand{{color:#7563d7;font-weight:700;letter-spacing:-.6px;font-size:24px}}h1{{font-size:29px;letter-spacing:-.7px;line-height:1.25;margin:25px 0 14px}}p{{color:#88758f}}ul{{padding:20px 20px 20px 38px;background:#f8f5fc;border-radius:9px}}.button,button{{background:#7563d7;color:white;padding:12px 20px;border-radius:7px;border:0;font:inherit;text-decoration:none;display:inline-block;cursor:pointer}}small{{display:block;color:#96869e;font-size:12px;margin-top:14px}}code{{background:#f5f1fa;padding:3px 5px}}a{{color:#7563d7}}@media(max-width:740px){{main{{margin:20px;padding:25px}}}}</style>
<main><div class="brand">merge.foo</div><h1>{html.escape(title)}</h1>{body}</main></html>'''
        self.wfile.write(document.encode())

    def do_GET(self):
        port = self.server.server_port
        if self.headers.get('Host') != f'127.0.0.1:{port}':
            return self.page('Local setup only', '<p>Open the loopback setup link directly on this Mac.</p>', 403)
        path = urlparse(self.path)
        if time.monotonic() - self.server.started > 3600:
            return self.page('Setup expired', '<p>Restart <code>pnpm setup:github</code> to prepare a new registration.</p>', 410)
        if path.path == '/':
            if self.server.used:
                return self.page('Registration already handled', '<p>Return to the completion page or consult docs/setup.md.</p>', 409)
            if any((self.server.root / name).exists() for name in ['.env.local', '.dev.vars']):
                return self.page('Configuration already exists', '<p>This helper never overwrites credentials. See docs/setup.md.</p>', 409)
            data = html.escape(json.dumps(manifest(port, self.server.local_origin, self.server.hosted_origin)), quote=True)
            action = 'https://github.com/settings/apps/new?state=' + self.server.state
            body = f'''<p>Your public GitHub App is ready to review. Other GitHub users and organizations can install it. The form fills in both callbacks and only these repository permissions:</p>
<ul><li>Pull requests: <strong>read</strong></li><li>Checks: <strong>read</strong></li><li>Commit statuses: <strong>read</strong></li><li>Metadata: <strong>read</strong> (required by GitHub)</li></ul>
<p>Webhooks are disabled. No account, contents, organization, email, or write permissions. Register this App while signed in as <strong>ehfeng</strong>.</p>
<p>merge.foo sign-in accepts any GitHub user. Repository access still requires personal authorization and App installation.</p>
<form method="post" action="{action}"><input type="hidden" name="manifest" value="{data}"><button type="submit">Review registration on GitHub →</button></form>
<small>This opens GitHub’s review page. Only your final “Create GitHub App” action creates credentials. They will be saved privately on this Mac. Installing on selected repositories and authorizing sign-in are separate choices. No Cloudflare secrets are uploaded.</small>'''
            return self.page('Connect GitHub, with access you choose.', body, cookie=True)
        if path.path != '/callback':
            return self.page('Page not found', '<p>Return to the setup link.</p>', 404)
        query = parse_qs(path.query)
        state, code = query.get('state', [''])[0], query.get('code', [''])[0]
        cookies = dict(part.strip().split('=', 1) for part in self.headers.get('Cookie', '').split(';') if '=' in part)
        if not secrets.compare_digest(state, self.server.state) or not secrets.compare_digest(cookies.get('merge_setup', ''), self.server.browser_token) or not re.fullmatch(r'[A-Za-z0-9_-]{10,200}', code):
            return self.page('Registration could not be verified', '<p>Start again from the local setup link. No credentials saved.</p>', 400)
        with self.server.state_lock:
            if self.server.used:
                return self.page('Registration already handled', '<p>Callback codes cannot be replayed.</p>', 409)
            self.server.used = True
        if any((self.server.root / name).exists() for name in ['.env.local', '.dev.vars']):
            return self.page('Configuration already exists', '<p>No existing credentials were overwritten. See docs/setup.md.</p>', 409)
        try:
            install_url = save_config(self.server.root, self.server.converter(code), self.server.local_origin)
        except Exception:
            # Never display upstream responses: they may contain generated secrets.
            return self.page('Local setup needs attention', '<p>No new local credentials were retained. Use the manual recovery in docs/setup.md. Your App may already exist in GitHub settings.</p>', 502)
        return self.page('Your App is registered. Choose its repositories.', f'''<p>Saved private configuration files on this Mac. No credentials are displayed or uploaded. Restart <code>pnpm dev</code> when you are ready.</p>
<p>On GitHub, choose <strong>Only select repositories</strong> and review the read permissions before installing.</p>
<a class="button" href="{install_url}">Choose repositories on GitHub →</a>
<p>Then open <a href="{html.escape(self.server.local_origin, quote=True)}">your local workspace</a> and choose Continue with GitHub. Hosted sign-in awaits the chosen provider's operator configuration in docs/setup.md.</p>''')


def main():
    parser = argparse.ArgumentParser(description='Operator-only first-time registration helper; does not overwrite credentials.')
    parser.add_argument('--local-origin', default=LOCAL_ORIGIN)
    parser.add_argument('--hosted-origin', default=HOSTED_ORIGIN)
    args = parser.parse_args()
    if any((ROOT / name).exists() for name in ['.env.local', '.dev.vars']):
        raise SystemExit('Configuration exists. The registration helper never overwrites credentials.')
    with SetupServer(('127.0.0.1', 3002), local_origin=args.local_origin, hosted_origin=args.hosted_origin) as server:
        print('GitHub registration review is ready at http://127.0.0.1:3002', flush=True)
        print('Only the user should click Create GitHub App and approve repository access. No secrets are printed.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Local setup stopped.")


if __name__ == '__main__':
    main()
