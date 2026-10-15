"""Disk assets and bounded ZIP delivery for the loopback editor."""
import json
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

STORE = Path(os.environ.get('CANVAS_ASSET_DIR', Path(__file__).resolve().parent / '.canvas-assets'))
LIMIT = 100 * 1024 * 1024
TYPES = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'}
ID = re.compile(r'^[a-f0-9]{32}$')

def metadata(asset_id):
    if not isinstance(asset_id,str) or not ID.fullmatch(asset_id): raise ValueError('无效素材 ID')
    data = json.loads((STORE / (asset_id+'.json')).read_text(encoding='utf-8'))
    if not isinstance(data,dict) or data.get('id')!=asset_id or data.get('mime') not in TYPES: raise ValueError('素材记录无效')
    return data

def valid_signature(mime, head):
    return {'image/png':head.startswith(b'\x89PNG\r\n\x1a\n'), 'image/jpeg':head.startswith(b'\xff\xd8\xff'),
            'image/gif':head.startswith((b'GIF87a',b'GIF89a')), 'image/webp':head[:4]==b'RIFF' and head[8:12]==b'WEBP',
            'video/mp4':head[4:8]==b'ftyp', 'video/webm':head.startswith(b'\x1aE\xdf\xa3')}.get(mime,False)

def get(handler, head_only=False):
    route=urlparse(handler.path).path
    if route=='/api/assets':
        STORE.mkdir(exist_ok=True)
        assets=[]
        for p in STORE.glob('*.json'):
            try: assets.append(metadata(p.stem))
            except (ValueError,OSError): pass
        return handler.respond(200, {'assets':assets}), True
    match=re.fullmatch(r'/assets/([a-f0-9]{32})(?:\.(png|jpg|webp|gif|mp4|webm)|/meta)',route)
    if not match:return None,False
    try:
        asset=metadata(match[1])
        if route.endswith('/meta'):return handler.respond(200,asset),True
        if match[2]!=TYPES[asset['mime']]:raise ValueError()
        file=STORE/(asset['id']+'.'+match[2]);size=file.stat().st_size
        start,end=0,size-1;status=200
        range_header=handler.headers.get('Range')
        if range_header:
            m=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
            if not m or not any(m.groups()):raise ValueError()
            if m[1]:start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
            else:start=max(0,size-int(m[2]))
            if start>end or start>=size:
                handler.send_response(416);handler.send_header('Content-Range',f'bytes */{size}');handler.end_headers();return None,True
            status=206
        handler.send_response(status);handler.send_header('Content-Type',asset['mime']);handler.send_header('Accept-Ranges','bytes')
        handler.send_header('Content-Length',str(end-start+1))
        if status==206:handler.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        handler.end_headers()
        if not head_only:
            with file.open('rb') as stream:
                stream.seek(start);remaining=end-start+1
                while remaining:
                    chunk=stream.read(min(1024*1024,remaining))
                    if not chunk:break
                    handler.wfile.write(chunk);remaining-=len(chunk)
        return None,True
    except (FileNotFoundError,ValueError,KeyError):return handler.respond(404,{'error':'素材文件不存在，请重新导入'}),True
    except (BrokenPipeError,ConnectionResetError):return None,True

def post(handler):
    if handler.path == '/api/assets/generate': return generate(handler)
    if handler.path not in ('/api/assets','/api/media/export'):return False
    try:
        length=int(handler.headers.get('Content-Length','0'))
        if handler.path=='/api/assets':
            mime=handler.headers.get('Content-Type','').split(';')[0]
            if mime not in TYPES:raise ValueError('支持 PNG、JPEG、WebP、GIF、MP4、WebM')
            if not 0<length<=LIMIT:raise ValueError('单个素材需小于 100 MB')
            STORE.mkdir(exist_ok=True)
            preview_id=handler.headers.get('X-Preview-Id','')
            preview=metadata(preview_id) if preview_id else None
            if preview and preview['kind']!='image':raise ValueError('封面必须是图片素材')
            if sum(p.stat().st_size for p in STORE.iterdir())+length>2*1024**3:raise ValueError('本机素材库达到 2 GB 上限，请先备份整理')
            asset_id=uuid.uuid4().hex;filename=asset_id+'.'+TYPES[mime];path=STORE/filename
            with tempfile.NamedTemporaryFile(dir=STORE,delete=False,suffix='.tmp') as stream:
                temp=Path(stream.name)
                try:
                    remaining=length;first=True
                    while remaining:
                        chunk=handler.rfile.read(min(1024*1024,remaining))
                        if not chunk:raise ValueError('上传中断')
                        if first and not valid_signature(mime,chunk):raise ValueError('文件内容与媒体类型不符')
                        first=False;stream.write(chunk);remaining-=len(chunk)
                except Exception:
                    stream.close();temp.unlink(missing_ok=True);raise
            os.replace(temp,path)
            name=unquote(handler.headers.get('X-File-Name','素材'))[:180]
            data={'id':asset_id,'name':name,'mime':mime,'kind':mime.split('/')[0],'size':length,'src':'/assets/'+filename}
            if preview:data.update(previewId=preview_id,preview=preview['src'])
            (STORE/(asset_id+'.json')).write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
            handler.respond(201,data);return True
        if not 0<length<=24*1024*1024:raise ValueError('导出描述超过大小限制')
        data=json.loads(handler.rfile.read(length))
        if not isinstance(data,dict):raise ValueError('导出参数无效')
        ids=data.get('assets');html=data.get('html')
        if not isinstance(ids,list) or len(ids)>200 or not isinstance(html,str):raise ValueError('导出参数无效')
        assets=[metadata(i) for i in set(ids)]
        if sum(a['size'] for a in assets)>500*1024*1024:raise ValueError('单次导出素材超过 500 MB，请拆分演示')
        with tempfile.TemporaryFile() as output:
            with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('index.html',html)
                archive.writestr('使用说明.txt','请先解压整个文件夹，再打开 index.html。分享或移动时保留 assets 文件夹。离线修改后下载的 HTML 也请放在本文件夹。')
                for asset in assets:
                    filename=asset['id']+'.'+TYPES[asset['mime']]
                    archive.write(STORE/filename,'assets/'+filename)
            size=output.tell();output.seek(0)
            handler.send_response(200);handler.send_header('Content-Type','application/zip');handler.send_header('Content-Disposition','attachment; filename="canvas-presentation.zip"');handler.send_header('Content-Length',str(size));handler.end_headers();shutil.copyfileobj(output,handler.wfile,1024*1024)
        return True
    except (ValueError,TypeError,KeyError,FileNotFoundError,OSError) as e:
        handler.respond(400,{'error':str(e) if isinstance(e,ValueError) else '素材保存或导出失败，请检查磁盘与素材文件'});return True

def generate(handler):
    import image_generation
    return image_generation.post(handler)
