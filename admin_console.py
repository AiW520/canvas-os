"""Local management diagnostics and portable backups for Canvas OS."""
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import media_store
import auth_store

STARTED = time.monotonic()
EVENTS = deque(maxlen=100)
LOCK = threading.RLock()
BACKUPS = {}
BACKUP_LIMIT = 500 * 1024 * 1024
STORAGE_KEYS = {
    'canvas-board-v1', 'canvas-connections-v1', 'canvas-media-nodes-v1', 'canvas-os-project-v3',
    'canvas-os-deck-snapshots-v1', 'canvas-os-scenes-v2',
    'canvas-os-scenes-v1', 'canvas-os-objects-v1',
}
ASSET_FILE = re.compile(r'^[a-f0-9]{32}\.(?:json|png|jpg|webp|gif|mp4|webm)$')


def record(path, status):
    labels = {'/api/assets': '保存素材', '/api/assets/generate': '生成图片素材', '/api/media/export': '导出演示素材包',
              '/api/presentation/rewrite': 'AI 文本改写', '/api/admin/backup': '生成工作区备份'}
    if path not in labels:
        return
    with LOCK:
        EVENTS.appendleft({'time': datetime.now(timezone.utc).isoformat(),
                           'action': labels[path], 'status': status,
                           'ok': 200 <= status < 300})


def inventory():
    store = media_store.STORE
    store.mkdir(parents=True, exist_ok=True)
    files = [p for p in store.iterdir() if p.is_file() and not p.is_symlink()]
    assets, issues, accounted = [], [], set()
    used = sum(p.stat().st_size for p in files)
    for path in files:
        if path.suffix != '.json':
            continue
        try:
            data = media_store.metadata(path.stem)
            filename = data['id'] + '.' + media_store.TYPES[data['mime']]
            source = store / filename
            exists = source.is_file() and not source.is_symlink()
            size = source.stat().st_size if exists else 0
            issue = ''
            if not exists:
                issue = '原文件缺失'
            elif not isinstance(data.get('size'), int) or size != data['size']:
                issue = '文件大小与记录不一致'
            preview_id = data.get('previewId')
            preview = None
            if preview_id:
                try:
                    cover = media_store.metadata(preview_id)
                    cover_name = cover['id'] + '.' + media_store.TYPES[cover['mime']]
                    if cover['mime'].startswith('image/') and (store / cover_name).is_file() and not (store / cover_name).is_symlink():
                        preview = '/assets/' + cover_name
                    else:
                        issue = issue or '预览文件缺失'
                except (ValueError, TypeError, OSError, KeyError):
                    issue = issue or '预览记录缺失'
            asset = {'id': data['id'], 'name': str(data.get('name', '未命名素材'))[:180],
                     'mime': data['mime'], 'kind': data['mime'].split('/')[0], 'size': size,
                     'src': '/assets/' + filename, 'available': exists, 'issue': issue,
                     'updatedAt': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
            if preview:
                asset.update(preview=preview, previewId=preview_id)
            assets.append(asset)
            accounted.update((path.name, filename))
            if issue:
                issues.append({'file': filename, 'message': issue})
        except (ValueError, TypeError, OSError, KeyError):
            issues.append({'file': path.name, 'message': '素材记录损坏，无法读取'})
            accounted.add(path.name)
    preview_ids = {a['previewId'] for a in assets if a.get('previewId')}
    for asset in assets:
        asset['auxiliary'] = asset['id'] in preview_ids or asset['name'] == 'preview.jpg'
    for path in files:
        if path.name not in accounted:
            issues.append({'file': path.name, 'message': '未关联记录的文件，未自动删除'})
    assets.sort(key=lambda a: a['updatedAt'], reverse=True)
    return {'assets': assets, 'issues': issues, 'storage': {'used': used, 'limit': 2 * 1024**3,
            'freeDisk': shutil.disk_usage(store).free, 'uploadLimit': media_store.LIMIT,
            'backupLimit': BACKUP_LIMIT}}


def cleanup_backups():
    with LOCK:
        for token, item in list(BACKUPS.items()):
            if item['expires'] < time.monotonic() and not item['reading']:
                shutil.rmtree(item['directory'], ignore_errors=True)
                del BACKUPS[token]


def get(handler, head_only=False):
    route = urlparse(handler.path).path
    if route == '/api/admin/readiness':
        if not auth_store.require_admin(handler): return True
        import image_generation
        try:
            with auth_store.database() as db:
                registration=db.execute("SELECT value FROM settings WHERE key='registration'").fetchone()[0]=='true'
                admins=db.execute("SELECT count(*) FROM users WHERE role='admin' AND active=1").fetchone()[0]
            configured=False
            if image_generation.script_path().is_file():
                configured=image_generation.run(['--status'],15).returncode==0
            assets=inventory()
            checks=[
                {'title':'管理员账号','ok':admins>0,'detail':f'{admins} 名启用管理员'},
                {'title':'邀请注册','ok':not registration,'detail':'公开注册已关闭' if not registration else '请关闭公开注册，使用单次邀请'},
                {'title':'HTTPS 团队模式','ok':bool(getattr(handler.server,'public_origin','')),'detail':getattr(handler.server,'public_origin','') or '当前为本机预览，尚未配置 HTTPS 入口'},
                {'title':'图片生成配置','ok':configured,'detail':'coding / gpt-image-2 配置可读取；未发起付费生成验证' if configured else '生成组件或有效密钥尚未配置'},
                {'title':'素材完整性','ok':not assets['issues'],'detail':f"{len(assets['issues'])} 项素材异常"},
            ]
            handler.respond(200,{'checks':checks,'scope':'受邀团队 · 共享素材；草稿保存在各自浏览器',
                                 'note':'检查通过不代表已部署。首次发布前还需验证实际域名、备份恢复与服务商生成。'})
        except Exception:
            handler.respond(503,{'error':'就绪检查失败，请检查服务配置和磁盘状态'})
        return True
    if route == '/api/admin/status':
        if not auth_store.require_admin(handler): return True
        try:
            data = inventory()
            with LOCK:
                events = list(EVENTS)
            handler.respond(200, {**data, 'uptime': int(time.monotonic() - STARTED),
                'mode': 'team' if getattr(handler.server,'public_origin','') else 'local', 'events': events, 'checkedAt': datetime.now(timezone.utc).isoformat()})
        except OSError:
            handler.respond(503, {'error': '无法读取素材目录或磁盘状态，请检查本机权限与磁盘'})
        return True
    match = re.fullmatch(r'/api/admin/backups/([a-f0-9]{32})', route)
    if not match:
        return False
    if not auth_store.require_admin(handler): return True
    cleanup_backups()
    with LOCK:
        item = BACKUPS.get(match[1])
        if not item or item['reading']:
            handler.respond(404, {'error': '备份已下载或已过期，请重新生成'})
            return True
        if not head_only:
            item['reading'] = True
    try:
        file = Path(item['directory']) / 'workspace.zip'
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/zip')
        handler.send_header('Content-Disposition', 'attachment; filename="canvas-workspace-backup.zip"')
        handler.send_header('Content-Length', str(file.stat().st_size))
        handler.end_headers()
        if not head_only:
            with file.open('rb') as stream:
                shutil.copyfileobj(stream, handler.wfile, 1024 * 1024)
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        if not head_only:
            with LOCK:
                BACKUPS.pop(match[1], None)
            shutil.rmtree(item['directory'], ignore_errors=True)
    return True


def post(handler):
    if handler.path != '/api/admin/backup':
        return False
    if not auth_store.require_admin(handler): return True
    directory = None
    token = None
    try:
        if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError('备份请求需要 JSON 格式')
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= 8 * 1024 * 1024:
            raise ValueError('项目描述需小于 8 MB')
        data = json.loads(handler.rfile.read(length))
        storage = data.get('storage') if isinstance(data, dict) else None
        if not isinstance(storage, dict) or not set(storage).issubset(STORAGE_KEYS):
            raise ValueError('备份仅接受指定的项目与画布数据')
        for value in storage.values():
            if not isinstance(value, str) or not isinstance(json.loads(value), (dict, list)):
                raise ValueError('项目数据格式无效，请先修复草稿再备份')
        cleanup_backups()
        with LOCK:
            if len(BACKUPS) >= 2:
                raise ValueError('已有两个备份正在生成或等待下载，请先下载，或十分钟后重试')
            token = uuid.uuid4().hex
            directory = tempfile.mkdtemp(prefix='canvas-backup-')
            BACKUPS[token] = {'directory': directory, 'reading': True, 'expires': time.monotonic() + 600}
        store = media_store.STORE
        store.mkdir(parents=True, exist_ok=True)
        files = sorted(p for p in store.iterdir() if ASSET_FILE.fullmatch(p.name) and p.is_file() and not p.is_symlink())
        size = sum(p.stat().st_size for p in files)
        if size > BACKUP_LIMIT:
            raise ValueError('本次素材超过 500 MB，请从素材管理分别下载，并单独备份项目数据')
        if shutil.disk_usage(directory).free < size + length + 16 * 1024**2:
            raise ValueError('磁盘剩余空间不足，无法生成备份')
        snapshot = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'storage': storage}
        with zipfile.ZipFile(Path(directory) / 'workspace.zip', 'w', compression=zipfile.ZIP_STORED) as archive:
            archive.writestr('browser-data.json', json.dumps(snapshot, ensure_ascii=False))
            if 'canvas-os-project-v3' in storage:
                archive.writestr('presentation.json', storage['canvas-os-project-v3'])
            for path in files:
                archive.write(path, '.canvas-assets/' + path.name)
            archive.writestr('恢复说明.txt', '这是本机工作区备份，不是可直接播放的演示。\n'
                '请先保留现有工作区副本。关闭本机服务后，将备份中的 .canvas-assets 文件夹复制到 Canvas_OS 项目目录，重名文件请先核对。\n'
                '重新启动服务，在 PPT 编辑器使用“导入项目”导入 presentation.json。\n'
                'browser-data.json 额外保留画布坐标、媒体节点和冻结版本原始记录，供恢复排查；当前页面不支持一键恢复全部浏览器数据。\n'
                '当前浏览器尚未保存 PPT 时，不生成 presentation.json。\n'
                '备份不含 API 密钥、账号或其他浏览器存储。')
        with LOCK:
            BACKUPS[token]['reading'] = False
            BACKUPS[token]['expires'] = time.monotonic() + 600
        handler.respond(201, {'download': '/api/admin/backups/' + token, 'size': (Path(directory) / 'workspace.zip').stat().st_size})
        return True
    except (ValueError, TypeError, KeyError, OSError) as error:
        if token:
            with LOCK:
                BACKUPS.pop(token, None)
        if directory:
            shutil.rmtree(directory, ignore_errors=True)
        # Do not expose local paths or raw request data in error responses.
        message = str(error) if type(error) is ValueError else '备份生成失败，请检查项目格式、磁盘空间和素材文件'
        handler.respond(400, {'error': message})
        return True
