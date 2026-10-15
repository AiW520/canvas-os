"""Isolated identities for regression suites; never touch real user accounts."""
import json
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import auth_store


class AuthFixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='canvas-test-auth-')
        self.original = auth_store.DB
        auth_store.DB = Path(self.temp.name) / 'users.sqlite3'
        auth_store.ATTEMPTS.clear()

    def admin_cookie(self, base):
        request = Request(base + '/api/auth/register', data=json.dumps({
            'username': 'regression_admin', 'name': '回归测试',
            'password': 'Isolated-regression-password!'}).encode(),
            headers={'Origin': base, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=5) as response:
            assert response.status == 201
            return response.headers['Set-Cookie'].split(';')[0]

    def close(self):
        auth_store.INITIALIZED.discard(str(auth_store.DB.resolve()))
        auth_store.DB = self.original
        auth_store.ATTEMPTS.clear()
        self.temp.cleanup()
