"""Bounded Tuzi coding adapter. A request ID is never billed twice by this host."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import uuid

import auth_store
import media_store

SLOT = threading.Lock()
UNCERTAIN = '生成结果未确认，可能已产生费用。请先检查素材库和服务商记录；本请求不会自动重试。'


def script_path():
    return Path(os.environ.get('CANVAS_IMAGE_SCRIPT', Path.home()/'.codex/skills/tuzi-image-generation/scripts/generate_image.py')).resolve()


def command(*args):
    return [sys.executable, str(script_path()), '--channel', 'coding', *args]


def run(args, timeout):
    return subprocess.run(command(*args), capture_output=True, text=True, encoding='utf-8', errors='replace',
                          timeout=timeout, check=False, env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)


def ensure_table(db):
    db.execute('''CREATE TABLE IF NOT EXISTS image_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      state TEXT NOT NULL, asset_id TEXT)''')


def capacity():
    media_store.STORE.mkdir(parents=True, exist_ok=True)
    if sum(p.stat().st_size for p in media_store.STORE.iterdir() if p.is_file()) + media_store.LIMIT > 2*1024**3:
        raise ValueError('素材库剩余空间不足，请先备份整理')


def post(handler):
    acquired=False;reserved=False;request_id=None
    try:
        if handler.headers.get('Content-Type','').split(';')[0]!='application/json':
            return handler.respond(415, {'error':'请求需要 JSON 格式'}) or True
        length=int(handler.headers.get('Content-Length','0'))
        if not 0<length<=20*1024: raise ValueError('生成请求过大')
        data=json.loads(handler.rfile.read(length))
        if not isinstance(data,dict): raise ValueError('请求格式无效')
        prompt=data.get('prompt');name=data.get('name','AI 生成图片');request_id=data.get('requestId')
        if not isinstance(prompt,str) or not 3<=len(prompt.strip())<=4000: raise ValueError('提示词需为 3 到 4000 个字符')
        if not isinstance(name,str) or not 1<=len(name.strip())<=180: raise ValueError('素材名称需为 1 到 180 个字符')
        if not isinstance(request_id,str) or not media_store.ID.fullmatch(request_id): raise ValueError('生成请求标识无效，请刷新页面')
        prompt=prompt.strip();name=name.strip()
        fingerprint=hashlib.sha256(json.dumps([prompt,name],ensure_ascii=False).encode()).hexdigest()
        with auth_store.database() as db:
            ensure_table(db)
            previous=db.execute('SELECT * FROM image_requests WHERE id=?',(request_id,)).fetchone()
        if previous:
            if previous['user_id']!=handler.user['id'] or previous['fingerprint']!=fingerprint:
                return handler.respond(409,{'error':'请求标识已使用，请新建生成请求'}) or True
            if previous['state']=='complete':
                return handler.respond(201,media_store.metadata(previous['asset_id'])) or True
            return handler.respond(409,{'error':UNCERTAIN,'uncertain':True}) or True
        acquired=SLOT.acquire(blocking=False)
        if not acquired: return handler.respond(429,{'error':'已有图片正在生成，请稍后再试'}) or True
        if not script_path().is_file(): return handler.respond(503,{'error':'图片生成组件未安装，请联系管理员配置'}) or True
        capacity()
        readiness=run(['--status'],15)
        if readiness.returncode!=0: return handler.respond(503,{'error':'图片生成服务未配置有效密钥，请联系管理员'}) or True
        # Durable reservation survives browser disconnects and process restarts.
        with auth_store.database() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM image_requests WHERE id=?',(request_id,)).fetchone():
                return handler.respond(409,{'error':UNCERTAIN,'uncertain':True}) or True
            db.execute('INSERT INTO image_requests VALUES (?,?,?,\'pending\',NULL)',(request_id,handler.user['id'],fingerprint))
        reserved=True
        with tempfile.TemporaryDirectory(prefix='canvas-generate-') as temporary:
            result=run(['--prompt',prompt,'--size','1536x1024','--quality','auto','--output-format','png',
                        '--output-dir',temporary,'--filename','canvas-generated'],240)
            if result.returncode!=0: raise RuntimeError(UNCERTAIN)
            output=json.loads(result.stdout)
            if not isinstance(output,dict) or output.get('code')!=0 or not isinstance(output.get('saved_files'),list) or len(output['saved_files'])!=1:
                raise RuntimeError(UNCERTAIN)
            source=Path(output['saved_files'][0]).resolve()
            if not source.is_relative_to(Path(temporary).resolve()) or not source.is_file() or not 0<source.stat().st_size<=media_store.LIMIT:
                raise RuntimeError(UNCERTAIN)
            raw=source.read_bytes()
            mime=next((m for m in ('image/png','image/jpeg','image/webp') if media_store.valid_signature(m,raw[:32])),None)
            if not mime: raise RuntimeError(UNCERTAIN)
            capacity()
            asset_id=uuid.uuid4().hex; filename=asset_id+'.'+media_store.TYPES[mime]
            record={'id':asset_id,'name':name,'mime':mime,'kind':'image','size':len(raw),
                    'src':'/assets/'+filename,'source':'tuzi','model':'gpt-image-2'}
            binary=media_store.STORE/filename;metadata=media_store.STORE/(asset_id+'.json');temp=metadata.with_suffix('.tmp')
            try:
                binary.write_bytes(raw);temp.write_text(json.dumps(record,ensure_ascii=False),encoding='utf-8');os.replace(temp,metadata)
                with auth_store.database() as db:
                    db.execute("UPDATE image_requests SET state='complete',asset_id=? WHERE id=?",(asset_id,request_id))
            except Exception:
                temp.unlink(missing_ok=True)
                # Keep completed files discoverable if the request journal fails.
                if not metadata.exists(): binary.unlink(missing_ok=True)
                raise
        handler.respond(201,record)
    except (ValueError,TypeError) as error:
        handler.respond(502 if reserved else 400,{'error':UNCERTAIN if reserved else '生成请求无效：'+str(error)[:160], 'uncertain':reserved})
    except Exception:
        handler.respond(502 if reserved else 503,{'error':UNCERTAIN if reserved else '图片服务暂不可用，请联系管理员检查配置', 'uncertain':reserved})
    finally:
        if acquired:SLOT.release()
    return True
