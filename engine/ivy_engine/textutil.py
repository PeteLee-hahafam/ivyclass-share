"""글 다듬기: 문장 나누기, 판서 표시 위치 찾기, 읽기 좋은 대본 만들기."""

import difflib
import re

ABBR = {
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'u.s', 'u.k', 'no', 'fig', 'ca',
    'approx', 'dept', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
    'oct', 'nov', 'dec', 'mt', 'ft', 'vol', 'p', 'pp', 'a.m', 'p.m', 'cf', 'al',
}


def clean(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip()


def split_sentences(text):
    """영어 지문을 문장으로 나눠요. 약어(Mr., U.S. 등)와 이니셜에서는 자르지 않아요."""
    t = clean(text)
    if not t:
        return []
    out, start = [], 0
    for m in re.finditer(r'[.!?]+["”’)\]]*\s+(?=["“‘(\[]?[A-Z0-9])', t):
        piece = t[start:m.end()].strip()
        before = t[start:m.start() + 1]
        if t[m.start()] == '.':
            w = re.search(r'([A-Za-z][A-Za-z.]*)\.$', before)
            if w and w.group(1).lower().rstrip('.') in ABBR:
                continue
            if re.search(r'(?:^|\s)[A-Z]\.$', before):
                continue
        out.append(piece)
        start = m.end()
    rest = t[start:].strip()
    if rest:
        out.append(rest)
    return out


_SMALL = {'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'nor', 'with', 'by', 'from', 'as', 'vs', 'into', 'about', 'than', 'via'}


def _title_like(line):
    """소제목처럼 생긴 줄: 12단어 이하, 마침표·쉼표로 끝나지 않고, 첫 글자가 대문자·숫자이며, 내용어 대부분이 대문자로 시작해요."""
    t = clean(line)
    words = t.split()
    if not words or len(words) > 12 or not re.search(r'[A-Za-z]', t) or t[-1] in '.,;':
        return False
    if not re.match(r'["“‘(\[]?[A-Z0-9]', t):
        return False
    content = [re.sub(r'[^A-Za-z]', '', w) for w in words]
    content = [w for w in content if w and w.lower() not in _SMALL]
    if not content:
        return False
    caps = sum(1 for w in content if w[0].isupper())
    if t[-1] in '?!':
        return len(content) >= 2 and caps == len(content)
    return caps / len(content) >= 0.7


def noise_line(line):
    """지문이 아닌 줄인지: 쪽·줄 번호만 있는 줄, * 로 시작하는 어휘 풀이, Q1. 같은 문제, 한글이 많은 줄. 이유 또는 ''"""
    s = clean(line)
    if not s:
        return ''
    if re.fullmatch(r'[-–—(\[]?\s*(?:p\.?|pp\.?|page)?\s*\d{1,4}\s*[-–—)\]]?', s, re.I):
        return '쪽·줄 번호'
    if s[0] in '*※':
        return '어휘 풀이'
    if re.match(r'(?:Q|Question)\s*\d+\s*[.):]', s, re.I):
        return '문제'
    han = len(re.findall(r'[가-힣]', s))
    if han and han >= len(re.findall(r'[A-Za-z]', s)) * 0.5:
        return '한글'
    return ''


def split_passage(text, dropped=None):
    """지문을 문장으로 나누고, 따로 한 줄에 있는 소제목은 문장에서 떼어 그 뒤 첫 문장에 붙여요. [(소제목, 문장), ...]
    '## '로 시작하는 줄은 소제목, 쪽 번호·어휘 풀이·한글 줄은 빼요(dropped 목록에 넣어요).
    문장에 붙어 버린 소제목(줄바꿈·띄어쓰기 없이 이어진 것)은 Claude가 찾아 알려 줘요 (scriptgen)."""
    raw = str(text or '').replace('\r\n', '\n').replace('\r', '\n')
    lines = [clean(x) for x in raw.split('\n')]
    keep = []
    for x in lines:
        why = noise_line(x) if not x.startswith('#') else ''
        if why:
            if dropped is not None:
                dropped.append({'text': x[:160], 'why': why})
            continue
        keep.append(x)
    lines = keep
    blocks, head, buf = [], '', []
    for i, line in enumerate(lines):
        if not line:
            continue
        before = clean(' '.join(buf))
        # '## 소제목': 선생님(새 강의 화면의 자료 정리)이 소제목이라고 표시한 줄
        if line.startswith('#'):
            h = clean(line.lstrip('#'))
            if h:
                if before:
                    blocks.append((head, before))
                    head = h
                else:
                    head = f'{head} · {h}' if head else h
                buf = []
            continue
        nxt = next((x for x in lines[i + 1:] if x), '')
        done = not before or re.search(r'[.!?]["”’)\]]*$', before)
        if nxt and done and re.match(r'["“‘(\[]?[A-Z0-9]', nxt) and _title_like(line):
            if before:
                blocks.append((head, before))
                head = line
            else:
                head = f'{head} · {line}' if head else line
            buf = []
            continue
        buf.append(line)
    blocks.append((head, clean(' '.join(buf))))
    out = []
    for h, body in blocks:
        sents = split_sentences(body)
        if not sents:
            if h:
                out.append(('', h))  # 소제목만 남으면 문장으로 둬요
            continue
        out.append((h, sents[0]))
        out.extend(('', x) for x in sents[1:])
    return out


def strip_heading(sentence, heading):
    """문장 맨 앞에 붙은 소제목을 떼어요 (띄어쓰기 없이 붙어 있어도). 떼면 (소제목, 나머지 문장), 아니면 None."""
    h = clean(heading)
    s = clean(sentence)
    if not h or not s or len(h.split()) > 15 or h[-1] in '.,;':
        return None
    norm = lambda x: re.sub(r'[’‘`]', "'", x).replace('“', '"').replace('”', '"').lower()
    if not norm(s).startswith(norm(h)):
        return None
    rest = s[len(h):].lstrip(' :-–—·')
    if len(rest.split()) < 3 or not re.match(r'["“‘(\[]?[A-Z0-9]', rest):
        return None
    return s[:len(h)].strip(), rest


def split_korean(text):
    t = clean(text)
    if not t:
        return []
    parts = re.split(r'(?<=[.!?。])\s+', t)
    return [p.strip() for p in parts if p.strip()]


# ------------------------------------------------------------ 판서 표시 위치 (board.js resolveRange 와 같은 규칙)
def _is_word(c):
    return bool(c) and bool(re.match(r'[A-Za-z0-9가-힣]', c))


def _norm_q(x):
    return re.sub(r'[’‘`]', "'", x).replace('“', '"').replace('”', '"').lower()


def _find_all(hay, needle):
    out, i = [], hay.find(needle)
    while needle and i >= 0:
        out.append(i)
        i = hay.find(needle, i + 1)
    return out


def resolve_range(text, needle, occ=1):
    n = clean(needle)
    if not n:
        return None
    pos = _find_all(text, n) or _find_all(_norm_q(text), _norm_q(n))
    if not pos:
        n2 = re.sub(r'^[\s,.;:!?"\'()]+|[\s,.;:!?"\'()]+$', '', n)
        if n2 and n2 != n:
            n = n2
            pos = _find_all(_norm_q(text), _norm_q(n))
    if not pos:
        return None

    def whole(i):
        a = not (_is_word(n[0]) and _is_word(text[i - 1] if i > 0 else ''))
        j = i + len(n)
        b = not (_is_word(n[-1]) and _is_word(text[j] if j < len(text) else ''))
        return a and b

    good = [i for i in pos if whole(i)] or pos
    k = min(len(good), max(1, int(occ or 1))) - 1
    return good[k], good[k] + len(n)


def snap_words(text, rng):
    """단어 중간에서 끝나는 표시는 단어 끝까지 넓혀요 (instance → instances)."""
    a, b = rng
    while a > 0 and re.match(r"[A-Za-z0-9'’-]", text[a - 1]) and re.match(r"[A-Za-z0-9'’-]", text[a]):
        a -= 1
    while b < len(text) and re.match(r"[A-Za-z0-9'’-]", text[b]) and b > 0 and re.match(r"[A-Za-z0-9'’-]", text[b - 1]):
        b += 1
    return a, b


def fuzzy_fix(text, needle, min_ratio=0.8):
    """표시할 말이 문장에 똑같이 없으면 가장 비슷한 부분을 찾아요. 못 찾으면 None."""
    n = clean(needle)
    if not n:
        return None
    words = [(m.start(), m.end()) for m in re.finditer(r'\S+', text)]
    k = len(n.split())
    best, best_r = None, 0.0
    for size in {max(1, k - 1), k, k + 1}:
        for i in range(0, max(0, len(words) - size) + 1):
            s, e = words[i][0], words[i + size - 1][1]
            cand = text[s:e]
            r = difflib.SequenceMatcher(None, _norm_q(cand), _norm_q(n)).ratio()
            if r > best_r:
                best, best_r = cand, r
    if best and best_r >= min_ratio:
        return re.sub(r'^[\s,.;:!?"\'()]+|[\s,.;:!?"\'()]+$', '', best) or best
    return None


# ------------------------------------------------------------ 소리 내어 읽을 대본
CIRCLED = {c: f'{i + 1}번' for i, c in enumerate('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮')}


def speakable(text):
    """TTS가 이상하게 읽을 기호를 정리해요."""
    t = str(text or '')
    for c, w in CIRCLED.items():
        t = t.replace(c, w)
    t = re.sub(r'[✕✗×❌]', '', t)
    t = t.replace('→', ', ').replace('⇒', ', ').replace('↔', ', ').replace('≈', ', ')
    t = t.replace('~', ' ').replace('=', ' ').replace('·', ', ').replace('/', ', ')
    t = t.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
    t = re.sub(r'[\[\]{}<>]', ' ', t)
    t = re.sub(r'\(\s*', ', ', t)
    t = re.sub(r'\s*\)', ', ', t)
    t = re.sub(r'\s*,\s*(,\s*)+', ', ', t)
    t = re.sub(r'\s+([,.!?])', r'\1', t)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^,\s*', '', t)
    return t


def speech_units(say, max_len=260):
    """대본을 소리 단위(문장)로 나눠요. 너무 긴 문장은 쉼표에서 나눠요."""
    t = clean(say)
    if not t:
        return []
    parts = re.findall(r'[^.!?…]+[.!?…]*["\')\]]*\s*', t) or [t]
    out = []
    for p in parts:
        p = p.strip()
        while len(p) > max_len:
            cut = p.rfind(', ', 0, max_len)
            if cut < max_len * 0.4:
                cut = p.rfind(' ', 0, max_len)
            if cut <= 0:
                cut = max_len
            out.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            out.append(p)
    return out


def caption_chunks(text, max_len=46):
    """자막 한 줄 길이로 나눠요 (board.js captionChunks 와 같은 규칙)."""
    t = clean(text)
    if not t:
        return []
    parts = re.findall(r'[^.!?。…]+[.!?。…]*["\')\]]*\s*', t) or [t]
    out = []
    for p in parts:
        p = p.strip()
        while len(p) > max_len:
            cut = -1
            for sep in (', ', ' - ', ' '):
                i = p.rfind(sep, 0, max_len)
                if i > max_len * 0.45:
                    cut = i + len(sep.rstrip())
                    break
            if cut < 0:
                cut = max_len
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out


# ------------------------------------------------------------ 이름 부르기 자리 ({호명})
SLOT_RE = re.compile(r'\{\s*호명\s*\}(?:아|야)?')


def split_slots(say, enabled=True):
    """'자, {호명}! 여기 봐.' → ['자,', None, '여기 봐.']  (None 은 이름을 부를 자리)
    enabled=False 이면 이름 자리를 빼고 이어 붙여요."""
    t = clean(say)
    pieces = []
    pos = 0
    for m in SLOT_RE.finditer(t):
        pieces.append(t[pos:m.start()])
        pieces.append(None)
        pos = m.end()
    pieces.append(t[pos:])
    out = []
    for i, p in enumerate(pieces):
        if p is None:
            if enabled and (not out or out[-1] is not None):
                out.append(None)
            continue
        if i > 0 and pieces[i - 1] is None:
            p = re.sub(r'^\s*[,!.?~]+\s*', '', p)
        p = p.strip()
        if p:
            out.append(p)
    if not enabled:
        return [clean(' '.join(out))] if out else []
    return out


def strip_slots(say):
    return clean(' '.join(x for x in split_slots(say, enabled=False)))


# ------------------------------------------------------------ 말한 글자 위치 → 시간
_W_SPACE, _W_COMMA, _W_STOP = 0.6, 3.5, 6.0


def time_map(text, dur, align=None, lead=0.06, tail=0.12):
    """글 안의 글자 위치(0~len)를 그 글자를 말하는 시각(초)으로 바꾸는 함수를 돌려줘요.
    ElevenLabs 처럼 글자별 시간이 있으면 그걸 쓰고, 없으면 쉼표·마침표 쉼을 셈해서 나눠요."""
    n = len(text)
    if align and align.get('starts') and (align.get('text') or align.get('chars')):
        spoken = align.get('text') or align.get('chars')
        starts = align['starts']
        if len(spoken) != len(starts):
            spoken = align.get('chars') or spoken
        m = len(starts)
        if m and len(spoken) == m:
            sm = difflib.SequenceMatcher(None, text.lower(), spoken.lower(), autojunk=False)
            blocks = [b for b in sm.get_matching_blocks() if b.size]

            def to_spoken(p):
                prev = None
                for b in blocks:
                    if b.a <= p < b.a + b.size:
                        return b.b + (p - b.a)
                    if b.a > p:
                        if prev is None:
                            return int(round(b.b * (p / max(1, b.a))))
                        pa, pb = prev.a + prev.size, prev.b + prev.size
                        span_a = max(1, b.a - pa)
                        return int(round(pb + (b.b - pb) * (p - pa) / span_a))
                    prev = b
                if prev is None:
                    return int(round(p / max(1, n) * (m - 1)))
                pa, pb = prev.a + prev.size, prev.b + prev.size
                return int(round(pb + (m - 1 - pb) * (p - pa) / max(1, n - pa)))

            def f(p):
                j = max(0, min(m - 1, to_spoken(max(0, min(n, p)))))
                return max(0.0, min(dur, float(starts[j])))

            return f
    w = []
    for ch in text:
        if ch.isspace():
            w.append(_W_SPACE)
        elif ch in ',;:':
            w.append(_W_COMMA)
        elif ch in '.!?…':
            w.append(_W_STOP)
        elif ch.isalnum():
            w.append(1.0)
        else:
            w.append(0.4)
    cum = [0.0]
    for x in w:
        cum.append(cum[-1] + x)
    total = cum[-1] or 1.0
    body = max(0.05, dur - lead - tail)

    def g(p):
        p = max(0, min(n, int(p)))
        return lead + body * cum[p] / total

    return g


# ---------------------------------------------------------------- 강의 학년
# 사이트가 학년 키(mid1 …)나 학년 이름(중학교 1학년)을 보내요. 둘 다 알아들어요.
LEVELS = {'mid1': '중학교 1학년', 'mid2': '중학교 2학년', 'mid3': '중학교 3학년', 'high1': '고등학교 1학년', 'high2': '고등학교 2학년', 'high3': '고등학교 3학년(수능 대비)'}


def level_text(opts, default='고등학교 1학년'):
    v = str((opts or {}).get('level') or '').strip()
    return LEVELS.get(v, v or default)


def level_guide(opts):
    """확인 문제와 문제 은행에 줄 학년 안내 (학년을 모르면 빈 글)"""
    t = level_text(opts, '')
    if not t:
        return ''
    g = f'[학생 학년] {t}. 이 학년 학교 시험에 나오는 수준과 말투로 낸다.'
    if t.startswith('중학교'):
        g += (' 중학생이니 발문, 보기, 해설은 짧고 쉬운 우리말로 쓰고, 문법 용어는 교과서에 나오는 말만 쓴다.'
              ' 보기의 영어 낱말과 표현도 이 학년이 아는 수준으로 하고, 수능형 고난도 추론 문제는 내지 않는다.')
    return g
