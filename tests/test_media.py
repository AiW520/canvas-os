"""Exercise local asset boundaries with an isolated on-disk store."""
import io
import json
import sys
import tempfile
import threading
import unittest
import zipfile
from functools import partial
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import media_store
from tests.auth_support import AuthFixture

class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.auth=AuthFixture()
        cls.temp=tempfile.TemporaryDirectory()
        cls.original=media_store.STORE
        media_store.STORE=Path(cls.temp.name)
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),partial(server.Handler,directory=str(server.ROOT)))
        threading.Thread(target=cls.http.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.http.server_port}'
        cls.cookie=cls.auth.admin_cookie(cls.base)
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close()
        media_store.STORE=cls.original;cls.temp.cleanup()
        cls.auth.close()
    def request(self,path,data=None,headers=None,method=None):
        req=Request(self.base+path,data=data,headers={'Origin':self.base,'Cookie':self.cookie,**(headers or {})},method=method)
        try:
            with urlopen(req,timeout=5) as r:return r.status,r.read(),r.headers
        except HTTPError as e:return e.code,e.read(),e.headers
    def upload(self,headers=None):
        status,body,_=self.request('/api/assets',b'\x89PNG\r\n\x1a\n'+bytes(range(32)),{'Content-Type':'image/png',**(headers or {})})
        self.assertEqual(status,201)
        return json.loads(body)
    def test_ranges_and_head(self):
        asset=self.upload()
        status,body,headers=self.request(asset['src'],headers={'Range':'bytes=4-11'})
        self.assertEqual((status,len(body)),(206,8));self.assertEqual(headers['Content-Range'],'bytes 4-11/40')
        self.assertEqual(len(self.request(asset['src'],headers={'Range':'bytes=-6'})[1]),6)
        self.assertEqual(self.request(asset['src'],headers={'Range':'bytes=90-'})[0],416)
        self.assertEqual(self.request(asset['src'],method='HEAD')[1],b'')
    def test_bad_upload_and_preview_leave_no_files(self):
        before=set(media_store.STORE.iterdir())
        self.assertEqual(self.request('/api/assets',b'bad',{'Content-Type':'image/png'})[0],400)
        self.assertEqual(self.request('/api/assets',b'\x89PNG\r\n\x1a\n',{'Content-Type':'image/png','X-Preview-Id':'0'*32})[0],400)
        self.assertEqual(set(media_store.STORE.iterdir()),before)
    def test_export_and_invalid_references(self):
        asset=self.upload()
        def export(data):return self.request('/api/media/export',json.dumps(data).encode(),{'Content-Type':'application/json'})
        status,body,_=export({'html':'<html lang="zh-CN"></html>','assets':[asset['id']]})
        self.assertEqual(status,200)
        with zipfile.ZipFile(io.BytesIO(body)) as z:self.assertIn(asset['src'][1:],z.namelist())
        for value in [[],{'html':'x','assets':['../server.py']},{'html':'x','assets':['0'*32]},{'html':'x','assets':[{}]}]:
            self.assertEqual(export(value)[0],400)
    def test_private_store_and_corrupt_record(self):
        self.assertEqual(self.request('/%2ecanvas-assets/anything.json')[0],403)
        corrupt=media_store.STORE/('f'*32+'.json');corrupt.write_text('bad')
        try:self.assertEqual(self.request('/api/assets')[0],200)
        finally:corrupt.unlink()

if __name__=='__main__':unittest.main()
