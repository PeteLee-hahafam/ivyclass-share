"""작업 받아서 처리하기: 대본 만들기, 영상·PDF 만들기, 자막·요약 만들기, 학생 이름 목소리, 자동 업데이트."""

import shutil
import socket
import threading
import time
import traceback
from collections import deque
from datetime import datetime

from . import VERSION, config, media, scriptgen, stt, summarize, tts, updater
from .cloud import Cloud, CloudError, LectureGone


class Engine:
    def __init__(self):
        self.settings = config.load()
        self.status = '시작하는 중'
        self.connected = False
        self.job = None
        self.logs = deque(maxlen=400)
        self.academy = {}
        self.origin = ''
        self.last_hello = 0.0
        self.last_names = 0.0
        self.last_update_check = 0.0
        self.update_info = None
        self.done_count = 0
        self.exit_code = 0
        self.name_note = set()
        self.stop_ev = threading.Event()
        self.wake_ev = threading.Event()
        self.lock = threading.Lock()

    # ------------------------------------------------------------ 기록
    def log(self, msg, level='info'):
        line = f'[{datetime.now():%H:%M:%S}] {msg}'
        try:
            print(line, flush=True)
        except UnicodeEncodeError:
            print(line.encode('cp949', 'replace').decode('cp949'), flush=True)
        self.logs.append({'t': time.time(), 'level': level, 'msg': msg})

    def update_settings(self, patch):
        with self.lock:
            s = dict(self.settings)
            s.update({k: v for k, v in patch.items() if k in config.DEFAULTS})
            config.save(s)
            self.settings = s
            self.last_hello = 0
            self.last_names = 0
        self.wake_ev.set()

    def cloud(self):
        origin, token = config.parse_connection(self.settings.get('connection'))
        self.origin = origin
        return Cloud(origin, token)

    def hello(self, c, force=False):
        if force or time.time() - self.last_hello > 60:
            info = c.hello(self.status, tts.voice_label(self.settings), socket.gethostname())
            self.academy = info or {}
            self.last_hello = time.time()
            if not self.connected:
                self.log(f'강의실 사이트에 연결했어요: {self.academy.get("academy_name", "")} ({c.origin})')
            self.connected = True

    def _wait(self, secs):
        self.wake_ev.wait(secs)
        self.wake_ev.clear()

    # ------------------------------------------------------------ 반복
    def prune(self):
        """오래된 목소리 캐시(30일)와 남은 작업 폴더(2일)를 지워 디스크를 아껴요."""
        now = time.time()
        freed = 0
        try:
            for f in (config.cache_dir() / 'tts').glob('*'):
                if f.suffix in ('.wav', '.json') and now - f.stat().st_mtime > 30 * 86400:
                    freed += f.stat().st_size
                    f.unlink()
            for d in config.work_dir().iterdir():
                if now - d.stat().st_mtime > 2 * 86400:
                    if d.is_dir():
                        shutil.rmtree(d, ignore_errors=True)
                    else:
                        d.unlink()
        except OSError:
            pass
        if freed > 50 * 1024 * 1024:
            self.log(f'오래된 임시 파일 {freed // 1024 // 1024}MB를 정리했어요.')

    def run(self):
        self.log(f'강의 제작 엔진 {VERSION}을 시작했어요.')
        self.prune()
        while not self.stop_ev.is_set():
            s = self.settings
            if not s.get('connection'):
                self.status = '연결 코드를 넣어 주세요'
                self.connected = False
                self._wait(5)
                continue
            try:
                c = self.cloud()
            except ValueError as e:
                self.status = str(e)
                self.connected = False
                self._wait(10)
                continue
            try:
                self.status = '대기 중'
                self.hello(c)
                if self.maybe_update(c):
                    return
                job, task = c.next_job()
                if job:
                    self.handle(c, job)
                    continue
                if task:
                    self.handle_task(c, task)
                    continue
                self.idle_work(c)
            except CloudError as e:
                if self.connected or self.status != f'연결 문제: {e}':
                    self.log(f'강의실 사이트 연결 문제: {e}', 'error')
                self.connected = False
                self.status = f'연결 문제: {e}'
                self._wait(30)
                continue
            except Exception as e:
                self.log(f'알 수 없는 문제: {e}\n{traceback.format_exc()}', 'error')
                self._wait(30)
                continue
            self._wait(int(s.get('poll_seconds') or 10))

    # ------------------------------------------------------------ 자동 업데이트
    def maybe_update(self, c, force=False):
        if updater.disabled() or (not force and not self.settings.get('auto_update', True)):
            return False
        if not force and time.time() - self.last_update_check < 1800:
            return False
        self.last_update_check = time.time()
        try:
            m, changed = updater.check(c)
        except CloudError as e:
            if force:
                self.log(f'새 버전을 확인하지 못했어요: {e}', 'warn')
            return False
        self.update_info = {'version': m.get('version'), 'build': m.get('build'), 'pending': len(changed), 'checked': time.time()}
        if not changed:
            if force:
                self.log('지금이 최신 버전이에요.')
            return False
        self.status = f'새 버전 {m.get("version")}으로 바꾸는 중'
        self.log(f'새 버전 {m.get("version")}이 있어서 업데이트해요 (파일 {len(changed)}개).')
        try:
            updater.apply(c, m, changed, log=self.log)
        except (updater.UpdateError, CloudError, OSError) as e:
            self.log(f'업데이트하지 못했어요: {e}', 'error')
            return False
        self.log('업데이트를 마쳤어요. 엔진을 다시 켤게요.')
        self.exit_code = updater.RESTART_CODE
        self.stop_ev.set()
        return True

    # ------------------------------------------------------------ 쉬는 동안: 학생 이름 목소리
    def idle_work(self, c):
        if time.time() - self.last_names < 60:
            return
        self.last_names = time.time()
        try:
            self.make_names(c)
        except CloudError as e:
            self.log(f'학생 이름 목소리를 만들지 못했어요: {e}', 'warn')
        except Exception as e:
            self.log(f'학생 이름 목소리를 만들지 못했어요: {e}', 'warn')

    def make_names(self, c):
        items = c.names_missing()
        made = 0
        for it in items:
            spec = it.get('voice') or {}
            if not tts.can_speak(spec, self.settings):
                k = spec.get('k')
                if k not in self.name_note:
                    self.name_note.add(k)
                    self.log(f'  · "{spec.get("label")}" 목소리의 API 키가 없어서 학생 이름 목소리를 만들 수 없어요.', 'warn')
                continue
            s = tts.settings_for(spec, self.settings)
            base = config.work_dir() / f"name-{it['user_id']}-{spec['k']}"
            wav, m4a = base.with_suffix('.wav'), base.with_suffix('.m4a')
            try:
                raw = tts.synth(f"{it['text']},", s)
                if spec.get('provider') == 'test':
                    shutil.copy(raw, wav)
                else:
                    tts.trim_silence(raw, wav)
                    if tts.wav_seconds(wav) < 0.15:
                        shutil.copy(raw, wav)
                tts.to_m4a(wav, m4a)
                c.put_name(it['user_id'], spec['k'], it['text'], m4a.read_bytes())
                made += 1
            except LectureGone:
                continue
            finally:
                for f in (wav, m4a):
                    try:
                        f.unlink()
                    except OSError:
                        pass
            if self.stop_ev.is_set() or made >= 30:
                break
        if made:
            self.log(f'학생 이름 목소리 {made}개를 만들었어요.')

    # ------------------------------------------------------------ 강의 만들기
    def handle(self, c, job):
        lid = job['lecture_id']
        stage = job['stage']
        title = job.get('title') or ''
        kind = '대본' if stage == 'script' else '영상'
        self.job = {'id': lid, 'title': title, 'stage': stage, 'pct': 0, 'msg': '시작했어요', 'started': time.time()}
        self.status = f'{kind} 만드는 중: {title}'
        self.log(f'[{lid}번] {title} — {kind} 만들기를 시작해요.')
        try:
            self.hello(c, force=True)
        except CloudError:
            pass

        def prog(p, msg):
            self.job.update(pct=int(p), msg=msg)
            c.progress(lid, p, msg)

        started = time.time()
        try:
            if stage == 'script':
                self.make_script(c, job, prog)
            else:
                self.make_video(c, job, prog)
            self.done_count += 1
            self.log(f'[{lid}번] {kind} 완성 ({int(time.time() - started)}초 걸림)')
        except LectureGone:
            self.log(f'[{lid}번] 선생님이 강의를 지워서 작업을 멈췄어요.', 'warn')
        except (scriptgen.ScriptError, tts.TTSError, media.MediaError, CloudError) as e:
            self.log(f'[{lid}번] 실패: {e}', 'error')
            c.fail(lid, str(e))
        except Exception as e:
            self.log(f'[{lid}번] 실패: {e}\n{traceback.format_exc()}', 'error')
            c.fail(lid, f'제작 엔진에서 문제가 생겼어요: {e}')
        finally:
            self.job = None
            self.status = '대기 중'
            self.last_hello = 0

    def make_script(self, c, job, prog):
        prog(3, 'Claude가 지문을 분석하는 중')
        academy = self.academy.get('academy_name') or '우리 학원'
        style = self.academy.get('board_style') or {}
        script, warnings, usage = scriptgen.generate(job, self.settings, academy, on_progress=lambda p: prog(p, f'Claude가 대본을 쓰는 중 ({p}%)'), style=style, log=self.log)
        for w in warnings:
            self.log(f'  · {w}', 'warn')
        if usage is not None:
            think = getattr(getattr(usage, 'output_tokens_details', None), 'thinking_tokens', None)
            self.log(f'  · Claude 사용량: 입력 {getattr(usage, "input_tokens", "?")}, 출력 {getattr(usage, "output_tokens", "?")} 토큰' + (f' (생각하기 {think})' if think else ''))
        chars = sum(len(x['say']) for x in script['steps'])
        c.send_script(job['lecture_id'], script, script.get('title', ''))
        calls = sum(x['say'].count('{호명}') for x in script['steps'])
        self.log(f'  · 대본: "{script["title"]}" {len(script["steps"])}단계, {chars:,}자, 이름 부르기 {calls}번')

    def make_video(self, c, job, prog):
        from playwright.sync_api import sync_playwright

        lid = job['lecture_id']
        script = job.get('script')
        if not script or not script.get('steps'):
            raise media.MediaError('대본이 없어서 영상을 만들 수 없어요. 대본부터 다시 만들어 주세요.')
        s = dict(self.settings)
        options = job.get('options') or {}
        call = options.get('call_names', True) is not False
        work = config.work_dir() / f'{lid}-{int(time.time())}'
        work.mkdir(parents=True, exist_ok=True)
        opts = {
            'academy': self.academy.get('academy_name') or '',
            'header': self.academy.get('header_text') or job.get('source') or script.get('source') or '',
            'logo': f'{c.origin}/media/logo' if self.academy.get('has_logo') else None,
            'style': self.academy.get('board_style') or {},
        }
        try:
            prog(2, '목소리 만드는 중')
            audio, generic = media.build_audio(script, s, progress=lambda f: prog(2 + int(f * 33), f'목소리 만드는 중 ({int(f * 100)}%)'), call_names=call)
            secs = sum(u['dur'] for st in audio for u in st)
            self.log(f'  · 목소리 {sum(1 for st in audio for u in st if not u.get("slot"))}개 완성 ({media.unit_mode(s)} 단위), 말하는 시간 {int(secs // 60)}분 {int(secs % 60)}초')
            with sync_playwright() as pw:
                browser = media.launch_browser(pw, s)
                try:
                    ctx, page, info = media.open_board(browser, c.origin, script, opts)
                    for p in info.get('problems') or []:
                        self.log(f'  · {p.get("n")}번 문장 표시 "{p.get("text")}" — {p.get("why")}', 'warn')
                    tl = media.build_timeline(script, audio, info['cams'], info['order'], info.get('durs'), captions=options.get('captions', True) is not False, generic=generic)
                    media.write_audio(tl['segs'], work / 'audio.wav')
                    prog(36, '판서 장면 찍는 중')
                    frames, took = media.render_frames(page, tl, work / 'frames', progress=lambda f: prog(36 + int(f * 34), f'판서 장면 찍는 중 ({int(f * 100)}%)'))
                    self.log(f'  · 판서 장면 {len(frames)}장 ({int(took)}초)')
                    media.make_thumb(page, script, work / 'thumb.jpg')
                    ctx.close()
                    prog(71, '영상 합치는 중')
                    media.encode_video(frames, work / 'audio.wav', work / 'lecture.mp4', tl['total'], progress=lambda f: prog(71 + int(f * 17), f'영상 합치는 중 ({int(f * 100)}%)'))
                    prog(89, '판서노트·연습지 만드는 중')
                    media.make_note_pdf(browser, c.origin, script, opts, work / 'note.pdf')
                    if options.get('practice', True) is not False:
                        media.make_practice_pdf(browser, c.origin, script, opts, work / 'practice.pdf')
                finally:
                    browser.close()
            dur = round(tl['total'], 2)
            size = (work / 'lecture.mp4').stat().st_size
            self.log(f'  · 영상 {int(dur // 60)}분 {int(dur % 60)}초, {size / 1024 / 1024:.0f}MB, 이름 부르는 자리 {len(tl["slots"])}곳')
            prog(91, '영상 올리는 중')
            c.upload(lid, 'video', work / 'lecture.mp4', duration=dur, on_progress=lambda f: prog(91 + int(f * 6), f'영상 올리는 중 ({int(f * 100)}%)'))
            prog(97, '썸네일·PDF 올리는 중')
            c.upload(lid, 'thumb', work / 'thumb.jpg')
            c.upload(lid, 'note', work / 'note.pdf')
            if (work / 'practice.pdf').exists():
                c.upload(lid, 'practice', work / 'practice.pdf')
            c.done(lid, dur, voice=tts.voice_spec(s, options.get('tone')), name_slots=tl['slots'], chapters=media.chapters_of(script, tl.get('starts')))
            prog(100, '완성')
            self.last_names = 0  # 새 강의를 볼 학생들 이름 목소리를 바로 만들어요
        finally:
            if not s.get('keep_work'):
                shutil.rmtree(work, ignore_errors=True)

    # ------------------------------------------------------------ 자막·요약 작업
    def handle_task(self, c, task):
        tid, kind, lid = task['id'], task['kind'], task['lecture_id']
        title = task.get('title') or ''
        label = {'transcribe': '자막', 'summarize': 'AI 요약'}.get(kind, kind)
        self.job = {'id': lid, 'title': title, 'stage': kind, 'pct': 0, 'msg': '시작했어요', 'started': time.time()}
        self.status = f'{label} 만드는 중: {title}'
        self.log(f'[{lid}번] {title} — {label} 만들기를 시작해요.')

        def prog(p, msg):
            self.job.update(pct=int(p), msg=msg)
            c.task_progress(tid, p, msg)

        started = time.time()
        try:
            if kind == 'transcribe':
                self.make_subtitle(c, task, prog)
            elif kind == 'summarize':
                self.make_summary(c, task, prog)
            else:
                raise media.MediaError(f'모르는 작업이에요: {kind}')
            self.done_count += 1
            self.log(f'[{lid}번] {label} 완성 ({int(time.time() - started)}초 걸림)')
        except LectureGone:
            self.log(f'[{lid}번] 작업이 취소됐어요.', 'warn')
        except (stt.STTError, scriptgen.ScriptError, media.MediaError, tts.TTSError, CloudError) as e:
            self.log(f'[{lid}번] {label} 실패: {e}', 'error')
            c.task_fail(tid, str(e))
        except Exception as e:
            self.log(f'[{lid}번] {label} 실패: {e}\n{traceback.format_exc()}', 'error')
            c.task_fail(tid, f'제작 엔진에서 문제가 생겼어요: {e}')
        finally:
            self.job = None
            self.status = '대기 중'

    def make_subtitle(self, c, task, prog):
        lid = task['lecture_id']
        work = config.work_dir() / f'stt-{lid}-{int(time.time())}'
        work.mkdir(parents=True, exist_ok=True)
        try:
            prog(2, '영상 받는 중')
            video = c.download_video(lid, work / 'video.mp4', on_progress=lambda f: prog(2 + int(f * 12), f'영상 받는 중 ({int(f * 100)}%)'))
            prog(15, '말소리 꺼내는 중')
            tts.run_ffmpeg(['-i', str(video), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(work / 'audio.wav')])
            dur = tts.wav_seconds(work / 'audio.wav')
            segs = stt.transcribe(
                work / 'audio.wav',
                name=self.settings.get('whisper_model') or 'large-v3-turbo',
                progress=lambda f: prog(20 + int(f * 70), f'받아 적는 중 ({int(f * 100)}%)'),
                on_msg=lambda m: prog(18, m),
                duration=dur,
            )
            if not segs:
                raise stt.STTError('영상에서 말소리를 찾지 못했어요.')
            (work / 'sub.vtt').write_text(stt.to_vtt(segs), encoding='utf-8')
            prog(93, '자막 올리는 중')
            c.upload(lid, 'subtitle', work / 'sub.vtt')
            c.task_done(task['id'], transcript=[{'s': x['s'], 'e': x['e'], 'text': x['text']} for x in segs])
            self.log(f'  · 자막 {len(segs)}줄')
            prog(100, '완성')
        finally:
            if not self.settings.get('keep_work'):
                shutil.rmtree(work, ignore_errors=True)

    def make_summary(self, c, task, prog):
        from playwright.sync_api import sync_playwright

        lid = task['lecture_id']
        prog(5, 'Claude가 강의 내용을 읽는 중')
        raw = summarize.generate(task, self.settings, self.academy.get('academy_name') or '')
        prog(65, '요약 연습지 만드는 중')
        work = config.work_dir() / f'sum-{lid}-{int(time.time())}'
        work.mkdir(parents=True, exist_ok=True)
        try:
            if task.get('tool') == 'manual':
                opts = {'academy': self.academy.get('academy_name') or '', 'header': self.academy.get('header_text') or task.get('source') or '', 'style': self.academy.get('board_style') or {}}
                with sync_playwright() as pw:
                    browser = media.launch_browser(pw, self.settings)
                    try:
                        media.make_study_pdf(browser, c.origin, {'title': task.get('title'), 'source': task.get('source'), 'summary': raw}, opts, work / 'study.pdf')
                    finally:
                        browser.close()
                prog(90, '연습지 올리는 중')
                c.upload(lid, 'practice', work / 'study.pdf')
            c.task_done(task['id'], summary=raw)
            prog(100, '완성')
        finally:
            if not self.settings.get('keep_work'):
                shutil.rmtree(work, ignore_errors=True)
