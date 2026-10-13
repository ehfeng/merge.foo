#!/usr/bin/env python3
"""Prompt for application credentials locally. Never echo or log the client secret."""
import getpass
import os
import re
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

root = Path(__file__).resolve().parent.parent
targets = [root / '.env.local', root / '.dev.vars']
if any(path.exists() for path in targets):
    sys.exit('Configuration already exists. Update it locally; this helper never overwrites credentials.')
origin = input('Local app origin [http://127.0.0.1:3000]: ').strip() or 'http://127.0.0.1:3000'
try:
    url = urlparse(origin)
    port = url.port  # Reject invalid/non-numeric/out-of-range ports before saving files.
except ValueError:
    sys.exit('Use a valid exact HTTPS or localhost origin.')
if url.scheme not in ('http', 'https') or not url.hostname or re.search(r'[\s%\\]', url.hostname) or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment or (url.scheme != 'https' and url.hostname not in ('localhost', '127.0.0.1')):
    sys.exit('Use HTTPS or an explicit localhost origin.')
client_id = input('GitHub App client ID: ').strip()
client_secret = getpass.getpass('GitHub App client secret (hidden): ').strip()
slug = input('Existing GitHub App slug (from github.com/apps/<slug>, optional): ').strip()
if not client_id or not client_secret or len(slug) > 100 or (slug and not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug)):
    sys.exit('Client credentials and a valid optional App slug are required.')
values = {'APP_ORIGIN': origin.rstrip('/'), 'GITHUB_CLIENT_ID': client_id,
          'GITHUB_CLIENT_SECRET': client_secret, 'AUTH_SECRET': secrets.token_urlsafe(48),
          'GITHUB_APP_SLUG': slug}
if any('\n' in value or '\r' in value or '"' in value for value in values.values()):
    sys.exit('Configuration values contain unsupported characters.')
content = ''.join(f'{key}="{value}"\n' for key, value in values.items())
for path in targets:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(content)
print('Saved private, git-ignored local configuration. Restart the development server.')
print('Register /api/auth/callback on this origin in the GitHub App. Do not paste secrets into chat.')
