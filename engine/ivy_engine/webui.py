"""제작 엔진 설정 화면 (이 PC에서만 열리는 작은 웹 화면, http://127.0.0.1:8765)."""

import json
import os
import re
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import VERSION, config, stt, tts, updater
from .cloud import Cloud, CloudError

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SECRET_FIELDS = ('connection', 'claude_key', 'google_key', 'gemini_key', 'eleven_key', 'typecast_key')
CLAUDE_MODELS = [
    ('claude-sonnet-5-5', 'Claude Sonnet 5.5 (강의 1개 약 200원, 추천)'),
    ('claude-opus-5-5', 'Claude Opus 5.5 (가장 꼼꼼해요, 약 400원)'),
]
UNIT_MODES = [
    ('auto', '자동 (ElevenLabs, Gemini, Typecast는 단계 통째로)'),
    ('step', '단계 통째로 (말이 더 자연스럽게 이어져요)'),
    ('sentence', '문장마다 (표시 타이밍이 더 정확해요)'),
]


def startup_file():
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return None
    return Path(appdata) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup' / 'IvyEngine.vbs'


def set_autostart(on):
    f = startup_file()
    if not f:
        raise RuntimeError('윈도우에서만 쓸 수 있어요.')
    if not on:
        if f.exists():
            f.unlink()
        return False
    bat = ROOT / 'run_engine.bat'
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        'Set sh = CreateObject("WScript.Shell")\r\n'
        f'sh.CurrentDirectory = "{ROOT}"\r\n'
        f'sh.Run """{bat}"" --no-browser", 7, False\r\n',
        encoding='utf-16',
    )
    return True


def ui_token():
    """설정 화면 비밀값. 엔진이 업데이트로 다시 켜져도 열어 둔 화면이 계속 되도록 파일에 둬요."""
    f = config.APP_DIR / 'ui_token'
    try:
        t = f.read_text(encoding='utf-8').strip()
        if len(t) >= 20:
            return t
    except OSError:
        pass
    t = secrets.token_urlsafe(24)
    try:
        config.APP_DIR.mkdir(parents=True, exist_ok=True)
        f.write_text(t, encoding='utf-8')
    except OSError:
        pass
    return t


def claude_check(s):
    import anthropic

    key = (s.get('claude_key') or '').strip()
    if not key:
        return False, 'API 키를 먼저 넣어 주세요.'
    try:
        client = anthropic.Anthropic(api_key=key, max_retries=1, timeout=60)
        msg = client.messages.create(model=s.get('claude_model') or 'claude-sonnet-5-5', max_tokens=20, messages=[{'role': 'user', 'content': '"연결 확인"이라고만 답해 주세요.'}])
        text = ''.join(getattr(b, 'text', '') for b in msg.content).strip()
        return True, f'잘 연결됐어요. ({text[:30]})'
    except anthropic.AuthenticationError:
        return False, 'API 키가 맞지 않아요.'
    except anthropic.NotFoundError:
        return False, '모델 이름을 찾지 못했어요.'
    except anthropic.PermissionDeniedError:
        return False, '이 API 키로는 이 모델을 쓸 수 없어요.'
    except anthropic.BadRequestError as e:
        m = str(e).lower()
        if 'credit' in m or 'balance' in m:
            return False, 'Claude API 크레딧이 없어요. console.anthropic.com → Billing에서 크레딧을 충전해 주세요. Claude 앱 구독과는 따로예요.'
        return False, f'Claude가 요청을 거절했어요: {str(e)[:160]}'
    except anthropic.APIConnectionError:
        return False, 'Claude에 연결하지 못했어요. 인터넷을 확인해 주세요.'
    except anthropic.APIStatusError as e:
        return False, f'Claude 응답 오류 ({e.status_code}): {str(e)[:160]}'


class UI:
    def __init__(self, engine):
        self.engine = engine
        self.token = ui_token()
        self.port = None
        self.url = ''

    def start(self, open_browser=True):
        base = int(self.engine.settings.get('ui_port') or 8765)
        ui = self
        handler = type('H', (Handler,), {'ui': ui})
        for port in range(base, base + 20):
            try:
                self.httpd = ThreadingHTTPServer(('127.0.0.1', port), handler)
                self.port = port
                break
            except OSError:
                continue
        if not self.port:
            raise RuntimeError('설정 화면을 열 포트를 찾지 못했어요.')
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.port}/'
        if open_browser:
            webbrowser.open(self.url)

    def state(self):
        e = self.engine
        s = dict(e.settings)
        masked = {}
        for k in SECRET_FIELDS:
            masked[k] = config.mask(s.get(k)) if k != 'connection' else (s.get(k)[:18] + '…' if s.get(k) else '')
            masked['has_' + k] = bool(s.get(k))
            s.pop(k, None)
        sf = startup_file()
        return {
            'version': VERSION,
            'status': e.status,
            'connected': e.connected,
            'origin': e.origin,
            'academy': e.academy.get('academy_name') if e.academy else '',
            'job': e.job,
            'done_count': e.done_count,
            'logs': list(e.logs)[-120:],
            'settings': s,
            'secrets': masked,
            'voices': {'edge': tts.EDGE_VOICES, 'google': tts.GOOGLE_VOICES, 'gemini': tts.GEMINI_VOICES, 'elevenlabs': tts.ELEVEN_VOICES,
                       'typecast': [(s.get('typecast_voice'), s.get('typecast_voice_name') or s.get('typecast_voice'))] if s.get('typecast_voice') else []},
            'eleven_models': tts.ELEVEN_MODELS,
            'typecast_models': tts.TYPECAST_MODELS,
            'typecast_emotions': tts.TYPECAST_EMOTIONS,
            'whisper_models': stt.MODELS,
            'unit_modes': UNIT_MODES,
            'claude_models': CLAUDE_MODELS,
            'update': e.update_info,
            'auto_update_off': updater.disabled(),
            'windows': os.name == 'nt',
            'autostart': bool(sf and sf.exists()),
            'data_dir': str(config.APP_DIR),
        }

    def merged(self, patch):
        s = dict(self.engine.settings)
        for k, v in (patch or {}).items():
            if k not in config.DEFAULTS:
                continue
            if k in SECRET_FIELDS and (v is None or str(v).strip() == ''):
                continue
            s[k] = v.strip() if isinstance(v, str) else v
        return s


class Handler(BaseHTTPRequestHandler):
    ui = None
    server_version = 'IvyEngineUI'

    def log_message(self, *args):
        pass

    def _host_ok(self):
        h = (self.headers.get('Host') or '').lower()
        return h in (f'127.0.0.1:{self.ui.port}', f'localhost:{self.ui.port}')

    def _token_ok(self, q=None):
        t = self.headers.get('X-Token') or ((q or {}).get('t') or [''])[0]
        return secrets.compare_digest(t, self.ui.token)

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 2_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            return {}

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {'error': 'forbidden'})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/':
            html = (HERE / 'ui.html').read_text(encoding='utf-8').replace('__TOKEN__', self.ui.token)
            return self._send(200, html.encode('utf-8'), 'text/html; charset=utf-8', {'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'"})
        if u.path == '/favicon.ico':
            return self._send(204, b'', 'image/x-icon')
        if not self._token_ok(q):
            return self._send(401, {'error': 'token'})
        if u.path == '/api/state':
            return self._send(200, self.ui.state())
        m = re.match(r'^/audio/([0-9a-f]{32})\.wav$', u.path)
        if m:
            f = config.cache_dir() / 'tts' / f'{m.group(1)}.wav'
            if f.exists():
                return self._send(200, f.read_bytes(), 'audio/wav')
        return self._send(404, {'error': '없는 주소예요.'})

    def do_POST(self):
        if not self._host_ok() or not self._token_ok():
            return self._send(403, {'error': 'forbidden'})
        u = urlparse(self.path)
        b = self._body()
        ui = self.ui
        e = ui.engine
        try:
            if u.path == '/api/settings':
                patch = {}
                for k, v in (b or {}).items():
                    if k not in config.DEFAULTS:
                        continue
                    if k in SECRET_FIELDS and (v is None or str(v).strip() == ''):
                        continue
                    patch[k] = v.strip() if isinstance(v, str) else v
                for k in b.get('clear') or []:
                    if k in SECRET_FIELDS:
                        patch[k] = ''
                if patch.get('connection'):
                    config.parse_connection(patch['connection'])
                if 'speed' in patch:
                    patch['speed'] = max(0.7, min(1.4, float(patch['speed'])))
                if 'eleven_stability' in patch:
                    patch['eleven_stability'] = max(0.0, min(1.0, float(patch['eleven_stability'])))
                e.update_settings(patch)
                e.log('설정을 저장했어요.')
                return self._send(200, {'ok': True})
            if u.path == '/api/test-connection':
                s = ui.merged(b)
                origin, token = config.parse_connection(s.get('connection'))
                info = Cloud(origin, token).hello('연결 확인 중', tts.voice_label(s))
                return self._send(200, {'ok': True, 'message': f'{info.get("academy_name", "")} 강의실에 연결됐어요.'})
            if u.path == '/api/test-claude':
                ok, msg = claude_check(ui.merged(b))
                return self._send(200, {'ok': ok, 'message': msg})
            if u.path == '/api/test-voice':
                s = ui.merged(b)
                academy = (e.academy or {}).get('academy_name') or ''
                path = tts.synth(b.get('text') or tts.sample_text(academy), s)
                return self._send(200, {'ok': True, 'audio': f'/audio/{path.stem}.wav?t={ui.token}', 'seconds': round(tts.wav_seconds(path), 1)})
            if u.path == '/api/eleven-voices':
                s = ui.merged(b)
                return self._send(200, {'ok': True, 'voices': tts.eleven_voices(s.get('eleven_key'))})
            if u.path == '/api/typecast-voices':
                s = ui.merged(b)
                return self._send(200, {'ok': True, 'voices': tts.typecast_voices(s.get('typecast_key'), s.get('typecast_model'))})
            if u.path == '/api/check-update':
                if updater.disabled():
                    return self._send(200, {'ok': False, 'message': '개발용 폴더라서 자동 업데이트를 하지 않아요.'})
                try:
                    c = e.cloud()
                    m, changed = updater.check(c)
                except (ValueError, CloudError) as ex:
                    return self._send(200, {'ok': False, 'message': f'확인하지 못했어요: {ex}'})
                e.update_info = {'version': m.get('version'), 'build': m.get('build'), 'pending': len(changed), 'checked': __import__('time').time()}
                if not changed:
                    return self._send(200, {'ok': True, 'message': f'지금이 최신 버전이에요 ({m.get("version")}).'})
                if e.job:
                    return self._send(200, {'ok': True, 'message': f'새 버전 {m.get("version")}이 있어요. 지금 작업이 끝나면 바꿀게요.'})
                e.last_update_check = 0
                e.wake_ev.set()
                return self._send(200, {'ok': True, 'message': f'새 버전 {m.get("version")}으로 바꾸는 중이에요. 잠시 뒤 엔진이 다시 켜져요.'})
            if u.path == '/api/autostart':
                on = set_autostart(bool(b.get('on')))
                return self._send(200, {'ok': True, 'autostart': on})
            if u.path == '/api/open-folder':
                if os.name == 'nt':
                    os.startfile(str(config.APP_DIR))  # noqa
                return self._send(200, {'ok': True})
        except ValueError as ex:
            return self._send(200, {'ok': False, 'message': str(ex)})
        except tts.TTSError as ex:
            return self._send(200, {'ok': False, 'message': str(ex)})
        except CloudError as ex:
            return self._send(200, {'ok': False, 'message': str(ex)})
        except Exception as ex:
            return self._send(200, {'ok': False, 'message': f'{ex.__class__.__name__}: {ex}'})
        return self._send(404, {'error': '없는 주소예요.'})
