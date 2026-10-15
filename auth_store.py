"""Local shared-workspace identities. Passwords and sessions never leave this service."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from http.cookies import SimpleCookie, CookieError
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DB = Path(os.environ.get('CANVAS_AUTH_DB', Path(__file__).parent / '.canvas-auth' / 'users.sqlite3'))
TTL = 12 * 3600
RATE_LOCK = threading.Lock()
ATTEMPTS = defaultdict(deque)
SCHEMA_LOCK = threading.Lock()
INITIALIZED = set()


@contextmanager
def database():
    DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        with SCHEMA_LOCK:
            if str(DB.resolve()) not in INITIALIZED:
                connection.executescript('''
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
              salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL, last_login REAL);
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS invites (
              token_hash TEXT PRIMARY KEY, created_by TEXT NOT NULL,
              expires REAL NOT NULL, used_by TEXT);
            INSERT OR IGNORE INTO settings VALUES ('registration','true');
            CREATE TABLE IF NOT EXISTS audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL,
              actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
                ''')
                INITIALIZED.add(str(DB.resolve()))
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def public(user):
    return {key: user[key] for key in ('id', 'username', 'name', 'role', 'active', 'created', 'last_login')}


def digest(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32).hex()


def password_input(value):
    if not isinstance(value, str) or not 10 <= len(value) <= 128:
        raise ValueError('密码需为 10–128 个字符')
    return value


def cookie_name(handler):
    return 'canvas_session_' + str(handler.server.server_port)


def token_hash(handler):
    try:
        cookie = SimpleCookie(handler.headers.get('Cookie', ''))
        token = cookie.get(cookie_name(handler))
        if token and re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token.value):
            return hashlib.sha256(token.value.encode()).hexdigest()
    except CookieError:
        pass
    return ''


def current_user(handler):
    token = token_hash(handler)
    if not token:
        return None
    with database() as db:
        row = db.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>? AND u.active=1', (token, time.time())).fetchone()
        return public(row) if row else None

def has_users():
    with database() as db:
        return db.execute('SELECT count(*) FROM users').fetchone()[0] > 0


def reply(handler, status, data, token=None, clear=False):
    payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(payload)))
    if token is not None or clear:
        secure='; Secure' if getattr(handler.server,'public_origin','') else ''
        handler.send_header('Set-Cookie', f'{cookie_name(handler)}={token or ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else TTL}{secure}')
    handler.end_headers()
    if handler.command != 'HEAD':
        try: handler.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError): pass


def session(db, uid):
    token = secrets.token_urlsafe(32)
    db.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
    db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), uid, time.time() + TTL))
    return token


def audit(db, actor, action, target):
    db.execute('INSERT INTO audit(at,actor,action,target) VALUES (?,?,?,?)', (time.time(), actor, action, target))
    db.execute('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 1000)')


def limited(handler, action):
    # Bound attempts before expensive password hashing; no passwords or names recorded.
    key = (handler.client_address[0], action)
    now = time.monotonic()
    with RATE_LOCK:
        for old_key in list(ATTEMPTS):
            if not ATTEMPTS[old_key] or now - ATTEMPTS[old_key][-1] >= 600:
                del ATTEMPTS[old_key]
        entries = ATTEMPTS[key]
        while entries and now - entries[0] >= 600: entries.popleft()
        if len(entries) >= (30 if action == 'login' else 10): return True
        entries.append(now)
    return False


def get(handler):
    route = urlparse(handler.path).path
    if route == '/api/auth/status':
        with database() as db:
            count = db.execute('SELECT count(*) FROM users').fetchone()[0]
            enabled = db.execute("SELECT value FROM settings WHERE key='registration'").fetchone()[0] == 'true'
        reply(handler, 200, {'user': current_user(handler), 'setupRequired': count == 0, 'registrationOpen': enabled,
                             'mode':'team' if getattr(handler.server,'public_origin','') else 'local'})
        return True
    if route == '/api/admin/users':
        if not require_admin(handler): return True
        args = parse_qs(urlparse(handler.path).query)
        try: page = max(1, min(100000, int(args.get('page', ['1'])[0])))
        except ValueError: page = 1
        query = args.get('q', [''])[0][:80]
        search = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        with database() as db:
            where = "WHERE username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'"
            count = db.execute('SELECT count(*) FROM users ' + where, (search, search)).fetchone()[0]
            page = min(page, max(1, (count + 19) // 20))
            users = db.execute('SELECT * FROM users ' + where + ' ORDER BY created LIMIT 20 OFFSET ?', (search, search, (page - 1) * 20)).fetchall()
            registration = db.execute("SELECT value FROM settings WHERE key='registration'").fetchone()[0] == 'true'
            events = [dict(row) for row in db.execute('SELECT at,actor,action,target FROM audit ORDER BY id DESC LIMIT 50')]
        reply(handler, 200, {'users': [public(row) for row in users], 'total': count, 'page': page, 'registrationOpen': registration, 'events': events})
        return True
    return False


def require_admin(handler):
    user = getattr(handler, 'user', None) or current_user(handler)
    if not user:
        reply(handler, 401, {'error': '请先登录'})
        return False
    if user['role'] != 'admin':
        reply(handler, 403, {'error': '此操作需要管理员权限'})
        return False
    handler.user = user
    return True


def post(handler):
    route = urlparse(handler.path).path
    allowed = {'/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/password', '/api/admin/users/update', '/api/admin/registration', '/api/admin/invites', '/api/admin/invites/revoke'}
    if route not in allowed: return False
    if route.startswith('/api/admin/') and not require_admin(handler): return True
    try:
        if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json': raise ValueError('请求需要 JSON 格式')
        size = int(handler.headers.get('Content-Length', '0'))
        if not 0 < size <= 8192: raise ValueError('请求大小无效')
        data = json.loads(handler.rfile.read(size))
        if not isinstance(data, dict): raise ValueError('请求格式无效')
        if route == '/api/auth/logout':
            with database() as db: db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(handler),))
            reply(handler, 200, {'ok': True}, clear=True)
            return True
        if route in ('/api/auth/register', '/api/auth/login'):
            if limited(handler, route.rsplit('/', 1)[1]):
                reply(handler, 429, {'error': '操作过于频繁，请十分钟后重试'})
                return True
            username = data.get('username', '')
            if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username): raise ValueError('用户名需为 3–40 位字母、数字、点、下划线或短横线')
            username = username.lower()
            password = password_input(data.get('password'))
            if route.endswith('/register'):
                name = data.get('name', '').strip() if isinstance(data.get('name'), str) else ''
                if not 1 <= len(name) <= 40: raise ValueError('显示名称需为 1–40 个字符')
                salt = secrets.token_hex(16)
                hashed = digest(password, salt)
                with database() as db:
                    db.execute('BEGIN IMMEDIATE')
                    first = db.execute('SELECT count(*) FROM users').fetchone()[0] == 0
                    enabled = db.execute("SELECT value FROM settings WHERE key='registration'").fetchone()[0] == 'true'
                    invite = data.get('invite', '')
                    if not isinstance(invite, str) or len(invite)>100: raise ValueError('邀请码格式无效')
                    invite_hash = hashlib.sha256(invite.encode()).hexdigest()
                    invitation = db.execute('SELECT * FROM invites WHERE token_hash=? AND used_by IS NULL AND expires>?', (invite_hash,time.time())).fetchone() if invite else None
                    if not first and invite and not invitation:
                        reply(handler, 403, {'error': '邀请码无效、已过期或已使用，请联系管理员'})
                        return True
                    if not first and not enabled and not invitation:
                        reply(handler, 403, {'error': '管理员已关闭注册，请联系管理员'})
                        return True
                    uid = secrets.token_hex(16)
                    db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,1,?,?)', (uid, username, name, salt, hashed, 'admin' if first else 'member', time.time(), time.time()))
                    if invitation: db.execute('UPDATE invites SET used_by=? WHERE token_hash=?', (uid,invite_hash))
                    token = session(db, uid)
                    audit(db, username, '初始化管理员' if first else '注册账号', username)
                    user = public(db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone())
                reply(handler, 201, {'user': user}, token=token)
            else:
                with database() as db:
                    user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                    salt = user['salt'] if user else '00' * 16
                    valid = hmac.compare_digest(digest(password, salt), user['password_hash'] if user else '00' * 32)
                    if not valid or not user or not user['active']:
                        reply(handler, 401, {'error': '用户名、密码错误或账号已停用'})
                        return True
                    db.execute('BEGIN IMMEDIATE')
                    user = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
                    if not user['active'] or not hmac.compare_digest(digest(password, user['salt']), user['password_hash']):
                        reply(handler, 401, {'error': '账号状态已变化，请重新登录'})
                        return True
                    db.execute('UPDATE users SET last_login=? WHERE id=?', (time.time(), user['id']))
                    token = session(db, user['id'])
                    audit(db, username, '登录', username)
                    user = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
                reply(handler, 200, {'user': public(user)}, token=token)
            return True
        user = current_user(handler)
        if not user:
            reply(handler, 401, {'error': '登录已失效，请重新登录'})
            return True
        if route == '/api/auth/password':
            if limited(handler, 'password'):
                reply(handler, 429, {'error': '操作过于频繁，请十分钟后重试'})
                return True
            old = password_input(data.get('oldPassword'))
            new = password_input(data.get('newPassword'))
            if old == new: raise ValueError('新密码不能与旧密码相同')
            with database() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
                if not row['active'] or not hmac.compare_digest(digest(old, row['salt']), row['password_hash']):
                    reply(handler, 400, {'error': '当前密码不正确或账号已停用'})
                    return True
                salt = secrets.token_hex(16)
                db.execute('UPDATE users SET salt=?,password_hash=? WHERE id=?', (salt, digest(new, salt), user['id']))
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
                token = session(db, user['id'])
                audit(db, user['username'], '修改密码并撤销其他会话', user['username'])
            reply(handler, 200, {'ok': True}, token=token)
            return True
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            actor = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
            if not actor['active'] or actor['role'] != 'admin':
                reply(handler, 403, {'error': '管理员权限已失效'})
                return True
            if route == '/api/admin/invites':
                # Single use invitation, and invitation mode closes open registration.
                invitation=secrets.token_urlsafe(32);expires=time.time()+72*3600
                db.execute('DELETE FROM invites WHERE expires<=? OR used_by IS NOT NULL', (time.time(),))
                if db.execute('SELECT count(*) FROM invites').fetchone()[0]>=100: raise ValueError('待使用邀请已达 100 个，请撤销旧邀请')
                db.execute('INSERT INTO invites VALUES (?,?,?,NULL)', (hashlib.sha256(invitation.encode()).hexdigest(),user['id'],expires))
                db.execute("UPDATE settings SET value='false' WHERE key='registration'")
                audit(db,user['username'],'创建单次邀请并关闭公开注册','工作区')
            elif route == '/api/admin/invites/revoke':
                db.execute('DELETE FROM invites WHERE used_by IS NULL')
                audit(db,user['username'],'撤销未使用邀请','工作区')
            elif route == '/api/admin/registration':
                if type(data.get('enabled')) is not bool: raise ValueError('注册开关无效')
                if data['enabled'] and getattr(handler.server,'public_origin',''): raise ValueError('受邀团队模式不允许开放公开注册，请使用单次邀请')
                db.execute("UPDATE settings SET value=? WHERE key='registration'", ('true' if data['enabled'] else 'false',))
                audit(db, user['username'], '开放注册' if data['enabled'] else '关闭注册', '工作区')
            else:
                if not isinstance(data.get('id'), str): raise ValueError('用户标识无效')
                target = db.execute('SELECT * FROM users WHERE id=?', (data['id'],)).fetchone()
                if not target: raise ValueError('用户不存在')
                role, active = data.get('role'), data.get('active')
                if role not in ('admin', 'member') or type(active) is not bool: raise ValueError('角色或状态无效')
                if target['id'] == user['id']: raise ValueError('不能在当前会话中修改自己的角色或启用状态')
                if target['role'] == 'admin' and target['active'] and (role != 'admin' or not active):
                    if db.execute("SELECT count(*) FROM users WHERE role='admin' AND active=1").fetchone()[0] <= 1: raise ValueError('至少保留一名启用的管理员')
                db.execute('UPDATE users SET role=?,active=? WHERE id=?', (role, int(active), target['id']))
                db.execute('DELETE FROM sessions WHERE user_id=?', (target['id'],))
                audit(db, user['username'], f"设置为{'管理员' if role == 'admin' else '成员'} / {'启用' if active else '停用'}", target['username'])
        reply(handler, 201 if route == '/api/admin/invites' else 200, {'invite': invitation, 'expires': expires} if route == '/api/admin/invites' else {'ok': True})
        return True
    except sqlite3.IntegrityError:
        reply(handler, 409, {'error': '用户名已被使用，请换一个'})
    except (ValueError, TypeError) as error:
        reply(handler, 400, {'error': str(error) if type(error) is ValueError else '请求格式无效'})
    except (sqlite3.Error, OSError):
        reply(handler, 503, {'error': '账号服务暂不可用，请检查磁盘或稍后重试'})
    return True
