"""HTTP generation regressions with mocked provider; never call the paid API."""
import json
import subprocess
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import media_store
import image_generation as generation
import server
from tests.auth_support import AuthFixture


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.auth=AuthFixture();self.temp=tempfile.TemporaryDirectory();self.original=media_store.STORE
        media_store.STORE=Path(self.temp.name)/'assets'
        self.http=ThreadingHTTPServer(('127.0.0.1',0),partial(server.Handler,directory=str(server.ROOT)))
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.base=f'http://127.0.0.1:{self.http.server_port}';self.cookie=self.auth.admin_cookie(self.base)
        self.payload={'prompt':'中文健康背景，无文字','name':'测试图片','requestId':'a'*32}

    def tearDown(self):
        self.http.shutdown();self.http.server_close();media_store.STORE=self.original;self.temp.cleanup();self.auth.close()

    def request(self,payload=None,cookie=None):
        request=Request(self.base+'/api/assets/generate',data=json.dumps(self.payload if payload is None else payload).encode(),
                        headers={'Origin':self.base,'Cookie':self.cookie if cookie is None else cookie,'Content-Type':'application/json'})
        try:
            with urlopen(request,timeout=5) as r:return r.status,json.load(r)
        except HTTPError as e:return e.code,json.load(e)

    def provider(self,args,timeout):
        if args==['--status']:return SimpleNamespace(returncode=0,stdout='{}')
        output=Path(args[args.index('--output-dir')+1])/'result.png'
        output.write_bytes((server.ROOT/'qa/cinematic-cover.png').read_bytes())
        return SimpleNamespace(returncode=0,stdout=json.dumps({'code':0,'saved_files':[str(output)]}))

    @patch.object(generation,'script_path',return_value=Path(__file__))
    def test_success_replay_and_payload_binding(self,_):
        with patch.object(generation,'run',side_effect=self.provider) as provider:
            status,data=self.request();self.assertEqual(status,201,data)
            self.assertTrue((media_store.STORE/(data['id']+'.png')).is_file())
            self.assertEqual(self.request(),(201,data));self.assertEqual(provider.call_count,2)
            self.assertEqual(self.request({**self.payload,'prompt':'不同请求'})[0],409)
        self.assertEqual(generation.command('--status')[2:4],['--channel','coding'])

    @patch.object(generation,'script_path',return_value=Path(__file__))
    def test_timeout_never_resubmits_and_parallel_capacity(self,_):
        with patch.object(generation,'run',side_effect=[SimpleNamespace(returncode=0),subprocess.TimeoutExpired('provider',240)]) as provider:
            self.assertEqual(self.request()[0],502)
            self.assertEqual(self.request()[0],409);self.assertEqual(provider.call_count,2)
        generation.SLOT.acquire()
        try:self.assertEqual(self.request({**self.payload,'requestId':'b'*32})[0],429)
        finally:generation.SLOT.release()

    def test_validation_and_auth_before_provider(self):
        with patch.object(generation,'run') as provider:
            self.assertEqual(self.request(cookie='')[0],401)
            self.assertEqual(self.request([])[0],400)
            self.assertEqual(self.request({**self.payload,'requestId':'../x'})[0],400)
            provider.assert_not_called()

    @patch.object(generation,'script_path',return_value=Path(__file__))
    def test_untrusted_result_path_is_rejected(self,_):
        with patch.object(generation,'run',side_effect=[SimpleNamespace(returncode=0),SimpleNamespace(returncode=0,stdout=json.dumps({'code':0,'saved_files':[str(server.ROOT/'qa/cinematic-cover.png')]}))]):
            self.assertEqual(self.request()[0],502)
            self.assertEqual(list(media_store.STORE.glob('*.json')),[])
