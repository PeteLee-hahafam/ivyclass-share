"""강의 영상, 썸네일, 판서노트·연습지 PDF 만들기.

강의실 사이트의 판서 화면(/board)을 브라우저로 열어 장면마다 찍고, 목소리와 합쳐 MP4로 만들어요.
"""

import math
import re
import subprocess
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import tts
from .textutil import caption_chunks, speech_units, split_slots, time_map

FPS = 30
PAN = 0.9  # 화면 옮기는(확대·이동) 시간
SPOT = 0.45  # 같은 화면에서 집중 문장만 바뀔 때
LEAD = 0.35  # 단계 시작 뒤 말하기 전 쉼
GAP = 0.22  # 문장 사이 쉼
TAIL = 0.5  # 단계 끝 쉼
SLOT = 1.2  # 학생 이름을 부를 자리 길이
ANIM_FPS = 24
PAN_FPS = 24


class MediaError(Exception):
    pass


def _ease(x):
    return 4 * x * x * x if x < 0.5 else 1 - pow(-2 * x + 2, 3) / 2


# ------------------------------------------------------------ 브라우저
def launch_browser(pw, settings):
    choice = (settings.get('browser') or 'auto').lower()
    tries = []
    if choice in ('auto', 'msedge'):
        tries.append({'channel': 'msedge'})
    if choice in ('auto', 'chrome'):
        tries.append({'channel': 'chrome'})
    tries.append({})
    last = None
    for kw in tries:
        try:
            return pw.chromium.launch(headless=True, args=['--force-color-profile=srgb', '--font-render-hinting=none'], **kw)
        except Exception as e:  # 다음 브라우저로
            last = e
    raise MediaError(f'브라우저(Edge 또는 Chrome)를 열지 못했어요. Microsoft Edge가 설치되어 있는지 확인해 주세요. ({str(last)[:200]})')


def open_board(browser, origin, script, opts, mode='render', width=1920, height=1080):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1, locale='ko-KR')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(origin.rstrip('/') + '/board', wait_until='load', timeout=90000)
    page.wait_for_function('window.IvyBoardReady === true', timeout=90000)
    page.evaluate('(c) => { document.body.className = c; document.documentElement.className = c; }', 'render' if mode == 'render' else 'print')
    info = page.evaluate(
        """async ({script, opts}) => {
            window.bd = IvyBoard.mountBoard(document.getElementById('host'), script, opts);
            await window.bd.ready;
            const order = bd.steps.map((_, i) => bd.revealOrder(i));
            const durs = {};
            for (const ids of order) for (const id of ids) durs[id] = bd.revealDur(id);
            return {
              problems: bd.problems,
              n: bd.steps.length,
              order,
              durs,
              cams: bd.steps.map((_, i) => bd.camFor(i)),
            };
        }""",
        {'script': script, 'opts': {**opts, 'mode': 'render' if mode == 'render' else 'print'}},
    )
    if errors:
        raise MediaError(f'판서 화면에서 오류가 났어요: {errors[0][:300]}')
    return ctx, page, info


# ------------------------------------------------------------ 1) 목소리
def unit_mode(settings):
    """목소리를 만드는 단위: 단계 통째로(자연스러운 흐름) 또는 문장마다."""
    m = settings.get('tts_unit') or 'auto'
    if m in ('step', 'sentence'):
        return m
    return 'step' if settings.get('tts_provider') in ('elevenlabs', 'gemini', 'typecast') else 'sentence'


def _chunks(text, max_len):
    out, cur = [], ''
    for s in speech_units(text, max_len=max_len):
        if cur and len(cur) + 1 + len(s) > max_len:
            out.append(cur)
            cur = s
        else:
            cur = f'{cur} {s}'.strip()
    if cur:
        out.append(cur)
    return out


def build_audio(script, settings, progress=None, workers=4, call_names=True):
    """단계마다 목소리를 만들어요. [[{text, wav, dur, align} | {slot, dur}], ...], 이름 자리 대신 쓸 말(wav 또는 None)"""
    mode = unit_mode(settings)
    max_len = 900 if settings.get('tts_provider') in ('elevenlabs', 'typecast') else 650
    plan, jobs = [], []
    for st in script['steps']:
        units = []
        for part in split_slots(st.get('say', ''), enabled=call_names):
            if part is None:
                units.append({'slot': True, 'dur': SLOT})
                continue
            for tx in (_chunks(part, max_len) if mode == 'step' else speech_units(part)):
                u = {'text': tx}
                units.append(u)
                jobs.append(u)
        plan.append(units)
    if not jobs:
        raise MediaError('읽을 대본이 없어요.')
    has_slot = any(u.get('slot') for units in plan for u in units)
    done = [0]
    total = len(jobs) + (1 if has_slot else 0)

    def work(u):
        u['wav'], u['align'] = tts.synth_info(u['text'], settings)
        u['dur'] = tts.wav_seconds(u['wav'])
        done[0] += 1
        if progress:
            progress(done[0] / total)
        return u

    p = settings.get('tts_provider')
    n = 1 if p == 'gemini' else 2 if p in ('elevenlabs', 'typecast') else workers
    with ThreadPoolExecutor(max_workers=n) as ex:
        list(ex.map(work, jobs))
    generic = None
    if has_slot:
        # 이름을 모르는 사람이 볼 때는 '여러분'이라고 불러요 (학생 앱에서는 이 자리에 학생 이름이 들려요)
        word = (settings.get('name_generic') or '여러분').strip()
        if word:
            try:
                raw = tts.synth(f'{word},', settings)
                generic = raw.with_name(raw.stem + '-trim.wav')
                if not generic.exists():
                    tts.trim_silence(raw, generic)
                if tts.wav_seconds(generic) > SLOT - 0.2:
                    generic = None
            except Exception:
                generic = None
    return plan, generic


# ------------------------------------------------------------ 2) 시간표
def _anchor_of(script):
    """표시 id → 대본에서 찾을 말."""
    out = {}
    for s in script.get('sentences', []):
        for m in s.get('marks', []):
            t = m.get('text') or ''
            if m.get('on') == 'ko':
                out[m['id']] = t
            else:
                words = t.split()
                out[m['id']] = ' '.join(words[:3]) if len(words) > 3 else t
    for x in script.get('vocab', []):
        out[x['id']] = x.get('en', '')
    for x in script.get('summary', []):
        out[x['id']] = x.get('k', '')
    for x in script.get('memo', []):
        out[x['id']] = re.sub(r'^[①-⑩0-9.\s]+', '', x.get('text', ''))[:4]
    for x in script.get('flow', []):
        out[x['id']] = x.get('k', '')
    return out


def _same_cam(a, b):
    return abs(a['cx'] - b['cx']) < 2 and abs(a['cy'] - b['cy']) < 2 and abs(a['z'] - b['z']) < 0.01


def build_timeline(script, audio, cams, orders, durs=None, captions=True, generic=None):
    anchors = _anchor_of(script)
    durs = durs or {}
    t = 0.0
    segs = []  # ('sil', secs) | ('wav', path, secs)
    pans, caps, revs, slots, starts = [], [(0.0, '')], [], [], []
    default = {'cx': 960, 'cy': 540, 'z': 1, 'f': 0}
    prev = dict(cams[0]) if cams else default
    gdur = tts.wav_seconds(generic) if generic else 0
    for i, units in enumerate(audio):
        starts.append(round(t, 2))
        cam = dict(cams[i]) if i < len(cams) else prev
        if not _same_cam(cam, prev):
            pans.append((t, t + PAN, prev, cam))
            segs.append(('sil', PAN))
            t += PAN
        elif cam.get('f', 0) != prev.get('f', 0):
            pans.append((t, t + SPOT, prev, cam))
            segs.append(('sil', SPOT))
            t += SPOT
        elif i > 0:
            segs.append(('sil', 0.25))
            t += 0.25
        segs.append(('sil', LEAD))
        t += LEAD
        spoken = []  # (시작, 길이, 글, 시간 함수)
        for u in units:
            if u.get('slot'):
                slots.append({'t': round(t, 2), 'd': SLOT})
                if generic:
                    pre = (SLOT - gdur) / 2
                    segs += [('sil', pre), ('wav', generic, gdur), ('sil', SLOT - pre - gdur)]
                else:
                    segs.append(('sil', SLOT))
                t += SLOT
                continue
            text = tts.strip_tags(u['text'])
            tm = time_map(text, u['dur'], u.get('align'))
            spoken.append((t, u['dur'], text, tm))
            if captions:
                pos = 0
                for c in caption_chunks(text):
                    k = text.find(c, pos)
                    k = pos if k < 0 else k
                    caps.append((t + tm(k), c))
                    pos = k + len(c)
            segs.append(('wav', u['wav'], u['dur']))
            t += u['dur']
            segs.append(('sil', GAP))
            t += GAP
        speech_start = spoken[0][0] if spoken else t
        speech_end = t
        # 표시는 선생님이 그 말을 할 때 그려요. 순서는 대본의 show 순서를 지키고,
        # 대본에서 말을 못 찾은 표시는 앞뒤 표시 사이에 고르게 끼워 넣어요.
        ids = orders[i] if i < len(orders) else []
        hits = []
        for rid in ids:
            if rid.startswith('ko-'):  # 해석 줄은 그 문장 설명을 시작할 때 나타나요
                hits.append(speech_start)
                continue
            a = (anchors.get(rid) or '').strip().lower()
            hit = None
            if len(a) >= 2:
                for st0, d0, text, tm in spoken:
                    p = text.lower().find(a)
                    if p >= 0:
                        hit = st0 + tm(p) - 0.05
                        break
            hits.append(hit)
        end_at = speech_start + max(0.5, (speech_end - speech_start) * 0.85)
        known = [k for k, h in enumerate(hits) if h is not None]
        if not known:
            hits = [speech_start + (end_at - speech_start) * (k + 0.5) / max(1, len(ids)) for k in range(len(ids))]
        else:
            filled = list(hits)
            bounds = [(-1, speech_start)] + [(k, hits[k]) for k in known] + [(len(ids), end_at)]
            for (ka, ta), (kb, tb) in zip(bounds, bounds[1:]):
                gap = kb - ka
                for j in range(ka + 1, kb):
                    filled[j] = ta + (max(tb, ta) - ta) * (j - ka) / gap
            hits = filled
        last, last_d = -9.0, 0.0
        for rid, tt in zip(ids, hits):
            d = float(durs.get(rid) or 0.45)
            tt = max(tt, last + min(0.6, last_d * 0.75), speech_start)
            tt = min(tt, max(speech_start, speech_end - d))
            revs.append((tt, rid, d))
            last, last_d = tt, d
        if captions:
            caps.append((t, ''))
        segs.append(('sil', TAIL))
        t += TAIL
        prev = cam
    caps.sort(key=lambda x: x[0])
    return {'total': t, 'segs': segs, 'pans': pans, 'caps': caps, 'revs': revs, 'slots': slots, 'starts': starts, 'cam0': dict(cams[0]) if cams else default}


CHAPTER_LABEL = {'intro': '인사', 'summary': '내용 정리', 'flow': '글의 흐름', 'memo': '메모', 'vocab': '핵심 단어', 'review': '마무리'}


def chapters_of(script, starts):
    """단계 시작 시간으로 목차를 만들어요. 같은 문장을 설명하는 단계는 하나로 묶어요."""
    out = []
    for st, t in zip(script.get('steps') or [], starts or []):
        view = st.get('view') or 'sentence'
        title = f"{st.get('n')}번 문장" if view == 'sentence' and st.get('n') else CHAPTER_LABEL.get(view, '설명')
        if out and out[-1]['title'] == title:
            continue
        out.append({'t': max(0.0, round(float(t), 1)), 'title': title})
    if out:
        out[0]['t'] = 0.0
    return out[:60]


def write_audio(segs, path):
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(tts.SR)
        for s in segs:
            if s[0] == 'sil':
                out.writeframes(b'\x00\x00' * int(round(s[1] * tts.SR)))
            else:
                with wave.open(str(s[1]), 'rb') as w:
                    out.writeframes(w.readframes(w.getnframes()))


# ------------------------------------------------------------ 3) 장면 찍기
def _times(tl):
    pts = {0.0, tl['total']}
    for a, b, _, _ in tl['pans']:
        k = max(2, int(math.ceil((b - a) * PAN_FPS)))
        pts.update(a + (b - a) * j / k for j in range(k + 1))
    for c in tl['caps']:
        pts.add(c[0])
    for a, _, d in tl['revs']:
        k = max(2, int(math.ceil(d * ANIM_FPS)))
        pts.update(a + d * j / k for j in range(k + 1))
    return sorted(p for p in pts if 0 <= p <= tl['total'])


def _lerp_cam(a, b, e):
    return {k: a[k] + (b[k] - a[k]) * e for k in ('cx', 'cy', 'z')}


def _state_at(tl, t):
    cam = tl['cam0']
    spot = (cam.get('f', 0), cam.get('f', 0), 1.0)
    for a, b, c0, c1 in tl['pans']:
        if t >= b:
            cam, spot = c1, (c1.get('f', 0), c1.get('f', 0), 1.0)
        elif t >= a:
            e = _ease((t - a) / (b - a))
            cam, spot = _lerp_cam(c0, c1, e), (c0.get('f', 0), c1.get('f', 0), round(e, 3))
            break
        else:
            break
    cam = {'cx': round(cam['cx'], 1), 'cy': round(cam['cy'], 1), 'z': round(cam['z'], 4)}
    cap = ''
    for ct, c in tl['caps']:
        if ct <= t + 1e-6:
            cap = c
        else:
            break
    revs = {}
    for a, rid, d in tl['revs']:
        if a <= t + 1e-6:
            revs[rid] = min(1.0, (t - a) / d)
    return cam, spot, cap, revs


def render_frames(page, tl, frames_dir, progress=None, quality=90):
    frames_dir.mkdir(parents=True, exist_ok=True)
    page.evaluate('(c) => { bd.resetTo(0); bd.setCamera(c); bd.setSpot(c.f || 0, c.f || 0, 1); bd.setCaption(""); bd.syncPen(); }', tl['cam0'])
    times = _times(tl)
    frames = []
    shown = {'cam': None, 'spot': None, 'cap': None, 'revs': {}}
    started = time.time()
    for idx in range(len(times) - 1):
        ta, tb = times[idx], times[idx + 1]
        if tb - ta < 1e-4:
            continue
        cam, spot, cap, revs = _state_at(tl, ta + 1e-6)
        ops = {}
        if cam != shown['cam']:
            ops['cam'] = cam
        if spot != shown['spot']:
            ops['spot'] = spot
        if cap != shown['cap']:
            ops['cap'] = cap
        changed = {k: round(v, 3) for k, v in revs.items() if round(shown['revs'].get(k, -1), 3) != round(v, 3)}
        if changed:
            ops['revs'] = changed
        if ops or not frames:
            page.evaluate(
                """(o) => {
                    if (o.cam) bd.setCamera(o.cam);
                    if (o.spot) bd.setSpot(o.spot[0], o.spot[1], o.spot[2]);
                    if (o.cap !== undefined) bd.setCaption(o.cap);
                    if (o.revs) for (const [id, t] of Object.entries(o.revs)) bd.setReveal(id, t);
                    bd.syncPen();
                }""",
                ops,
            )
            p = frames_dir / f'f{len(frames):05d}.jpg'
            p.write_bytes(page.screenshot(type='jpeg', quality=quality))
            frames.append([p, tb - ta])
            shown['cam'] = cam
            shown['spot'] = spot
            shown['cap'] = cap
            shown['revs'].update(revs)
        else:
            frames[-1][1] += tb - ta
        if progress and idx % 15 == 0:
            progress(idx / max(1, len(times) - 1))
    return frames, time.time() - started


def encode_video(frames, audio_wav, out_mp4, total, progress=None):
    lst = Path(out_mp4).with_suffix('.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        f.write('ffconcat version 1.0\n')
        for p, d in frames:
            f.write(f"file '{Path(p).as_posix()}'\nduration {d:.4f}\n")
        f.write(f"file '{Path(frames[-1][0]).as_posix()}'\n")
    args = [
        tts.ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats',
        '-f', 'concat', '-safe', '0', '-i', str(lst), '-i', str(audio_wav),
        '-vf', f'fps={FPS},format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-tune', 'stillimage',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', '-shortest', str(out_mp4),
    ]
    flags = 0x08000000 if __import__('os').name == 'nt' else 0
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags, text=True, encoding='utf-8', errors='replace')
    for line in p.stdout:
        if line.startswith('out_time_ms=') and progress:
            try:
                progress(min(1.0, int(line.split('=')[1]) / 1e6 / max(1.0, total)))
            except ValueError:
                pass
    err = p.stderr.read()
    if p.wait() != 0:
        raise MediaError(f'영상 합치기(ffmpeg)에 실패했어요: {err[-400:]}')
    return out_mp4


def make_thumb(page, script, out_jpg):
    steps = script.get('steps', [])
    first = next((i for i, s in enumerate(steps) if s.get('view') == 'sentence'), 0)
    page.evaluate('(i) => { bd.resetTo(i, "including"); bd.setScroll(0); bd.setSpot(0, 0, 1); bd.setCaption(""); bd.syncPen(); }', first)
    big = Path(out_jpg).with_name('thumb-big.jpg')
    big.write_bytes(page.screenshot(type='jpeg', quality=92))
    tts.run_ffmpeg(['-i', str(big), '-vf', 'scale=960:540:flags=lanczos', '-q:v', '3', str(out_jpg)])
    return out_jpg


def make_note_pdf(browser, origin, script, opts, out_pdf):
    ctx, page, _ = open_board(browser, origin, script, {**opts, 'logo': None}, mode='print', width=1700, height=1200)
    try:
        page.pdf(path=str(out_pdf), format='A4', print_background=True, scale=0.44,
                 margin={'top': '12mm', 'bottom': '12mm', 'left': '8mm', 'right': '8mm'})
    finally:
        ctx.close()
    return out_pdf


def make_practice_pdf(browser, origin, script, opts, out_pdf):
    ctx = browser.new_context(viewport={'width': 900, 'height': 1200}, locale='ko-KR')
    page = ctx.new_page()
    try:
        page.goto(origin.rstrip('/') + '/board', wait_until='load', timeout=90000)
        page.wait_for_function('window.IvyBoardReady === true', timeout=90000)
        page.evaluate('() => { document.body.className = "print"; document.documentElement.className = "print"; }')
        page.evaluate("async ({script, opts}) => { await IvyBoard.renderPractice(document.getElementById('host'), script, opts); }", {'script': script, 'opts': opts})
        page.pdf(path=str(out_pdf), format='A4', print_background=True, margin={'top': '14mm', 'bottom': '14mm', 'left': '13mm', 'right': '13mm'})
    finally:
        ctx.close()
    return out_pdf


def make_study_pdf(browser, origin, data, opts, out_pdf):
    """선생님이 올린 강의의 AI 요약으로 복습 노트 PDF를 만들어요."""
    ctx = browser.new_context(viewport={'width': 900, 'height': 1200}, locale='ko-KR')
    page = ctx.new_page()
    try:
        page.goto(origin.rstrip('/') + '/board', wait_until='load', timeout=90000)
        page.wait_for_function('window.IvyBoardReady === true', timeout=90000)
        page.evaluate('() => { document.body.className = "print"; document.documentElement.className = "print"; }')
        page.evaluate("async ({data, opts}) => { await IvyBoard.renderStudy(document.getElementById('host'), data, opts); }", {'data': data, 'opts': opts})
        page.pdf(path=str(out_pdf), format='A4', print_background=True, margin={'top': '14mm', 'bottom': '14mm', 'left': '13mm', 'right': '13mm'})
    finally:
        ctx.close()
    return out_pdf
