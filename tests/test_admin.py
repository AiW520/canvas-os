"""Local admin API tests; never use the user's asset directory."""
import io
import json
import sys
import tempfile
import threading
import unittest
import zipfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import media_store
import admin_console
from tests.auth_support import AuthFixture


class AdminTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.auth = AuthFixture()
        cls.directory = tempfile.TemporaryDirectory()
        cls.original = media_store.STORE
        media_store.STORE = Path(cls.directory.name)
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), partial(server.Handler, directory=str(server.ROOT)))
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.cookie = cls.auth.admin_cookie(cls.base)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close()
        media_store.STORE = cls.original
        cls.directory.cleanup()
        cls.auth.close()

    def request(self, path, data=None, headers=None, method=None):
        request = Request(self.base + path, data=data, headers={'Origin': self.base, 'Cookie': self.cookie, **(headers or {})}, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, response.read(), response.headers
        except HTTPError as error:
            return error.code, error.read(), error.headers

    def backup(self, data, headers=None):
        return self.request('/api/admin/backup', json.dumps(data).encode(), {'Content-Type': 'application/json', **(headers or {})})

    def test_inventory_missing_corrupt_and_orphan(self):
        aid = 'a' * 32
        store = media_store.STORE
        (store / (aid + '.json')).write_text(json.dumps({'id': aid, 'name': '<script>file</script>', 'mime': 'image/png', 'size': 30}))
        (store / ('b' * 32 + '.json')).write_text('{bad')
        (store / ('c' * 32 + '.webm')).write_bytes(b'orphan')
        try:
            status, body, _ = self.request('/api/admin/status')
            result = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(len(result['issues']), 3)
            self.assertFalse(result['assets'][0]['available'])
            self.assertEqual(result['assets'][0]['src'], '/assets/' + aid + '.png')
        finally:
            for path in store.iterdir(): path.unlink()

    def test_backup_assets_allowlist_head_and_consumption(self):
        status, body, _ = self.request('/api/assets', b'\x89PNG\r\n\x1a\nfixture', {'Content-Type': 'image/png', 'X-File-Name': 'fixture.png'})
        self.assertEqual(status, 201)
        asset = json.loads(body)
        storage = {'canvas-os-project-v3': json.dumps({'version': 3, 'scenes': [], 'objects': {}}), 'canvas-board-v1': '{}'}
        status, body, _ = self.backup({'storage': storage})
        self.assertEqual(status, 201)
        location = json.loads(body)['download']
        self.assertEqual(self.request(location, method='HEAD')[1], b'')
        status, body, _ = self.request(location)
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertEqual(json.loads(archive.read('browser-data.json'))['storage'], storage)
            self.assertIn('.canvas-assets/' + asset['id'] + '.png', archive.namelist())
            self.assertIn('presentation.json', archive.namelist())
            self.assertTrue(all(not name.startswith('/') and '..' not in name for name in archive.namelist()))
        self.assertEqual(self.request(location)[0], 404)
        self.assertEqual(self.backup({'storage': {'apiKey': 'SECRET'}})[0], 400)
        self.assertEqual(self.backup({'storage': {'canvas-board-v1': 'not json'}})[0], 400)
        self.assertEqual(self.backup({'storage': {}}, {'Origin': 'https://untrusted.example'})[0], 403)
        self.assertEqual(self.request('/api/admin/status', headers={'Host': 'untrusted.example'})[0], 403)
        events = json.loads(self.request('/api/admin/status')[1])['events']
        self.assertTrue(any(e['action'] == '生成工作区备份' and e['ok'] for e in events))
        self.assertNotIn('SECRET', json.dumps(events))
        for path in media_store.STORE.iterdir(): path.unlink()

    def test_backup_without_browser_draft(self):
        status, body, _ = self.backup({'storage': {}})
        self.assertEqual(status, 201)
        status, body, _ = self.request(json.loads(body)['download'])
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertNotIn('presentation.json', archive.namelist())


if __name__ == '__main__': unittest.main()
