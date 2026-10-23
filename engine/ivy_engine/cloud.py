"""강의실 사이트(클라우드)와 주고받기."""

import os
import time

import requests

from . import VERSION

PART = 8 * 1024 * 1024


class CloudError(Exception):
    def __init__(self, message, status=0, code=''):
        super().__init__(message)
        self.status = status
        self.code = code


class LectureGone(CloudError):
    """선생님이 강의를 지웠을 때."""


class Cloud:
    def __init__(self, origin, token):
        self.origin = origin.rstrip('/')
        self.s = requests.Session()
        self.s.headers.update({'Authorization': f'Bearer {token}', 'User-Agent': f'IvyEngine/{VERSION}'})
        self._last_progress = {}

    def _req(self, method, path, json=None, data=None, headers=None, timeout=60, params=None, tries=3):
        url = self.origin + path
        last = None
        for i in range(tries):
            try:
                r = self.s.request(method, url, json=json, data=data, headers=headers, timeout=timeout, params=params)
            except requests.RequestException as e:
                last = CloudError(f'강의실 사이트에 연결하지 못했어요. 인터넷을 확인해 주세요. ({e.__class__.__name__})')
                time.sleep(2 * (i + 1))
                continue
            if r.status_code >= 500:
                last = CloudError(f'강의실 사이트에서 문제가 생겼어요 ({r.status_code}).', r.status_code)
                time.sleep(2 * (i + 1))
                continue
            try:
                body = r.json()
            except ValueError:
                body = {}
            if not isinstance(body, dict):
                body = {'data': body}
            if r.status_code >= 400:
                msg = body.get('error') or f'요청이 거절됐어요 ({r.status_code}).'
                code = body.get('code', '')
                if code == 'gone':
                    raise LectureGone(msg, r.status_code, code)
                if r.status_code == 401:
                    raise CloudError('연결 코드가 맞지 않아요. 강의실 사이트에서 연결 코드를 다시 만들어 넣어 주세요.', 401, code)
                raise CloudError(msg, r.status_code, code)
            return body
        raise last

    # ------------------------------------------------------------ 상태
    def hello(self, status, voice='', host=''):
        return self._req('POST', '/api/engine/hello', json={'version': VERSION, 'status': status, 'voice': voice, 'host': host or os.environ.get('COMPUTERNAME', '')})

    def next_job(self):
        """(강의 작업, 자막·요약 작업) 중 하나를 받아요."""
        r = self._req('POST', '/api/engine/next', json={})
        return r.get('job'), r.get('task')

    def progress(self, lid, pct, msg, force=False):
        now = time.time()
        last = self._last_progress.get(lid, 0)
        if not force and now - last < 3:
            return
        self._last_progress[lid] = now
        try:
            self._req('POST', f'/api/engine/lectures/{lid}/progress', json={'progress': int(pct), 'msg': msg}, tries=1, timeout=20)
        except LectureGone:
            raise
        except CloudError:
            pass  # 진행 표시는 실패해도 계속해요

    def send_script(self, lid, script, title=''):
        return self._req('POST', f'/api/engine/lectures/{lid}/script', json={'script': script, 'title': title}, timeout=120)

    def done(self, lid, duration, voice=None, name_slots=None, chapters=None):
        body = {'duration': duration, 'voice': voice, 'name_slots': name_slots or []}
        if chapters:
            body['chapters'] = chapters
        return self._req('POST', f'/api/engine/lectures/{lid}/done', json=body)

    # ------------------------------------------------------------ 자막·요약 작업
    def task_progress(self, tid, pct, msg, force=False):
        key = f't{tid}'
        now = time.time()
        if not force and now - self._last_progress.get(key, 0) < 3:
            return
        self._last_progress[key] = now
        try:
            self._req('POST', f'/api/engine/tasks/{tid}/progress', json={'progress': int(pct), 'msg': msg}, tries=1, timeout=20)
        except LectureGone:
            raise
        except CloudError:
            pass

    def task_done(self, tid, **body):
        return self._req('POST', f'/api/engine/tasks/{tid}/done', json=body, timeout=120)

    def task_fail(self, tid, error):
        try:
            return self._req('POST', f'/api/engine/tasks/{tid}/fail', json={'error': str(error)[:900]})
        except CloudError:
            return None

    def download_video(self, lid, path, on_progress=None):
        """선생님이 올린 강의 영상을 받아요 (자막 만들기용)."""
        try:
            with self.s.get(f'{self.origin}/api/engine/lectures/{lid}/video', stream=True, timeout=(20, 300)) as r:
                if r.status_code == 404:
                    raise LectureGone('영상이 없어요.', 404, 'gone')
                if r.status_code >= 400:
                    raise CloudError(f'영상을 받지 못했어요 ({r.status_code}).', r.status_code)
                total = int(r.headers.get('Content-Length') or 0)
                got = 0
                with open(path, 'wb') as f:
                    for chunk in r.iter_content(1024 * 1024):
                        f.write(chunk)
                        got += len(chunk)
                        if on_progress and total:
                            on_progress(got / total)
        except requests.RequestException as e:
            raise CloudError(f'영상을 받는 중에 연결이 끊겼어요 ({e.__class__.__name__}).')
        return path

    # ------------------------------------------------------------ 학생 이름 목소리
    def names_missing(self):
        return self._req('GET', '/api/engine/names/missing', tries=1, timeout=30).get('names') or []

    def put_name(self, uid, k, text, data, ctype='audio/mp4'):
        return self._req('PUT', f'/api/engine/names/{uid}', params={'k': k, 'text': text}, data=data, headers={'Content-Type': ctype}, timeout=60)

    # ------------------------------------------------------------ 엔진 자동 업데이트
    def engine_manifest(self):
        return self._req('GET', '/_engine/manifest.json', tries=2, timeout=30)

    def engine_bundle(self):
        return self._req('GET', '/_engine/bundle.json', tries=2, timeout=180)

    def fail(self, lid, error):
        try:
            return self._req('POST', f'/api/engine/lectures/{lid}/fail', json={'error': str(error)[:900]})
        except CloudError:
            return None

    def logo_bytes(self):
        try:
            r = self.s.get(self.origin + '/api/engine/logo', timeout=30)
            return r.content if r.ok else None
        except requests.RequestException:
            return None

    # ------------------------------------------------------------ 파일 올리기 (나눠 올리기)
    def upload(self, lid, kind, path, duration=None, on_progress=None):
        size = os.path.getsize(path)
        st = self._req('POST', '/api/up/start', json={'lecture_id': lid, 'kind': kind})
        key, upload_id = st['key'], st['uploadId']
        parts = []
        n = max(1, -(-size // PART))
        try:
            with open(path, 'rb') as f:
                for i in range(n):
                    chunk = f.read(PART)
                    r = self._req('PUT', '/api/up/part', data=chunk, params={'key': key, 'uploadId': upload_id, 'n': i + 1},
                                  headers={'Content-Type': 'application/octet-stream'}, timeout=300)
                    parts.append({'partNumber': r['partNumber'], 'etag': r['etag']})
                    if on_progress:
                        on_progress((i + 1) / n)
        except Exception:
            try:
                self._req('POST', '/api/up/abort', json={'key': key, 'uploadId': upload_id}, tries=1)
            except CloudError:
                pass
            raise
        body = {'key': key, 'uploadId': upload_id, 'parts': parts, 'kind': kind}
        if duration:
            body['duration'] = duration
        return self._req('POST', '/api/up/complete', json=body, timeout=120)
