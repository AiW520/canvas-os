"""Tests the real local bridge against a temporary mock model, without credentials/network."""
import importlib.util
import json
import sys
import threading
import unittest
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('canvas_server',Path(__file__).resolve().parents[1]/'server.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from tests.auth_support import AuthFixture


class MockModel(BaseHTTPRequestHandler):
    received=[]
    def log_message(self,*args): pass
    def do_POST(self):
        type(self).received.append({'body':json.loads(self.rfile.read(int(self.headers['Content-Length']))),'authorization':self.headers.get('Authorization')})
        if self.path=='/redirect':
            self.send_response(307);self.send_header('Location','/capture');self.end_headers();return
        answer=json.dumps({'choices':[{'message':{'content':json.dumps({'patch':{'headline':'真实转发测试'}})}}]}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(answer)


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.auth=AuthFixture()
        cls.mock=ThreadingHTTPServer(('127.0.0.1',0),MockModel)
        cls.bridge=ThreadingHTTPServer(('127.0.0.1',0),partial(module.Handler,directory=str(module.ROOT)))
        for server in [cls.mock,cls.bridge]:threading.Thread(target=server.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.bridge.server_port}'
        cls.cookie=cls.auth.admin_cookie(cls.base)
    @classmethod
    def tearDownClass(cls):
        for server in [cls.mock,cls.bridge]:server.shutdown();server.server_close()
        cls.auth.close()
    def post(self,data,origin=None):
        req=Request(self.base+'/api/presentation/rewrite',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':origin or self.base,'Cookie':self.cookie})
        try:
            with urlopen(req,timeout=5) as response:return response.status,json.load(response)
        except HTTPError as e:return e.code,json.load(e)
    def request(self):
        return {'connection':{'endpoint':f'http://127.0.0.1:{self.mock.server_port}/chat/completions','model':'mock-model','key':'mock-secret'},'command':'写得更有冲击力','target':{'type':'headline'},'content':{'headline':'原始标题','notes':'MUST_NOT_SEND','copy':'UNSELECTED'}}
    def test_forwarding_and_context(self):
        status,result=self.post(self.request());self.assertEqual(status,200);self.assertEqual(result['patch']['headline'],'真实转发测试')
        last=MockModel.received[-1];self.assertEqual(last['authorization'],'Bearer mock-secret');self.assertEqual(last['body']['model'],'mock-model')
        messages=json.dumps(last['body']['messages']);self.assertNotIn('mock-secret',messages);self.assertNotIn('MUST_NOT_SEND',messages);self.assertNotIn('UNSELECTED',messages)
    def test_cross_origin_rejected(self):
        before=len(MockModel.received);self.assertEqual(self.post(self.request(),'https://untrusted.example')[0],403);self.assertEqual(before,len(MockModel.received))
    def test_invalid_types(self):
        self.assertEqual(self.post([])[0],400);data=self.request();data['connection']=[];self.assertEqual(self.post(data)[0],400)
    def test_redirect_never_forwards_credentials(self):
        data=self.request();data['connection']['endpoint']=f'http://127.0.0.1:{self.mock.server_port}/redirect'
        before=len(MockModel.received);self.assertEqual(self.post(data)[0],502);self.assertEqual(len(MockModel.received),before+1)


if __name__=='__main__':unittest.main()
