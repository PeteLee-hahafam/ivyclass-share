"""강의실 새 버전 받기. GitHub Actions 의 '강의실 업데이트'가 6시간마다 실행해요.

강의실을 만든 선생님의 공개 저장소에서 새 버전을 받아 이 저장소를 똑같이 맞춰요.
- 학원마다 다른 설정은 지켜요: wrangler.toml 의 사이트 이름, 데이터베이스와 영상 보관함의 이름과 ID
- .github 폴더(자동 업데이트 설정)는 건드리지 않아요
- 이 저장소에서 직접 고친 파일은 새 버전으로 덮어써져요. 직접 고쳐 쓰려면 Actions 에서 이 작업을 꺼 주세요.
- 학생 기록과 강의는 Cloudflare 데이터베이스에 있어서 이 작업과 상관없이 그대로예요.
"""
import os
import re
import subprocess
import sys

UPSTREAM = os.environ.get('IVY_UPSTREAM') or 'https://github.com/PeteLee-hahafam/ivyclass-share.git'
BRANCH = os.environ.get('IVY_UPSTREAM_BRANCH') or 'main'
LIST = '.share-files'  # 공개판에 들어 있는 파일 목록 (지울 파일을 고를 때 써요)
KEEP_KEYS = ('database_name', 'database_id', 'bucket_name')


def git(*args, binary=False):
    r = subprocess.run(['git', *args], capture_output=True)
    if r.returncode != 0:
        sys.exit(f'git {" ".join(args)} 실패: {r.stderr.decode("utf-8", "replace").strip()}')
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def kept(path, json_cfg):
    if path.startswith('.github/'):
        return True
    # 학원 설정 파일이 JSON 으로 바뀌어 있으면 설정 파일은 모두 그대로 둬요
    return json_cfg and path.startswith('wrangler.')


def merge_toml(mine, new):
    """새 버전 wrangler.toml 에 이 학원의 사이트 이름과 데이터베이스·보관함 정보를 다시 넣어요. 안전하지 않으면 None"""
    out = new
    m = re.search(r'(?m)^name\s*=\s*"([^"]*)"', mine)
    if m:
        name = m.group(1)
        out = re.sub(r'(?m)^name\s*=\s*"[^"]*"', lambda _: f'name = "{name}"', out, count=1)
    for key in KEEP_KEYS:
        m = re.search(rf'(?m)^\s*{key}\s*=\s*"([^"]*)"', mine)
        if not m:
            continue
        if not re.search(rf'(?m)^\s*{key}\s*=', out):
            return None
        val = m.group(1)
        out = re.sub(rf'(?m)^(\s*){key}\s*=\s*"[^"]*"', lambda mm, k=key, v=val: f'{mm.group(1)}{k} = "{v}"', out, count=1)
    return out


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def main():
    git('fetch', '--depth=1', UPSTREAM, BRANCH)
    new_rev = git('rev-parse', 'FETCH_HEAD').strip()
    new_files = [p for p in git('ls-tree', '-r', '--name-only', 'FETCH_HEAD').splitlines() if p]
    old_list = read(LIST).decode('utf-8').splitlines() if os.path.exists(LIST) else []
    json_cfg = os.path.exists('wrangler.json') or os.path.exists('wrangler.jsonc')
    for p in new_files:
        if kept(p, json_cfg):
            continue
        data = git('show', f'FETCH_HEAD:{p}', binary=True)
        if p == 'wrangler.toml' and os.path.exists(p):
            merged = merge_toml(read(p).decode('utf-8'), data.decode('utf-8'))
            if merged is None:
                print('wrangler.toml 모양이 새 버전과 달라서 이 학원 것을 그대로 둬요.')
                continue
            data = merged.encode('utf-8')
        if os.path.exists(p) and read(p) == data:
            continue
        os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
        with open(p, 'wb') as f:
            f.write(data)
    # 예전 공개판에는 있었는데 새 버전에서 빠진 파일만 지워요 (학원에서 따로 넣은 파일은 그대로)
    for p in sorted(set(old_list) - set(new_files)):
        if p and not kept(p, json_cfg) and p != 'wrangler.toml' and os.path.exists(p):
            git('rm', '-q', '--', p)
    git('add', '-A')
    if not git('status', '--porcelain').strip():
        print(f'이미 최신 버전이에요 ({new_rev[:7]}).')
        return
    git('-c', 'user.name=ivyclass-update', '-c', 'user.email=ivyclass-update@users.noreply.github.com',
        'commit', '-q', '-m', f'강의실 새 버전 받기 ({new_rev[:7]})')
    git('push', 'origin', 'HEAD')
    print(f'새 버전 {new_rev[:7]}을 받았어요. 1~2분 뒤 Cloudflare가 사이트를 새 버전으로 바꿔요.')


if __name__ == '__main__':
    main()
