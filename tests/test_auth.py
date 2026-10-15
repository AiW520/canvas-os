"""Real HTTP auth regressions with isolated databases, no production credentials."""
import hashlib
import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth_store
import admin_console
import media_store
import server
from tests.auth_support import AuthFixture

PASSWORD = 'Isolated-account-password!'


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.auth = AuthFixture()
        self.temp = tempfile.TemporaryDirectory(prefix='canvas-auth-assets-')
        self.original_assets = media_store.STORE
        media_store.STORE = Path(self.temp.name)
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), partial(server.Handler, directory=str(server.ROOT)))
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown(); self.http.server_close()
        self.auth.close(); media_store.STORE = self.original_assets; self.temp.cleanup()

    def request(self, path, data=None, cookie='', method=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        options = {'Origin': self.base, 'Cookie': cookie}
        body = None
        if data is not None:
            body = json.dumps(data).encode(); options['Content-Type'] = 'application/json'
        options.update(headers or {})
        connection.request(method or ('POST' if data is not None else 'GET'), path, body=body, headers=options)
        response = connection.getresponse(); raw = response.read(); response_headers = dict(response.getheaders())
        try: result = json.loads(raw)
        except (ValueError, UnicodeError): result = raw
        connection.close()
        return response.status, result, response_headers

    def register(self, name, **extra):
        status, data, headers = self.request('/api/auth/register', {'username': name, 'name': '测试 '+name, 'password': PASSWORD, **extra})
        self.assertEqual(status, 201, data)
        return data['user'], headers['Set-Cookie'].split(';')[0]

    def login(self, name, password=PASSWORD):
        status, data, headers = self.request('/api/auth/login', {'username': name, 'password': password})
        self.assertEqual(status, 200, data)
        return headers['Set-Cookie'].split(';')[0]

    def test_bootstrap_requires_login_and_concurrent_first_admin(self):
        for path in ['/', '/?view=present', '/admin.html']:
            for method in ('GET', 'HEAD'):
                status, body, headers = self.request(path, method=method)
                self.assertEqual(status, 302); self.assertTrue(headers['Location'].startswith('/login.html?next='))
                if method == 'HEAD': self.assertEqual(body, b'')
        self.assertTrue(self.request('/api/auth/status')[1]['setupRequired'])
        self.assertEqual(self.request('/api/assets')[0], 401)
        self.assertEqual(self.request('/api/media/export', {'html':'x','assets':[]})[0], 401)
        with ThreadPoolExecutor(max_workers=3) as pool:
            users = list(pool.map(self.register, ['first_a', 'first_b', 'first_c']))
        self.assertEqual(sum(user['role'] == 'admin' for user, _ in users), 1)
        self.assertFalse(self.request('/api/auth/status')[1]['setupRequired'])

    def test_password_cookie_hashing_and_session_rotation(self):
        user, cookie = self.register('owner')
        second = self.login('owner')
        token = cookie.split('=', 1)[1]
        with auth_store.database() as db:
            row = db.execute('SELECT * FROM users').fetchone()
            self.assertNotEqual(row['password_hash'], PASSWORD)
            self.assertEqual(row['password_hash'], auth_store.digest(PASSWORD, row['salt']))
            stored = [row[0] for row in db.execute('SELECT token_hash FROM sessions')]
            self.assertNotIn(token, stored); self.assertIn(hashlib.sha256(token.encode()).hexdigest(), stored)
        result = self.request('/api/auth/status', cookie=cookie)[1]
        self.assertEqual(result['user']['id'], user['id'])
        self.assertNotIn('password_hash', result['user']); self.assertNotIn('salt', result['user'])
        self.assertEqual(self.request('/api/auth/password', {'oldPassword':'incorrect-password', 'newPassword':'New-password-123!'}, cookie)[0], 400)
        status, _, headers = self.request('/api/auth/password', {'oldPassword':PASSWORD, 'newPassword':'New-password-123!'}, cookie)
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie']); self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        new_cookie = headers['Set-Cookie'].split(';')[0]
        for old in (cookie, second): self.assertIsNone(self.request('/api/auth/status', cookie=old)[1]['user'])
        self.assertEqual(self.request('/api/auth/login', {'username':'owner', 'password':PASSWORD})[0], 401)
        self.assertIsNotNone(self.request('/api/auth/status', cookie=new_cookie)[1]['user'])
        self.assertEqual(self.request('/api/auth/logout', {}, new_cookie)[0], 200)
        self.assertIsNone(self.request('/api/auth/status', cookie=new_cookie)[1]['user'])

    def test_registration_search_pagination_and_validation(self):
        _, admin = self.register('admin')
        self.assertEqual(self.request('/api/auth/register', {'username':'ADMIN','name':'重复','password':PASSWORD})[0], 409)
        self.assertEqual(self.request('/api/admin/registration', {'enabled':False}, admin)[0], 200)
        self.assertEqual(self.request('/api/auth/register', {'username':'closed','name':'关闭','password':PASSWORD})[0], 403)
        self.assertFalse(self.request('/api/auth/status')[1]['registrationOpen'])
        self.assertEqual(self.request('/api/admin/registration', {'enabled':True}, admin)[0], 200)
        self.register('member', role='admin')
        with auth_store.database() as db:
            source = db.execute('SELECT salt,password_hash FROM users LIMIT 1').fetchone()
            for i in range(25):
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,1,?,NULL)', (f'id{i}',f'fixture_{i}','分页成员',*source,'member',time.time()))
        data = self.request('/api/admin/users?page=2', cookie=admin)[1]
        self.assertEqual(data['total'], 27); self.assertEqual(len(data['users']), 7)
        self.assertEqual(self.request('/api/admin/users?q=%25', cookie=admin)[1]['total'], 0)
        self.assertEqual(self.request('/api/admin/users?q=member', cookie=admin)[1]['users'][0]['role'], 'member')
        for data in ([], {'username':42}, {'username':'short','name':'x','password':'123'}, {'username':'bad name','name':'x','password':PASSWORD}):
            self.assertEqual(self.request('/api/auth/register', data)[0], 400)

    def test_invites_single_use_expiry_revoke_and_permission(self):
        _, admin = self.register('owner')
        _, member = self.register('existing')
        self.assertEqual(self.request('/api/admin/invites', {}, member)[0],403)
        status, invite, _ = self.request('/api/admin/invites', {}, admin)
        self.assertEqual(status,201)
        self.assertFalse(self.request('/api/auth/status')[1]['registrationOpen'])
        payload={'username':'guest','name':'受邀成员','password':PASSWORD,'invite':invite['invite']}
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda i:self.request('/api/auth/register',{**payload,'username':f'guest{i}'}),range(2)))
        self.assertEqual(sorted(r[0] for r in responses),[201,403])
        self.assertEqual(next(r[1]['user']['role'] for r in responses if r[0]==201),'member')
        invite=self.request('/api/admin/invites',{},admin)[1]['invite']
        with auth_store.database() as db:
            self.assertNotIn(invite,[r[0] for r in db.execute('SELECT token_hash FROM invites')])
            db.execute('UPDATE invites SET expires=0')
        self.assertEqual(self.request('/api/auth/register',{**payload,'invite':invite})[0],403)
        invite=self.request('/api/admin/invites',{},admin)[1]['invite']
        self.assertEqual(self.request('/api/admin/invites/revoke',{},admin)[0],200)
        self.assertEqual(self.request('/api/auth/register',{**payload,'invite':invite})[0],403)

    def test_team_proxy_origin_secure_cookie_and_closed_registration(self):
        _, admin = self.register('owner')
        self.http.public_origin='https://canvas.example.com'
        headers={'Host':'canvas.example.com','Origin':'https://canvas.example.com'}
        status, _, result_headers=self.request('/api/auth/login',{'username':'owner','password':PASSWORD},headers=headers)
        self.assertEqual(status,200)
        self.assertIn('; Secure',result_headers['Set-Cookie'])
        self.assertIn('Strict-Transport-Security',result_headers)
        self.assertEqual(self.request('/api/admin/registration',{'enabled':True},admin,headers=headers)[0],400)
        self.assertEqual(self.request('/api/auth/login',{'username':'owner','password':PASSWORD},headers={**headers,'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('/api/health')[0],403)
        self.assertEqual(self.request('/qa/player-latest.html',cookie=admin,headers=headers)[0],403)

    def test_disable_promote_demote_and_self_protection(self):
        owner, admin = self.register('owner')
        member, cookie = self.register('member')
        for route in ['/api/admin/users','/api/admin/status']:
            self.assertEqual(self.request(route,cookie=cookie)[0],403)
        self.assertEqual(self.request('/admin.html',cookie=cookie)[2]['Location'],'/?notice=admin-required')
        self.assertEqual(self.request('/api/admin/registration', {'enabled':False}, cookie)[0],403)
        for role, active in [('member',True),('admin',False),('admin',True)]:
            self.assertEqual(self.request('/api/admin/users/update', {'id':owner['id'],'role':role,'active':active}, admin)[0],400)
        def update(role, active):
            return self.request('/api/admin/users/update',{'id':member['id'],'role':role,'active':active},admin)[0]
        self.assertEqual(update('admin',True),200)
        self.assertIsNone(self.request('/api/auth/status',cookie=cookie)[1]['user'])
        elevated=self.login('member'); self.assertEqual(self.request('/api/admin/users',cookie=elevated)[0],200)
        self.assertEqual(update('member',False),200)
        self.assertIsNone(self.request('/api/auth/status',cookie=elevated)[1]['user'])
        self.assertEqual(self.request('/api/auth/login',{'username':'member','password':PASSWORD})[0],401)
        self.assertEqual(update('member',True),200)
        ordinary=self.login('member'); self.assertEqual(self.request('/api/admin/users',cookie=ordinary)[0],403)
        self.assertGreaterEqual(len(self.request('/api/admin/users',cookie=admin)[1]['events']),5)

    def test_backups_and_static_routes_cannot_bypass_auth(self):
        _, admin=self.register('owner'); _, member=self.register('member')
        status,data,_=self.request('/api/admin/backup',{'storage':{}},admin);self.assertEqual(status,201)
        for method in ('GET','HEAD'):
            self.assertEqual(self.request(data['download'],method=method)[0],401)
            self.assertEqual(self.request(data['download'],cookie=member,method=method)[0],403)
        self.assertEqual(self.request(data['download'],cookie=admin)[0],200)
        for path in ['/server.py','/tests/','/.canvas-auth/users.sqlite3','/%2ecanvas-auth/users.sqlite3','/./admin.html','/%61dmin.html','/qa/../admin.html','/qa/%2e%2e/admin.html','/qa/..%5cadmin.html']:
            self.assertEqual(self.request(path,cookie=member)[0],403,path)
        self.assertEqual(self.request('/api/auth/login',{'username':'owner','password':PASSWORD},headers={'Origin':'https://foreign.example'})[0],403)
        self.assertEqual(self.request('/api/auth/status',headers={'Host':'foreign.example'})[0],403)

    def test_expiration_invalid_cookie_and_attempt_limit(self):
        user,cookie=self.register('owner')
        with auth_store.database() as db: db.execute('UPDATE sessions SET expires=?',(time.time()-1,))
        self.assertIsNone(self.request('/api/auth/status',cookie=cookie)[1]['user'])
        self.assertIsNone(self.request('/api/auth/status',cookie='canvas_session_bad=malformed')[1]['user'])
        with auth_store.RATE_LOCK: auth_store.ATTEMPTS[('127.0.0.1','login')].extend([time.monotonic()]*30)
        self.assertEqual(self.request('/api/auth/login',{'username':'owner','password':PASSWORD})[0],429)


if __name__=='__main__': unittest.main()
