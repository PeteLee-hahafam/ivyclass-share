"""엔진 자동 업데이트: 강의실 사이트에 함께 올라간 새 엔진 파일로 스스로 바꿔요.

사이트가 GitHub에서 새 버전으로 바뀌면, 엔진은 쉬는 동안 바뀐 파일만 받아 바꾸고 다시 켜져요.
개발용 폴더(.git 이 있거나 NO_AUTO_UPDATE 파일이 있는 곳)에서는 바꾸지 않아요.
"""

import base64
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESTART_CODE = 3
SAFE_TOP = {'requirements.txt', 'icon.ico'}


class UpdateError(Exception):
    pass


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _safe(rel):
    if not isinstance(rel, str) or not rel or rel.startswith(('/', '\\')) or '..' in rel.replace('\\', '/').split('/') or ':' in rel:
        return False
    return rel.startswith('ivy_engine/') or rel in SAFE_TOP


def disabled():
    return (ROOT / '.git').exists() or (ROOT.parent / '.git').exists() or (ROOT / 'NO_AUTO_UPDATE').exists()


def local_hash(rel):
    p = ROOT / rel
    try:
        return _sha(p.read_bytes())
    except OSError:
        return None


def check(cloud):
    """(사이트에 있는 엔진 정보, 바꿔야 할 파일 목록)"""
    m = cloud.engine_manifest()
    files = [f for f in (m.get('files') or []) if _safe(f.get('p'))]
    changed = [f for f in files if local_hash(f['p']) != f.get('h')]
    return m, changed


def apply(cloud, manifest, changed, log=print):
    if not changed:
        return False
    bundle = cloud.engine_bundle()
    if bundle.get('build') != manifest.get('build'):
        raise UpdateError('사이트가 업데이트되는 중이에요. 조금 뒤에 다시 받을게요.')
    files = bundle.get('files') or {}
    stage = ROOT / '.update'
    staged = []
    for f in changed:
        b64 = files.get(f['p'])
        if b64 is None:
            raise UpdateError(f'{f["p"]} 파일이 묶음에 없어요.')
        data = base64.b64decode(b64)
        if _sha(data) != f['h']:
            raise UpdateError(f'{f["p"]} 파일이 받는 중에 망가졌어요.')
        dst = stage / f['p']
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        staged.append(f['p'])
    for rel in staged:
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(stage / rel, target)
    # 새 버전에 없는 옛 파이썬 파일은 지워요 (묶음이 온전할 때만)
    keep = {f['p'] for f in manifest.get('files') or []}
    whole = {'ivy_engine/__main__.py', 'ivy_engine/worker.py', 'ivy_engine/launcher.py'} <= keep
    for p in (ROOT / 'ivy_engine').rglob('*.py') if whole else []:
        rel = p.relative_to(ROOT).as_posix()
        if '__pycache__' not in rel and rel not in keep:
            try:
                p.unlink()
            except OSError:
                pass
    if 'requirements.txt' in staged:
        log('새로 필요한 프로그램을 설치하는 중이에요 (몇 분 걸릴 수 있어요).')
        flags = 0x08000000 if os.name == 'nt' else 0
        r = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt'), '--disable-pip-version-check', '-q'],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', creationflags=flags)
        if r.returncode != 0:
            log(f'프로그램 설치 중 문제가 있었어요: {(r.stderr or r.stdout)[-400:]}')
    return True
