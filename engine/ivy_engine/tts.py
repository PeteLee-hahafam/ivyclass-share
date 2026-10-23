"""목소리 만들기 (TTS). 무료 Edge 목소리, Google Chirp 3 HD, Gemini TTS, ElevenLabs 중에서 골라 써요."""

import asyncio
import base64
import hashlib
import json
import os
import re
import subprocess
import time
import wave
from pathlib import Path

import requests

from .config import cache_dir
from .textutil import speakable

SR = 24000

EDGE_VOICES = [
    ('ko-KR-HyunsuMultilingualNeural', '현수 (남자, 영어 섞인 문장에 좋아요)'),
    ('ko-KR-InJoonNeural', '인준 (남자)'),
    ('ko-KR-SunHiNeural', '선희 (여자)'),
]
CHIRP_MALE = ['Charon', 'Puck', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Algieba', 'Alnilam', 'Achird', 'Algenib', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Umbriel', 'Zubenelgenubi']
CHIRP_FEMALE = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Achernar', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux', 'Laomedeia', 'Pulcherrima', 'Sulafat', 'Vindemiatrix']
GOOGLE_VOICES = [(f'ko-KR-Chirp3-HD-{v}', f'{v} (남자)') for v in CHIRP_MALE] + [(f'ko-KR-Chirp3-HD-{v}', f'{v} (여자)') for v in CHIRP_FEMALE]
GEMINI_VOICES = [(v, f'{v} (남자)') for v in CHIRP_MALE] + [(v, f'{v} (여자)') for v in CHIRP_FEMALE]
# ElevenLabs 기본 목소리 (설정 화면에서 내 계정 목소리 — 내 목소리 복제, 보이스 라이브러리에서 담은 한국어 목소리 — 도 불러올 수 있어요)
ELEVEN_VOICES = [
    ('nPczCjzI2devNBz1zQrb', 'Brian (남자, 차분해요)'),
    ('JBFqnCBsd6RMkjVDRZzb', 'George (남자, 따뜻해요)'),
    ('onwK4e9ZLuTAKqWW03F9', 'Daniel (남자, 또렷해요)'),
    ('cjVigY5qzO86Huf0OWal', 'Eric (남자, 친근해요)'),
    ('EXAVITQu4vr4xnSDxMaL', 'Sarah (여자, 부드러워요)'),
    ('XrExE9yKIg1WjnnlVkGX', 'Matilda (여자, 밝아요)'),
    ('cgSgspJ2msm6clMCkdW9', 'Jessica (여자, 명랑해요)'),
]
ELEVEN_MODELS = [
    ('eleven_v4', 'Eleven v4 (가장 사람 같아요, 추천)'),
    ('eleven_v3', 'Eleven v3 (감정 표현)'),
    ('eleven_multilingual_v2', 'Multilingual v2 (차분하고 안정적이에요)'),
    ('eleven_flash_v2_5', 'Flash v2.5 (값이 절반이에요)'),
]
# Eleven v3 가 알아듣는 감정 표시. 다른 목소리에서는 지워서 읽어요.
AUDIO_TAGS = ('laughs', 'chuckles', 'excited', 'curious', 'surprised', 'whispers', 'sighs', 'warmly', 'playfully', 'emphasizes', 'pause')
TAG_RE = re.compile(r'\[\s*(' + '|'.join(AUDIO_TAGS) + r')\s*\]', re.I)


def strip_tags(text):
    return re.sub(r'\s{2,}', ' ', TAG_RE.sub(' ', str(text or ''))).strip()


# Typecast (한국 회사, 한국어 성우 목소리가 많아요). 목소리는 계정에서 불러와요.
TYPECAST_MODELS = [
    ('ssfm-v30', 'ssfm-v30 (가장 자연스러워요, 추천)'),
    ('ssfm-v21', 'ssfm-v21 (빨라요)'),
]
TYPECAST_EMOTIONS = [
    ('smart', '문맥 따라 저절로 (추천)'),
    ('normal', '보통'),
    ('happy', '밝게'),
    ('toneup', '힘 있게'),
    ('tonedown', '차분하게'),
]
TYPECAST_API = 'https://api.typecast.ai'

# [excited] 같은 감정 표시를 알아듣는 모델
EXPRESSIVE_MODELS = ('eleven_v4', 'eleven_v4_turbo', 'eleven_v3')


def is_expressive(s):
    return (s.get('tts_provider') == 'elevenlabs') and (s.get('eleven_model') or 'eleven_v4') in EXPRESSIVE_MODELS


class TTSError(Exception):
    pass


def ffmpeg_exe():
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def run_ffmpeg(args, capture=True):
    flags = 0x08000000 if os.name == 'nt' else 0  # 윈도우에서 검은 창이 뜨지 않게
    p = subprocess.run([ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y', *args], capture_output=capture, creationflags=flags)
    if p.returncode != 0:
        err = (p.stderr or b'').decode('utf-8', 'replace')[-600:]
        raise RuntimeError(f'ffmpeg 오류: {err}')
    return p


def to_wav(src, dst, tempo=1.0, raw_pcm_rate=None):
    args = []
    if raw_pcm_rate:
        args += ['-f', 's16le', '-ar', str(raw_pcm_rate), '-ac', '1']
    args += ['-i', str(src)]
    if abs(tempo - 1.0) > 0.01:
        args += ['-af', f'atempo={max(0.5, min(2.0, tempo)):.3f}']
    args += ['-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', str(dst)]
    run_ffmpeg(args)


def wav_seconds(path):
    with wave.open(str(path), 'rb') as w:
        return w.getnframes() / float(w.getframerate())


def voice_name(label):
    """'Brian (남자, 차분해요)' → 'Brian'"""
    return re.split(r' \(| ·', str(label or ''), 1)[0].strip()


def voice_label(s):
    p = s.get('tts_provider')
    if p == 'google':
        return f"Google {s.get('google_voice', '').replace('ko-KR-Chirp3-HD-', 'Chirp3 ')}"
    if p == 'gemini':
        return f"Gemini {s.get('gemini_voice')}"
    if p == 'elevenlabs':
        vid = s.get('eleven_voice') or ''
        name = next((voice_name(n) for v, n in ELEVEN_VOICES if v == vid), None) or s.get('eleven_voice_name') or vid[:8]
        return f"ElevenLabs {name}"
    if p == 'typecast':
        return f"Typecast {s.get('typecast_voice_name') or (s.get('typecast_voice') or '')[:12]}"
    if p == 'test':
        return '시험용 무음'
    return f"Edge {s.get('edge_voice', '').replace('ko-KR-', '').replace('Neural', '')}"


def _cache_key(s, text):
    p = s.get('tts_provider')
    parts = [p, str(s.get('speed'))]
    if p == 'google':
        parts += [s.get('google_voice')]
    elif p == 'gemini':
        parts += [s.get('gemini_model'), s.get('gemini_voice'), s.get('gemini_style')]
    elif p == 'elevenlabs':
        parts += [s.get('eleven_model'), s.get('eleven_voice'), s.get('eleven_stability')]
    elif p == 'typecast':
        parts += [s.get('typecast_model'), s.get('typecast_voice'), s.get('typecast_emotion')]
    else:
        parts += [s.get('edge_voice')]
    parts.append(text)
    return hashlib.sha256('␟'.join(map(str, parts)).encode('utf-8')).hexdigest()[:32]


# ------------------------------------------------------------ 목소리 정보 (강의마다 기록해 두고, 학생 이름 목소리를 같은 목소리로 만들어요)
def voice_spec(s, tone='banmal'):
    p = s.get('tts_provider') or 'edge'
    spec = {'provider': p, 'speed': round(float(s.get('speed') or 1.0), 2), 'tone': 'jondaet' if tone == 'jondaet' else 'banmal'}
    if p == 'google':
        spec.update(voice=s.get('google_voice') or '', model='chirp3-hd')
    elif p == 'gemini':
        spec.update(voice=s.get('gemini_voice') or '', model=s.get('gemini_model') or '', style=(s.get('gemini_style') or '')[:300])
    elif p == 'elevenlabs':
        spec.update(voice=s.get('eleven_voice') or '', model=s.get('eleven_model') or 'eleven_v4', stability=float(s.get('eleven_stability') or 0.5))
    elif p == 'typecast':
        spec.update(voice=s.get('typecast_voice') or '', model=s.get('typecast_model') or 'ssfm-v30', style=s.get('typecast_emotion') or 'smart')
    elif p == 'test':
        spec.update(voice='silence', model='')
    else:
        spec.update(voice=s.get('edge_voice') or '', model='edge')
    spec['k'] = hashlib.sha1(json.dumps(spec, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()[:16]
    spec['label'] = voice_label(s)
    return spec


def settings_for(spec, current):
    """기록해 둔 목소리 정보로 그때와 같은 목소리 설정을 만들어요 (API 키는 지금 설정에서 가져와요)."""
    s = dict(current)
    p = spec.get('provider') or 'edge'
    s['tts_provider'] = p
    s['speed'] = spec.get('speed') or 1.0
    if p == 'google':
        s['google_voice'] = spec.get('voice')
    elif p == 'gemini':
        s.update(gemini_voice=spec.get('voice'), gemini_model=spec.get('model'), gemini_style=spec.get('style', ''))
    elif p == 'elevenlabs':
        s.update(eleven_voice=spec.get('voice'), eleven_model=spec.get('model'), eleven_stability=spec.get('stability', 0.5))
    elif p == 'typecast':
        s.update(typecast_voice=spec.get('voice'), typecast_model=spec.get('model') or 'ssfm-v30', typecast_emotion=spec.get('style') or 'smart')
    elif p == 'edge':
        s['edge_voice'] = spec.get('voice')
    return s


def can_speak(spec, current):
    p = spec.get('provider') or 'edge'
    need = {'google': 'google_key', 'gemini': 'gemini_key', 'elevenlabs': 'eleven_key', 'typecast': 'typecast_key'}.get(p)
    return p == 'test' or not need or bool((current.get(need) or '').strip())


# ------------------------------------------------------------ 제공자별
def _edge(text, voice, speed, out_mp3):
    try:
        import edge_tts
    except ImportError:
        raise TTSError('무료 목소리(edge-tts) 프로그램이 설치되지 않았어요. setup_engine.bat 을 다시 실행해 주세요.')
    rate = f'{int(round((float(speed) - 1) * 100)):+d}%'

    async def go():
        c = edge_tts.Communicate(text, voice, rate=rate)
        await c.save(str(out_mp3))

    last = None
    for i in range(3):
        try:
            asyncio.run(go())
            if Path(out_mp3).exists() and Path(out_mp3).stat().st_size > 0:
                return
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise TTSError(f'무료 목소리를 만들지 못했어요. 인터넷을 확인해 주세요. ({last})')


def _google(text, key, voice, speed, out_wav):
    if not key:
        raise TTSError('Google API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    lang = '-'.join(voice.split('-')[:2]) if voice.count('-') >= 2 else 'ko-KR'
    body = {
        'input': {'text': text},
        'voice': {'languageCode': lang, 'name': voice},
        'audioConfig': {'audioEncoding': 'LINEAR16', 'sampleRateHertz': SR, 'speakingRate': float(speed)},
    }
    for i in range(4):
        try:
            r = requests.post('https://texttospeech.googleapis.com/v1/text:synthesize', json=body, headers={'X-Goog-Api-Key': key}, timeout=120)
        except requests.RequestException as e:
            if i == 3:
                raise TTSError(f'Google 음성 서버에 연결하지 못했어요: {e.__class__.__name__}')
            time.sleep(2 * (i + 1))
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(3 * (i + 1))
            continue
        if r.status_code != 200:
            raise TTSError(f'Google 음성 만들기 실패: {_gerr(r)}')
        Path(out_wav).write_bytes(base64.b64decode(r.json()['audioContent']))
        return
    raise TTSError('Google 음성 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.')


def _gerr(r):
    try:
        e = r.json().get('error') or {}
        msg = e.get('message') or str(e)
    except ValueError:
        msg = r.text[:300]
    if r.status_code in (401, 403):
        return f'API 키가 맞지 않거나 이 기능이 켜져 있지 않아요 ({msg[:200]})'
    return f'{r.status_code} {msg[:300]}'


def _find_audio(o):
    if isinstance(o, dict):
        mime = str(o.get('mime_type') or o.get('mimeType') or '')
        if isinstance(o.get('data'), str) and (o.get('type') == 'audio' or mime.startswith('audio')):
            return o['data'], mime
        for k in ('inlineData', 'inline_data'):
            if isinstance(o.get(k), dict):
                r = _find_audio(o[k])
                if r:
                    return r
        for v in o.values():
            r = _find_audio(v)
            if r:
                return r
    elif isinstance(o, list):
        for v in reversed(o):
            r = _find_audio(v)
            if r:
                return r
    return None


def _gemini(text, s, out_any):
    key = s.get('gemini_key')
    if not key:
        raise TTSError('Gemini API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    model = s.get('gemini_model') or 'gemini-3.8-flash-tts'
    voice = s.get('gemini_voice') or 'Charon'
    style = (s.get('gemini_style') or '').strip()
    if model.startswith('gemini-2'):
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
        body = {
            'contents': [{'parts': [{'text': f'{style}:\n{text}' if style else text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}},
        }
    else:
        content = {'type': 'text', 'text': text}
        if style:
            content['annotations'] = [{'type': 'speech_metadata', 'style': style}]
        url = 'https://generativelanguage.googleapis.com/v1beta/interactions'
        body = {
            'model': model,
            'input': [{'type': 'user_input', 'content': [content]}],
            'response_format': {'type': 'audio'},
            'generation_config': {'speech_config': [{'voice': voice}]},
        }
    for i in range(5):
        try:
            r = requests.post(url, json=body, headers={'x-goog-api-key': key}, timeout=180)
        except requests.RequestException as e:
            if i == 4:
                raise TTSError(f'Gemini 서버에 연결하지 못했어요: {e.__class__.__name__}')
            time.sleep(2 * (i + 1))
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(5 * (i + 1))
            continue
        if r.status_code != 200:
            raise TTSError(f'Gemini 음성 만들기 실패: {_gerr(r)}')
        found = _find_audio(r.json())
        if not found:
            raise TTSError('Gemini가 음성을 돌려주지 않았어요. 모델 이름을 확인해 주세요.')
        data = base64.b64decode(found[0])
        if data[:4] == b'RIFF':
            Path(out_any).write_bytes(data)
            return None
        m = re.search(r'rate=(\d+)', found[1] or '')
        Path(out_any).write_bytes(data)
        return int(m.group(1)) if m else 24000
    raise TTSError('Gemini 음성 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.')


def _write_pcm_wav(pcm, out_wav, rate=SR):
    with wave.open(str(out_wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def _eleven(text, s, out_wav):
    """ElevenLabs: 글자마다 언제 말했는지(타임스탬프)도 함께 받아요. 판서 표시를 말과 정확히 맞출 수 있어요."""
    key = (s.get('eleven_key') or '').strip()
    if not key:
        raise TTSError('ElevenLabs API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    voice = (s.get('eleven_voice') or ELEVEN_VOICES[0][0]).strip()
    model = s.get('eleven_model') or 'eleven_v4'
    snap = lambda v: min((0.0, 0.5, 1.0), key=lambda x: abs(x - v))  # v3 는 0, 0.5, 1 세 값만 받아요
    st = max(0.0, min(1.0, float(s.get('eleven_stability') or 0.5)))
    if model.startswith('eleven_v3'):
        st = snap(st)
    body = {
        'text': text,
        'model_id': model,
        'voice_settings': {'stability': st, 'similarity_boost': 0.8, 'use_speaker_boost': True},
    }
    if model != 'eleven_multilingual_v2':
        body['language_code'] = 'ko'
    base = f'https://api.elevenlabs.io/v1/text-to-speech/{voice}'
    timed = True  # 글자별 시간을 못 주는 모델이면 소리만 받아요 (그때는 시간을 글자 수로 나눠요)
    for i in range(7):
        url = f'{base}/with-timestamps?output_format=pcm_24000' if timed else f'{base}?output_format=pcm_24000'
        try:
            r = requests.post(url, json=body, headers={'xi-api-key': key, 'Accept': 'application/json' if timed else 'audio/*'}, timeout=240)
        except requests.RequestException as e:
            if i == 6:
                raise TTSError(f'ElevenLabs 서버에 연결하지 못했어요: {e.__class__.__name__}')
            time.sleep(2 * (i + 1))
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(4 * (i + 1))
            continue
        if r.status_code in (400, 422):
            low = r.text.lower()
            if 'language_code' in body and 'language' in low:
                body.pop('language_code')
                continue
            if 'stability' in low and body['voice_settings']['stability'] not in (0.0, 0.5, 1.0):
                body['voice_settings']['stability'] = snap(body['voice_settings']['stability'])
                continue
            if timed:  # 글자별 시간을 못 주는 경우가 많아요. 소리만 한 번 더 받아 보고, 그래도 안 되면 그 오류를 알려요
                timed = False
                continue
        if r.status_code != 200:
            raise TTSError(f'ElevenLabs 음성 만들기 실패: {_eerr(r)}')
        if not timed:
            _write_pcm_wav(r.content, out_wav)
            return None
        data = r.json()
        _write_pcm_wav(base64.b64decode(data.get('audio_base64') or ''), out_wav)
        al = data.get('alignment') or data.get('normalized_alignment') or {}
        chars = al.get('characters') or []
        starts = al.get('character_start_times_seconds') or []
        if chars and len(chars) == len(starts):
            return {'chars': ''.join(chars), 'starts': [round(float(x), 3) for x in starts]}
        return None
    raise TTSError('ElevenLabs 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.')


def _typecast_prompt(model, emotion, plain=False):
    if model == 'ssfm-v30':
        if plain or emotion not in ('normal', 'happy', 'sad', 'angry', 'whisper', 'toneup', 'tonedown', 'smart'):
            emotion = 'normal'
        if emotion == 'smart':
            return {'emotion_type': 'smart'}
        return {'emotion_type': 'preset', 'emotion_preset': emotion, 'emotion_intensity': 1.0}
    if plain or emotion not in ('normal', 'happy', 'sad', 'angry'):
        emotion = 'normal'
    return {'emotion_preset': emotion, 'emotion_intensity': 1.0}


def _align_from_segments(segs):
    """Typecast 의 글자(또는 단어)별 시작·끝 시간을 글자별 시작 시간으로 펴요."""
    chars, starts = [], []
    for sg in segs or []:
        t = str((sg or {}).get('text') or '')
        if not t:
            continue
        a = float(sg.get('start') or 0)
        b = float(sg.get('end') or a)
        for j, ch in enumerate(t):
            chars.append(ch)
            starts.append(round(a + (b - a) * j / len(t), 3))
    return {'chars': ''.join(chars), 'starts': starts} if chars else None


def _typecast(text, s, out_any):
    """Typecast: 글자별 시간도 함께 받아서 판서 표시를 말과 맞춰요."""
    key = (s.get('typecast_key') or '').strip()
    if not key:
        raise TTSError('Typecast API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    voice = (s.get('typecast_voice') or '').strip()
    if not voice:
        raise TTSError('Typecast 목소리를 먼저 골라 주세요. 설정에서 목소리 불러오기를 누르면 돼요.')
    model = s.get('typecast_model') or 'ssfm-v30'
    emotion = s.get('typecast_emotion') or 'smart'
    body = {'voice_id': voice, 'text': text[:2000], 'model': model, 'prompt': _typecast_prompt(model, emotion), 'output': {'audio_format': 'wav'}}
    headers = {'X-API-KEY': key, 'Content-Type': 'application/json'}
    timed, plain_prompt = True, False
    for i in range(7):
        url = f'{TYPECAST_API}/v1/text-to-speech/with-timestamps?granularity=char' if timed else f'{TYPECAST_API}/v1/text-to-speech'
        try:
            r = requests.post(url, json=body, headers=headers, timeout=240)
        except requests.RequestException as e:
            if i == 6:
                raise TTSError(f'Typecast 서버에 연결하지 못했어요: {e.__class__.__name__}')
            time.sleep(2 * (i + 1))
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(4 * (i + 1))
            continue
        if r.status_code in (400, 422):
            low = r.text.lower()
            if not plain_prompt and ('emotion' in low or 'prompt' in low):  # 이 목소리가 그 감정을 못 내면 보통으로
                plain_prompt = True
                body['prompt'] = _typecast_prompt(model, emotion, plain=True)
                continue
            if timed:  # 글자별 시간을 못 주면 소리만 받아요
                timed = False
                continue
        if r.status_code != 200:
            raise TTSError(f'Typecast 음성 만들기 실패: {_terr(r)}')
        if not timed:
            Path(out_any).write_bytes(r.content)
            return None
        data = r.json()
        Path(out_any).write_bytes(base64.b64decode(data.get('audio') or ''))
        return _align_from_segments(data.get('characters')) or _align_from_segments(data.get('words'))
    raise TTSError('Typecast 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.')


def _terr(r):
    try:
        d = r.json()
    except ValueError:
        return f'{r.status_code} {r.text[:200]}'
    msg = d.get('message') or d.get('detail') or d.get('error') or '' if isinstance(d, dict) else d
    if isinstance(msg, (dict, list)):
        msg = json.dumps(msg, ensure_ascii=False)
    msg = str(msg)
    if r.status_code == 401:
        return 'API 키가 맞지 않아요.'
    if r.status_code == 402 or 'credit' in msg.lower():
        return 'Typecast 크레딧이 모자라요. 요금제를 확인해 주세요.'
    if r.status_code == 403:
        return f'이 키로는 쓸 수 없어요 ({msg[:120]})'
    if r.status_code == 404:
        return '목소리를 찾지 못했어요. 목소리를 다시 골라 주세요.'
    return f'{r.status_code} {msg[:200]}'


TC_WORD = {'male': '남자', 'female': '여자', 'child': '어린이', 'teenager': '청소년', 'young_adult': '청년', 'middle_age': '중년', 'elder': '노년',
           'education': '교육', 'e-learning': '교육', 'lecture': '강의', 'audiobook': '오디오북', 'news': '뉴스', 'ads': '광고', 'announcer': '안내',
           'documentary': '다큐', 'game': '게임', 'anime': '애니', 'conversational': '대화', 'podcast': '팟캐스트', 'storytelling': '이야기'}


def typecast_voices(key, model='ssfm-v30'):
    """Typecast 목소리 목록. 내가 만든 목소리, 교육용 목소리를 위로 올려요."""
    if not (key or '').strip():
        raise TTSError('Typecast API 키를 먼저 넣어 주세요.')
    r = requests.get(f'{TYPECAST_API}/v3/voices', params={'model': model or 'ssfm-v30'}, headers={'X-API-KEY': key.strip()}, timeout=60)
    if r.status_code != 200:
        raise TTSError(f'목소리 목록을 받지 못했어요: {_terr(r)}')
    data = r.json()
    items = data if isinstance(data, list) else (data.get('voices') or data.get('result') or [])
    rows = []
    for v in items:
        vid = v.get('voice_id')
        if not vid:
            continue
        names = v.get('voice_name') or {}
        name = (names.get('kor') or names.get('eng')) if isinstance(names, dict) else str(names)
        uses = [str(u) for u in (v.get('use_cases') or [])]
        edu = any(('educ' in u.lower() or 'lectur' in u.lower() or 'learn' in u.lower()) for u in uses)
        bits = [TC_WORD.get(str(x).lower(), x) for x in (v.get('gender'), v.get('age')) if x]
        if uses:
            bits.append(TC_WORD.get(uses[0].lower(), uses[0]))
        if v.get('voice_type') == 'custom':
            bits.insert(0, '내 목소리')
        label = f"{name} ({', '.join(bits)})" if bits else str(name)
        rows.append((0 if v.get('voice_type') == 'custom' else 1 if edu else 2, str(name), vid, label))
    rows.sort(key=lambda x: (x[0], x[1]))
    return [(vid, label) for _, _, vid, label in rows]


def _eerr(r):
    try:
        d = r.json().get('detail')
        if isinstance(d, dict):
            st, msg = d.get('status') or '', d.get('message') or ''
        else:
            st, msg = '', str(d)
    except ValueError:
        st, msg = '', r.text[:300]
    if r.status_code == 401 or st in ('invalid_api_key', 'missing_permissions'):
        return f'API 키가 맞지 않거나 권한이 없어요 ({msg[:160]})'
    if st == 'quota_exceeded' or r.status_code == 402:
        return 'ElevenLabs 크레딧(글자 수)이 모자라요. 요금제를 확인해 주세요.'
    if st in ('voice_not_found',) or r.status_code == 404:
        return '목소리를 찾지 못했어요. 설정에서 목소리를 다시 골라 주세요.'
    return f'{r.status_code} {msg[:300]}'


def eleven_voices(key):
    """내 ElevenLabs 계정에 있는 목소리 목록 (복제한 내 목소리, 보이스 라이브러리에서 담은 목소리 포함)."""
    if not (key or '').strip():
        raise TTSError('ElevenLabs API 키를 먼저 넣어 주세요.')
    r = requests.get('https://api.elevenlabs.io/v1/voices', headers={'xi-api-key': key.strip()}, timeout=60)
    if r.status_code != 200:
        raise TTSError(f'목소리 목록을 받지 못했어요: {_eerr(r)}')
    ko, other = [], []
    for v in r.json().get('voices') or []:
        labels = v.get('labels') or {}
        if _is_korean_voice(v):
            ko_word = {'male': '남자', 'female': '여자', 'young': '젊은', 'middle_aged': '중년', 'middle aged': '중년', 'old': '나이 든'}
            bits = ['한국어'] + [ko_word.get(str(x).lower(), x) for x in (labels.get('gender'), labels.get('age')) if x]
            ko.append((v.get('voice_id'), f"{v.get('name')} ({', '.join(bits)})"))
            continue
        bits = [x for x in (labels.get('gender'), labels.get('accent'), labels.get('language'), v.get('category')) if x]
        other.append((v.get('voice_id'), f"{v.get('name')} ({', '.join(bits)})" if bits else v.get('name')))
    return ko + other  # 한국어 목소리를 맨 위에


def _is_korean_voice(v):
    """보이스 라이브러리에서 담은 한국어 목소리인지 (라벨의 언어, 억양, 설명으로 봐요)."""
    labels = {str(k).lower(): str(x).lower() for k, x in (v.get('labels') or {}).items()}
    if labels.get('language') in ('ko', 'kr', 'korean'):
        return True
    text = ' '.join([labels.get('accent', ''), labels.get('description', ''), str(v.get('description') or '').lower(), str(v.get('name') or '').lower()])
    return any(w in text for w in ('korean', 'seoul', 'busan', '한국'))


def _silence(text, out_wav, speed=1.0):
    secs = max(0.6, len(text) / (5.5 * float(speed or 1)))
    n = int(secs * SR)
    with wave.open(str(out_wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b'\x00\x00' * n)


# ------------------------------------------------------------ 바깥에서 쓰는 함수
def tts_text(text, s):
    """목소리로 읽을 글: 기호를 말로 바꾸고, Eleven v3 가 아니면 감정 표시를 지워요."""
    t = str(text or '')
    if is_expressive(s):
        keep = []

        def hold(m):
            keep.append(f'[{m.group(1).lower()}]')
            return f' TAG{len(keep) - 1}X '

        t = speakable(TAG_RE.sub(hold, t))
        for i, tag in enumerate(keep):
            t = t.replace(f'TAG{i}X', tag)
        return re.sub(r'\s{2,}', ' ', t).strip()
    return speakable(strip_tags(t))


def synth_info(text, s):
    """글 한 덩어리를 목소리로 만들어요. (wav 경로 24kHz 모노, 글자별 시간 또는 None)"""
    t = tts_text(text, s) or '.'
    folder = cache_dir() / 'tts'
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / f'{_cache_key(s, t)}.wav'
    side = out.with_suffix('.json')
    if out.exists() and out.stat().st_size > 44:
        al = None
        if side.exists():
            try:
                al = json.loads(side.read_text(encoding='utf-8'))
            except ValueError:
                al = None
        return out, al
    p = s.get('tts_provider') or 'edge'
    speed = float(s.get('speed') or 1.0)
    tmp = folder / f'{out.stem}.part'
    al = None
    try:
        if p == 'test':
            _silence(t, out, speed)
            return out, None
        if p == 'google':
            _google(t, s.get('google_key'), s.get('google_voice') or 'ko-KR-Chirp3-HD-Charon', speed, tmp)
            to_wav(tmp, out)
        elif p == 'gemini':
            rate = _gemini(t, s, tmp)
            to_wav(tmp, out, tempo=speed, raw_pcm_rate=rate)
        elif p == 'elevenlabs':
            al = _eleven(t, s, tmp)
            if abs(speed - 1.0) > 0.01:
                to_wav(tmp, out, tempo=speed)
                if al:
                    al['starts'] = [round(x / speed, 3) for x in al['starts']]
            else:
                os.replace(tmp, out)
        elif p == 'typecast':
            al = _typecast(t, s, tmp)
            to_wav(tmp, out, tempo=speed)  # 받은 wav 를 24kHz 모노로 맞춰요
            if al and abs(speed - 1.0) > 0.01:
                al['starts'] = [round(x / speed, 3) for x in al['starts']]
        else:
            _edge(t, s.get('edge_voice') or 'ko-KR-HyunsuMultilingualNeural', speed, tmp)
            to_wav(tmp, out)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    if al:
        al['text'] = t
        side.write_text(json.dumps(al, ensure_ascii=False), encoding='utf-8')
    return out, al


def synth(text, s):
    """문장 하나를 목소리로 만들어 캐시 경로(wav, 24kHz 모노)를 돌려줘요."""
    return synth_info(text, s)[0]


def trim_silence(src, dst):
    """앞뒤 조용한 부분을 잘라요 (이름 목소리용)."""
    run_ffmpeg(['-i', str(src), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse',
                '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', str(dst)])


def to_m4a(src, dst):
    run_ffmpeg(['-i', str(src), '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '1', '-movflags', '+faststart', str(dst)])


def sample_text(academy=''):
    """들어 보기 문장: 한국어 설명 사이에 영어 문장이 섞여서 목소리를 비교하기 좋아요."""
    name = academy or '우리 학원'
    return (f'안녕하세요, {name}입니다. 자, 두 번째 문장 보자. Bears, cougars, and other wild animals sometimes remind us of their formidable presence. '
            '여기서 동사는 remind야. remind A of B, A에게 B를 떠올리게 하다. 시험에 진짜 잘 나오니까 꼭 기억해!')
