"""설정 읽고 쓰기. 설정 파일은 이 PC 사용자 폴더(%LOCALAPPDATA%\\IvyEngine)에만 저장돼요. API 키는 강의실 사이트로 보내지 않아요."""

import base64
import json
import os
import threading
from pathlib import Path

APP_DIR = Path(os.environ.get('LOCALAPPDATA') or (Path.home() / '.local' / 'share')) / 'IvyEngine'
SETTINGS_FILE = APP_DIR / 'settings.json'

DEFAULTS = {
    'connection': '',  # 강의실 사이트 > 설정 > 제작 엔진 에서 만든 연결 코드 (설치 파일에 들어 있어요)
    'claude_key': '',
    'claude_model': 'claude-sonnet-5-5',  # 가장 저렴하고 충분히 좋아요. 더 꼼꼼하게: claude-opus-5-5
    'tts_provider': 'edge',  # edge(무료) | google(Chirp 3 HD) | gemini | elevenlabs | typecast
    'edge_voice': 'ko-KR-HyunsuMultilingualNeural',
    'google_key': '',
    'google_voice': 'ko-KR-Chirp3-HD-Charon',
    'gemini_key': '',
    'gemini_model': 'gemini-3.8-flash-tts',
    'gemini_voice': 'Charon',
    'gemini_style': '학생 한 명에게 말을 건네듯 생기 있고 친근한 한국 학원 영어 선생님. 중요한 부분은 힘주어 또박또박, 영어 단어와 문장은 원어민처럼 자연스럽게',
    'eleven_key': '',
    'eleven_voice': 'nPczCjzI2devNBz1zQrb',
    'eleven_voice_name': '',
    'eleven_model': 'eleven_v4',
    'eleven_stability': 0.5,
    'typecast_key': '',
    'typecast_voice': '',
    'typecast_voice_name': '',
    'typecast_model': 'ssfm-v30',
    'typecast_emotion': 'smart',
    'tts_unit': 'auto',  # auto | step(단계 통째로, 자연스러워요) | sentence(문장마다)
    'name_generic': '여러분',  # 이름을 모를 때 이름 자리에서 하는 말
    'speed': 1.0,
    'whisper_model': 'large-v3-turbo',  # 자동 자막: large-v3-turbo(정확) | medium | small(빠름)
    'browser': 'auto',  # auto | msedge | chrome | chromium
    'fps': 30,
    'keep_work': False,
    'auto_update': True,
    'poll_seconds': 10,
    'ui_port': 8765,
}

_lock = threading.Lock()


def load():
    data = dict(DEFAULTS)
    try:
        with open(SETTINGS_FILE, encoding='utf-8') as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            data.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except FileNotFoundError:
        pass
    except Exception as e:  # 깨진 설정 파일은 기본값으로 시작
        print(f'[설정] 설정 파일을 읽지 못해 기본값으로 시작해요: {e}')
    return data


def save(data):
    with _lock:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        clean = {k: data.get(k, v) for k, v in DEFAULTS.items()}
        tmp = SETTINGS_FILE.with_suffix('.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS_FILE)


def work_dir():
    d = APP_DIR / 'work'
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache_dir():
    d = APP_DIR / 'cache'
    d.mkdir(parents=True, exist_ok=True)
    return d


def parse_connection(code):
    """'ivy1.<주소 base64url>.<토큰>' → (주소, 토큰). 형식이 틀리면 ValueError."""
    code = (code or '').strip()
    parts = code.split('.', 2)
    if len(parts) != 3 or parts[0] != 'ivy1' or not parts[1] or not parts[2]:
        raise ValueError('연결 코드 형식이 맞지 않아요. 강의실 사이트 > 설정 > 제작 엔진에서 다시 복사해 주세요.')
    pad = '=' * (-len(parts[1]) % 4)
    try:
        origin = base64.urlsafe_b64decode(parts[1] + pad).decode('utf-8').rstrip('/')
    except Exception:
        raise ValueError('연결 코드가 망가졌어요. 다시 복사해 주세요.')
    if not origin.startswith(('http://', 'https://')):
        raise ValueError('연결 코드 안의 주소가 올바르지 않아요.')
    return origin, parts[2]


def mask(secret):
    s = secret or ''
    if len(s) <= 8:
        return '•' * len(s)
    return s[:4] + '•' * 6 + s[-4:]


def model_dir():
    d = APP_DIR / 'models'
    d.mkdir(parents=True, exist_ok=True)
    return d
