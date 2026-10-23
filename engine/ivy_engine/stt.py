"""자동 자막: 선생님이 올린 강의 영상의 말소리를 글로 받아 적어요.

faster-whisper 를 이 PC에서 돌려서 돈이 들지 않아요. 처음 한 번은 받아쓰기 모델(1~2GB)을 내려받아요.
"""

import os
import re

from . import config


class STTError(Exception):
    pass


MODELS = [
    ('large-v3-turbo', '정확해요 (추천, 처음에 1.6GB 받아요)'),
    ('medium', '중간 (1.5GB)'),
    ('small', '빨라요, 덜 정확해요 (0.5GB)'),
]

_model = None
_model_name = None


def load_model(name, on_msg=None):
    global _model, _model_name
    if _model is not None and _model_name == name:
        return _model
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise STTError('자동 자막 프로그램(faster-whisper)이 아직 설치되지 않았어요. 엔진이 업데이트되면 저절로 설치돼요. 계속 안 되면 엔진 설치 파일을 다시 실행해 주세요.')
    if on_msg:
        on_msg('받아쓰기 모델 준비 중 (처음 한 번은 몇 분 걸려요)')
    threads = max(1, (os.cpu_count() or 4) - 1)
    last = None
    for device, ctype in (('auto', 'int8'), ('cpu', 'int8')):
        try:
            _model = WhisperModel(name, device=device, compute_type=ctype, download_root=str(config.model_dir()), cpu_threads=threads)
            _model_name = name
            return _model
        except Exception as e:  # 그래픽카드 쪽이 안 되면 CPU로
            last = e
    raise STTError(f'받아쓰기 모델을 불러오지 못했어요. 인터넷과 디스크 공간을 확인해 주세요. ({str(last)[:200]})')


def transcribe(path, name='large-v3-turbo', progress=None, on_msg=None, duration=None):
    """[{s, e, text, words: [[start, end, word], ...]}]"""
    model = load_model(name, on_msg)
    if on_msg:
        on_msg('말소리를 받아 적는 중')
    segments, info = model.transcribe(
        str(path),
        language='ko',
        vad_filter=True,
        beam_size=5,
        word_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt='영어 지문을 한국어로 설명하는 학원 영어 강의입니다. 영어 단어와 문장은 영어 철자로 적습니다.',
    )
    total = float(duration or getattr(info, 'duration', 0) or 1)
    out = []
    for seg in segments:
        text = (seg.text or '').strip()
        if text:
            words = [[round(w.start, 2), round(w.end, 2), w.word] for w in (seg.words or [])]
            out.append({'s': round(seg.start, 2), 'e': round(seg.end, 2), 'text': text, 'words': words})
        if progress:
            progress(min(1.0, seg.end / total))
    return out


def _ts(x):
    x = max(0.0, float(x))
    h = int(x // 3600)
    m = int(x % 3600 // 60)
    s = x % 60
    return f'{h:02d}:{m:02d}:{s:06.3f}'


def cues(segs, max_chars=38, max_secs=6.5):
    """자막 한 장면씩: 너무 긴 말은 단어 시간에 맞춰 나눠요."""
    out = []
    for sg in segs:
        words = sg.get('words') or []
        if not words or len(sg['text']) <= max_chars:
            out.append((sg['s'], sg['e'], sg['text']))
            continue
        cur, start = '', None
        for ws, we, w in words:
            piece = w if cur else w.lstrip()
            if start is None:
                start = ws
            if cur and (len(cur) + len(piece) > max_chars or we - start > max_secs):
                out.append((start, prev_end, cur.strip()))
                cur, start, piece = '', ws, w.lstrip()
            cur += piece
            prev_end = we
            if re.search(r'[.?!]$', w.strip()) and len(cur) > max_chars * 0.5:
                out.append((start, we, cur.strip()))
                cur, start = '', None
        if cur.strip():
            out.append((start, prev_end, cur.strip()))
    return [(a, max(b, a + 0.4), t) for a, b, t in out if t]


def to_vtt(segs):
    lines = ['WEBVTT', '']
    for a, b, t in cues(segs):
        lines += [f'{_ts(a)} --> {_ts(b)}', t, '']
    return '\n'.join(lines)
