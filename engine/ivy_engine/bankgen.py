"""문제 은행: 지문 하나로 내신 변형 문제(객관식)와 서술형을 만들어 쌓아요.

사이트는 이 은행에서 모의고사(풀 때마다 10문항씩 새로 뽑아요), 사이트 숙제, 출력용 숙제지를 꺼내 써요.
선생님이 문제 자료(기출이나 직접 만든 문제: 붙여 넣은 글, PDF, 사진)를 넣어 두면 그 유형과 말투를 본보기로 만들어요.
만든 뒤에는 확인 문제처럼 정답을 가리고 다시 풀어 보는 검사로 억지 문제와 답이 애매한 문제를 빼요.
"""

import base64
import json
import re

from . import claude
from .textutil import level_guide
from .quizgen import _errors, _ordered, balance, CIRC
from .scriptgen import ScriptError

TYPES = ['topic', 'title', 'gist', 'detail', 'translate', 'vocab', 'grammar', 'refer', 'blank', 'order', 'insert', 'irrelevant', 'summary']
TYPE_KO = {'topic': '주제', 'title': '제목', 'gist': '요지', 'detail': '내용 일치', 'translate': '해석', 'vocab': '어휘', 'grammar': '어법', 'refer': '지칭',
           'blank': '빈칸', 'order': '순서', 'insert': '문장 위치', 'irrelevant': '무관한 문장', 'summary': '요약문'}
BASE_PLAN = {'topic': 1, 'title': 1, 'gist': 1, 'detail': 3, 'translate': 1, 'vocab': 3, 'grammar': 4, 'refer': 1, 'blank': 3, 'order': 2, 'insert': 2, 'irrelevant': 1, 'summary': 1}  # 24
SA_KINDS = ['word', 'fix', 'form', 'blank', 'refer']
SA_KO = {'word': '단어 쓰기', 'fix': '어법 고치기', 'form': '형태 바꾸기', 'blank': '빈칸 채우기', 'refer': '가리키는 말'}
SA_BASE = {'word': 2, 'fix': 2, 'form': 1, 'blank': 2, 'refer': 1}  # 8
SA_AREA = {'word': 'vocab', 'fix': 'grammar', 'form': 'grammar', 'blank': 'content', 'refer': 'content'}
MARKS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ']
IMG_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}

ITEM = {
    'type': 'object',
    'required': ['type', 'q', 'answer', 'why'],
    'properties': {
        'type': {'type': 'string', 'enum': ['mc', 'sa'], 'description': 'mc 객관식(5지선다), sa 서술형'},
        'area': {'type': 'string', 'enum': TYPES, 'description': '객관식 유형'},
        'kind': {'type': 'string', 'enum': SA_KINDS, 'description': '서술형 종류'},
        'q': {'type': 'string', 'description': '발문. 한국어, 학교 시험지 말투'},
        'text': {'type': 'string', 'description': '문제에 딸린 지문이나 문장. 밑줄 __단어__, 빈칸 _____, 줄바꿈 \\n'},
        'choices': {'type': 'array', 'items': {'type': 'string'}, 'description': '객관식 보기 5개 (번호 없이)'},
        'answer': {'description': '객관식은 정답 보기 번호(0부터 센 0~4 정수), 서술형은 정답 영어 단어나 짧은 구'},
        'accept': {'type': 'array', 'items': {'type': 'string'}, 'description': '서술형에서 같이 맞게 볼 답'},
        'mark': {'type': 'string', 'enum': MARKS, 'description': '서술형 fix 만: 틀린 곳 기호'},
        'hint': {'type': 'string', 'description': '서술형 답 쓰는 조건 (예: "본문에서 찾아 한 단어로, c로 시작")'},
        'why': {'type': 'string', 'description': '해설: 정답의 근거를 지문 표현으로, 해요체 한두 문장. 보기 번호는 쓰지 않는다'},
        'ref': {'type': 'string', 'description': '근거 지문 문장 번호 (예: "3번 문장", "2~4번 문장", "글 전체")'},
    },
}

TOOL = {
    'name': 'make_bank',
    'description': '지문 하나로 만든 내신 변형 문제(객관식)와 서술형을 한 번에 제출한다.',
    'input_schema': {'type': 'object', 'required': ['items'], 'properties': {'items': {'type': 'array', 'items': ITEM}}},
}

REVIEW_TOOL = {
    'name': 'review_bank',
    'description': '문제를 하나씩 직접 풀어 보고 검사한 결과를 한 번에 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['items'],
        'properties': {
            'items': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'required': ['i', 'score', 'verdict'],
                    'properties': {
                        'i': {'type': 'integer', 'description': '문항 번호 (받은 번호 그대로)'},
                        'solved': {'type': 'integer', 'description': '객관식: 직접 풀어서 고른 보기 번호 1~5. 답이 둘 이상이거나 없으면 0'},
                        'written': {'type': 'string', 'description': '서술형: 직접 쓴 답 (어법 고치기는 "ⓑ carp" 처럼 기호와 고친 말)'},
                        'score': {'type': 'integer', 'description': '1~5. 정답이 하나로 분명하고 자연스러운 내신 문제일수록 높게'},
                        'verdict': {'type': 'string', 'enum': ['ok', 'drop']},
                        'issue': {'type': 'string', 'description': 'drop 이거나 score 가 3 이하일 때 문제점 한 줄'},
                    },
                },
            },
        },
    },
}

SYSTEM = """너는 한국 중고등학교 영어 내신 시험을 20년 출제한 교사다. 지문 하나로 학교 시험에 그대로 낼 수 있는 내신 변형 문제를 만든다.
이 문제들은 문제 은행에 쌓여 학생이 사이트에서 푸는 모의고사(풀 때마다 10문항씩 새로 뽑힘), 숙제, 출력용 숙제지로 쓰인다.

[객관식 유형 — area]
- topic 주제: "다음 글의 주제로 가장 적절한 것은?" 보기는 영어 명사구.
- title 제목: "다음 글의 제목으로 가장 적절한 것은?" 보기는 영어 제목.
- gist 요지: "다음 글의 요지로 가장 적절한 것은?" 보기는 우리말 문장.
- detail 내용 일치: "다음 글의 내용과 일치하지 않는 것은?" 또는 "일치하는 것은?" 보기는 우리말 문장(지문 순서대로).
- translate 해석: "밑줄 친 부분의 해석으로 가장 적절한 것은?" 보기는 우리말. 오답은 구조를 잘못 읽은 해석.
- vocab 어휘: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?" (다섯 곳 중 한 곳만 반의어 등으로 바꿈), 또는 동의어·반의어·영영 풀이.
- grammar 어법: "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?"(또는 "옳은 것은?"), 또는 (A), (B), (C)의 각 네모 안에서 어법에 맞는 표현. 수일치, 능동과 수동, 관계사, 분사, 준동사, 병렬, 대명사, 형용사와 부사, 도치처럼 내신에 실제로 나오는 포인트로 만든다.
- refer 지칭: "밑줄 친 ①~⑤ 중에서 가리키는 대상이 나머지 넷과 다른 것은?"
- blank 빈칸: "다음 빈칸에 들어갈 말로 가장 적절한 것은?" 주제나 요지가 담긴 핵심 표현에 빈칸. 보기는 영어.
- order 순서: "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?" text 에 주어진 글을 쓰고 \\n 으로 줄을 바꿔 (A), (B), (C) 단락. 보기는 "(A) - (C) - (B)" 꼴 다섯 개를 이 차례로: (A)-(C)-(B), (B)-(A)-(C), (B)-(C)-(A), (C)-(A)-(B), (C)-(B)-(A).
- insert 문장 위치: "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?" text 맨 앞에 [주어진 문장]을 쓰고 빈 줄 다음 지문에 ( ① ) ~ ( ⑤ ). choices 는 ["①", "②", "③", "④", "⑤"].
- irrelevant 무관한 문장: "다음 글에서 전체 흐름과 관계 없는 문장은?" text 에서 문장 앞에 ①~⑤ 를 붙이고, 그중 하나는 네가 새로 쓴 그럴듯하지만 흐름에서 벗어난 문장. choices 는 ["①", "②", "③", "④", "⑤"].
- summary 요약문: "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?" text 끝에 빈 줄 다음 [요약문]을 영어로 쓰고 (A) _____ , (B) _____ 를 둔다. 보기는 "A말 – B말" 꼴.

[서술형 — kind (영작은 내지 않는다)]
- word: 영영 풀이나 우리말 뜻을 주고 지문에서 단어를 찾아 쓰게 한다. hint 에 "본문에서 찾아 한 단어로, f로 시작"처럼 조건.
- fix: text 에 지문 일부(한두 문장)를 주고 다섯 곳에 ⓐ__was__ 처럼 밑줄. 그중 한 곳만 어법상 틀리게 바꿔 둔다. mark 는 틀린 곳 기호, answer 는 고친 말. 발문 "어법상 틀린 곳을 찾아 기호를 쓰고 바르게 고쳐 쓰시오."
- form: 지문 문장 한 곳을 괄호 안 원형으로 바꿔 두고 알맞은 형태로 쓰게 한다. 예: "a man was ( find ) dead" → found.
- blank: 지문이나 영어 요약문에 빈칸 _____ 하나를 두고 지문에서 찾아 쓰게 한다. hint 에 첫 글자나 단어 수.
- refer: 밑줄 친 대명사(it, they, this 등)가 가리키는 것을 지문에서 찾아 영어로 쓰게 한다.
- 답은 지문에 나온 영어 단어나 짧은 구(4단어 이내)로 하나로 정해지게. 같이 맞게 볼 답은 accept(관사가 있고 없음, 단수와 복수 등).
- 우리말을 영어로 옮기기, 단어 배열, 자유 영작은 내지 않는다.

[지문 다루기]
- 학생은 문제 화면만 본다. 문제를 푸는 데 필요한 지문 부분을 text 에 옮긴다. 짧은 지문(10문장 안팎)은 글 전체를, 긴 지문은 문제에 필요한 4~10문장을 옮긴다. 주제, 제목, 요지, 내용 일치는 글 전체나 그 내용을 담은 큰 덩어리가 필요하다.
- 옮기는 영어는 지문과 한 글자도 다르지 않게 쓴다. 문제를 만들려고 일부러 바꾼 곳(어법, 어휘, 무관한 문장, 빈칸, 밑줄, 번호)만 다르다.
- 밑줄은 __단어__, 번호가 붙은 밑줄은 ①__단어__, 빈칸은 _____ (밑줄 다섯 개), 줄바꿈은 \\n.

[억지 문제를 내지 않는다]
- 정답은 지문을 근거로 하나로 분명해야 한다. 답이 될 수 있는 보기가 둘 이상이면 안 된다.
- 말장난, 이중 부정, 보기끼리 차이가 너무 미세해서 운으로 갈리는 문제, 배경지식이 있어야 푸는 문제는 내지 않는다.
- 오답 보기는 그럴듯하게, 하지만 지문을 제대로 읽으면 분명히 틀리게.
- 같은 문장, 같은 어법 포인트, 같은 단어를 두 번 묻지 않는다. 지문 앞부분부터 끝부분까지 고르게 다룬다. [이미 있는 문제]와 겹치지 않게 다른 문장, 다른 포인트로 만든다.
- 객관식 정답 번호(answer, 0~4)가 한쪽으로 몰리지 않게 고르게 섞는다. 번호나 차례가 있는 보기(①~⑤, 순서 보기)는 보기 순서를 바꾸지 않는다.

[선생님 문제 자료가 있으면]
- 자료 속 문제들의 유형, 발문 말투, 보기 길이, 난이도를 본보기로 삼는다. 자료에 자주 나온 유형은 조금 더 많이 만든다.
- 자료의 문제를 그대로 베끼지 않는다. 같은 지문의 다른 곳이나 다른 포인트로 새 문제를 만든다. 자료가 다른 지문의 문제면 유형과 말투만 참고한다.

[해설]
- why 는 정답의 근거를 지문 표현으로 짚어 해요체 한두 문장으로. 오답이 왜 틀렸는지 한마디를 더해도 좋다. 보기 번호(①, 3번 등)는 쓰지 않는다.
- ref 는 근거 지문 문장 번호. 글 전체면 "글 전체"."""

REVIEW_SYSTEM = """너는 한국 중고등학교 영어과 수석 교사다. 동료가 지문 하나로 만든 내신 변형 문제를 시험에 내기 전에 검토한다.
억지 문제, 답이 애매한 문제, 틀린 문제를 걸러 내는 것이 목표다. 출제자의 정답은 일부러 가려 두었다.

[검토하는 법]
- 문항마다 지문을 근거로 직접 푼다. 객관식은 solved 에 고른 보기 번호(1~5)를, 답이 둘 이상이거나 없으면 0. 서술형은 written 에 직접 쓴 답(어법 고치기는 "ⓑ carp" 처럼 기호와 고친 말).
- score 1~5: 5 학교 시험에 그대로 내도 좋은 문제, 4 좋음, 3 쓸 만함, 2 억지스럽거나 지엽적, 1 틀렸거나 답이 애매함.
- 아래 중 하나라도 해당하면 verdict 는 drop, 아니면 ok. 애매하면 drop 쪽으로.
  · 정답이 하나로 정해지지 않는다.
  · 지문에 근거가 없고 배경지식으로 풀어야 한다.
  · 말장난, 이중 부정, 너무 미세한 차이로 운에 맡긴다. 지나치게 지엽적이다.
  · 오답 보기가 터무니없어서 지문을 안 읽어도 맞힌다.
  · 옮긴 영어가 어색하거나 틀렸다(문제를 만들려고 일부러 바꾼 곳은 빼고). 순서, 문장 위치 문항에서 단서가 없어 답이 갈린다.
  · 발문과 text, 보기가 서로 맞지 않는다.
  · 앞 문항과 같은 문장이나 같은 포인트를 또 묻는다(뒤 문항을 drop).
- issue 에는 drop 이거나 score 3 이하인 까닭을 한 줄로."""


def _scaled(base, n):
    """기본 배분을 n 문항에 맞게 늘이거나 줄여요 (유형마다 적어도 하나는 남기려 하고, 넘치면 앞에서부터 줄여요)"""
    total = sum(base.values())
    out = {k: max(0, round(v * n / total)) for k, v in base.items()}
    keys = list(base)
    i = 0
    while sum(out.values()) < n:
        out[keys[i % len(keys)]] += 1
        i += 1
    while sum(out.values()) > n:
        k = max(out, key=lambda x: out[x])
        out[k] -= 1
    return {k: v for k, v in out.items() if v > 0}


def material(task):
    """지문과 강의에서 정리한 것 (Claude에게 줄 글)"""
    sc = task.get('script') or {}
    out = []
    sents = sc.get('sentences') or []
    if sents:
        out.append('[지문 — 번호는 문장 번호]')
        for s in sents:
            head = f"(소제목: {s['heading']})\n" if s.get('heading') else ''
            out.append(f"{head}{s.get('n')}. {s.get('en', '')}\n   해석: {s.get('ko', '')}")
    elif task.get('passage'):
        out += ['[지문]', str(task['passage'])[:20000]]
        if task.get('translation'):
            out += ['', '[해석]', str(task['translation'])[:12000]]
    if sc.get('vocab'):
        out.append('\n[강의에서 정리한 핵심 단어 — 동의어·반의어 문제에 써요]')
        for v in sc['vocab']:
            extra = ''.join(f' / {k} {", ".join(v[f])}' for f, k in (('syn', '동의어'), ('ant', '반의어')) if isinstance(v.get(f), list) and v.get(f))
            out.append(f"- {v.get('en', '')}: {v.get('ko', '')}{extra}")
    if sc.get('memo'):
        out.append('\n[강의 메모 (구조, 어법 포인트)]')
        out += [f"- {x.get('text', '')}" for x in sc['memo']]
    if sc.get('summary'):
        out.append('\n[내용 정리]')
        out += [f"- {x.get('k', '')}: {x.get('v', '')}" for x in sc['summary']]
    if sc.get('exam'):
        out.append('\n[강의에서 짚은 변형 포인트]')
        out += [f"- {x.get('k', '')}: {x.get('text', '')}" for x in sc['exam']]
    if not sents and task.get('transcript'):
        out.append('\n[강의 자막 (참고)]')
        out.append(' '.join(str(x.get('text', '')) for x in task['transcript'])[:20000])
    return '\n'.join(out)


def _have_text(have):
    if not have:
        return ''
    lines = [f"- ({TYPE_KO.get(h.get('area'), SA_KO.get(h.get('area'), ''))}) {h.get('q', '')} {h.get('text', '')[:90]} → {h.get('answer', '')}" for h in have[-120:]]
    return '\n\n[이미 있는 문제 — 이것과 겹치지 않게]\n' + '\n'.join(lines)


def seed_blocks(seeds, fetch=None, log=None):
    """선생님 문제 자료를 Claude 내용 블록으로 (글은 글로, PDF는 문서로, 사진은 그림으로). fetch 가 없으면 글 자료만"""
    blocks = []
    for s in seeds or []:
        name = s.get('name') or '자료'
        if not s.get('has_file'):
            if s.get('text'):
                blocks.append({'type': 'text', 'text': f'[선생님 문제 자료: {name}]\n{str(s["text"])[:30000]}'})
            continue
        if not fetch:
            continue
        try:
            data = fetch(s['id'])
        except Exception as e:  # 자료 하나를 못 받아도 나머지로 만들어요
            if log:
                log(f'  · 문제 자료 "{name}"를 받지 못했어요: {e}', 'warn')
            continue
        mime = (s.get('mime') or '').lower()
        b64 = base64.b64encode(data).decode()
        if mime == 'application/pdf':
            blocks.append({'type': 'text', 'text': f'[선생님 문제 자료: {name} (PDF)]'})
            blocks.append({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': b64}})
        elif mime in IMG_TYPES:
            blocks.append({'type': 'text', 'text': f'[선생님 문제 자료: {name} (사진)]'})
            blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}})
        elif mime == 'text/plain':
            blocks.append({'type': 'text', 'text': f'[선생님 문제 자료: {name}]\n{data.decode("utf-8", "replace")[:30000]}'})
    return blocks


# ---------------------------------------------------------------- 모양 검사
def _norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().lower()


def item_problems(x):
    out = []
    if not isinstance(x, dict) or not str(x.get('q') or '').strip():
        return ['발문이 없어요.']
    t = str(x.get('text') or '')
    if t.count('__') % 2:
        out.append('text 의 밑줄 표시(__)가 짝이 맞지 않아요.')
    if x.get('type') == 'mc' and not _ordered(x.get('choices') or []) and re.search(r'[①②③④⑤]|\d\s*번\s*보기', str(x.get('why') or '')):
        out.append('해설에 보기 번호를 썼어요.')  # 차례가 있는 보기(①~⑤)는 번호로 설명해도 돼요
    if x.get('type') == 'mc':
        ch = x.get('choices') or []
        a = x.get('answer')
        if len(ch) != 5:
            out.append(f'보기가 {len(ch)}개예요. 5개여야 해요.')
        elif len({_norm(c) for c in ch}) < 5:
            out.append('똑같은 보기가 있어요.')
        if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a <= 4:
            out.append('answer 가 정답 보기 번호(0~4)가 아니에요.')
        if ch and all(str(c).strip() in CIRC for c in ch) and not all(m in t for m in CIRC[:len(ch)]):
            out.append('보기가 ①~⑤ 번호뿐인데 text 에 그 번호가 다 있지 않아요.')
        if x.get('area') not in TYPES:
            out.append('객관식 유형(area)이 없어요.')
    elif x.get('type') == 'sa':
        a = str(x.get('answer') or '').strip()
        if not a:
            out.append('서술형 정답이 없어요.')
        elif len(a.split()) > 6:
            out.append('서술형 정답이 너무 길어요 (영작 금지, 4단어 이내).')
        if x.get('kind') not in SA_KINDS:
            out.append('서술형 종류(kind)가 없어요.')
        if x.get('kind') == 'fix' and (x.get('mark') not in MARKS or x.get('mark') not in t):
            out.append('어법 고치기 문항의 틀린 곳 기호(mark)가 text 에 없어요.')
    else:
        out.append('type 이 mc 나 sa 가 아니에요.')
    return out


def tidy(raw):
    items = []
    for x in (raw.get('items') if isinstance(raw, dict) else None) or []:
        if not isinstance(x, dict):
            continue
        x = {k: x[k] for k in ('type', 'area', 'kind', 'q', 'text', 'choices', 'answer', 'accept', 'mark', 'hint', 'why', 'ref') if k in x}
        if x.get('type') == 'mc':
            try:
                x['answer'] = int(x.get('answer'))
            except (TypeError, ValueError):
                continue
            x['choices'] = [re.sub(r'^\s*(?:[①②③④⑤]|\(?[1-5][).])\s+', '', str(c)).strip() for c in (x.get('choices') or [])]
            for k in ('kind', 'mark', 'accept', 'hint'):
                x.pop(k, None)
        elif x.get('type') == 'sa':
            x['answer'] = str(x.get('answer') or '').strip()
            x['accept'] = [str(a).strip() for a in (x.get('accept') or []) if str(a).strip()]
            x['area'] = SA_AREA.get(x.get('kind'), 'content')
            x.pop('choices', None)
        items.append(x)
    return items


# ---------------------------------------------------------------- 서술형 답 비교 (사이트 quiz.js 와 같은 규칙)
def norm_ans(s):
    import unicodedata

    t = unicodedata.normalize('NFKC', str(s or '')).lower()
    t = re.sub(r'[‘’`´]', "'", t).replace('“', '"').replace('”', '"')
    t = re.sub(r'[‐-―]', '-', t)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^["\'(\[]+|["\')\].,!?;:]+$', '', t).strip()
    return t


def _no_article(s):
    return re.sub(r'^(the|a|an) ', '', s)


def sa_match(it, written):
    ok = {norm_ans(a) for a in [it.get('answer'), *(it.get('accept') or [])] if norm_ans(a)}
    w = str(written or '')
    if it.get('kind') == 'fix':
        m = re.search(r'[ⓐ-ⓔ]', w)
        if not m or m.group(0) != it.get('mark'):
            return False
        w = w[m.end():]
        arrow = re.search(r'→|->|=>', w)
        if arrow:
            w = w[arrow.end():]
        return norm_ans(w) in ok
    mine = norm_ans(w)
    return mine in ok or any(_no_article(x) == _no_article(mine) for x in ok)


# ---------------------------------------------------------------- 만들기와 검사
def _show(i, x):
    lines = [f'[{i}번] ({TYPE_KO.get(x.get("area"), "") if x.get("type") == "mc" else "서술형 " + SA_KO.get(x.get("kind"), "")}) {x.get("q", "")}']
    if x.get('text'):
        lines.append(str(x['text']))
    if x.get('type') == 'mc':
        for k, c in enumerate(x.get('choices') or []):
            lines.append(f'  {CIRC[k] if k < 5 else k + 1} {c}')
    elif x.get('hint'):
        lines.append(f'  (조건: {x["hint"]})')
    return '\n'.join(lines)


def review(client, model, text, items, log=None):
    shown = '\n\n'.join(_show(i, x) for i, x in enumerate(items, 1))
    user = f"""{text}

[검토할 문제 — 출제자 정답과 해설은 가렸어요]
{shown}

문항마다 직접 풀어 보고 review_bank 로 {len(items)}문항 모두의 검사 결과를 제출해 주세요."""
    try:
        msg, block = _errors(lambda: claude.call_tool(client, model=model, system=REVIEW_SYSTEM, user=user, tool=REVIEW_TOOL, max_tokens=10000, log=log))
    except ScriptError as e:
        if log:
            log(f'  · 문제 검사를 하지 못했어요: {e}', 'warn')
        return None
    if not block:
        return None
    raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
    out = {}
    for r in raw.get('items') or []:
        try:
            out[int(r.get('i'))] = r
        except (TypeError, ValueError, AttributeError):
            continue
    return out or None


def judge(items, reviews):
    """검사 결과로 점수를 매기고 통과한 문항만 남겨요. (통과한 문항, 뺀 문항과 까닭)"""
    kept, dropped = [], []
    for i, x in enumerate(items, 1):
        r = (reviews or {}).get(i)
        score = 3
        if r:
            try:
                score = int(r.get('score') or 3)
            except (TypeError, ValueError):
                score = 3
            wrong = False
            if x['type'] == 'mc':
                try:
                    wrong = int(r.get('solved')) != x['answer'] + 1
                except (TypeError, ValueError):
                    wrong = False
            elif r.get('written') is not None and str(r.get('written')).strip():
                wrong = not sa_match(x, r.get('written'))
            if r.get('verdict') == 'drop' or wrong or score <= 2:
                dropped.append((i, x, r.get('issue') or ('검사에서 다르게 풀렸어요' if wrong else '점수가 낮아요')))
                continue
        kept.append({**x, 'score': max(1, min(5, score))})
    return kept, dropped


def generate(task, settings, fetch_seed=None, on_progress=None, log=None):
    """은행에 넣을 문항 목록. fetch_seed(자료 id) → 파일 바이트"""
    import anthropic

    def prog(p, m):
        if on_progress:
            on_progress(p, m)

    key = (settings.get('claude_key') or '').strip()
    if not key:
        raise ScriptError('Claude API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    text = material(task)
    if len(text.strip()) < 80:
        raise ScriptError('문제를 만들 지문이 없어요.')
    want = task.get('want') or {}
    n_mc = max(4, min(40, int(want.get('mc') or 24)))
    n_sa = max(0, min(12, int(want.get('sa') or 8)))
    sents = len((task.get('script') or {}).get('sentences') or []) or len(re.findall(r'[.!?]["\')\]]?\s', str(task.get('passage') or '') + ' '))
    base = dict(BASE_PLAN)
    if sents and sents <= 5:
        for k in ('order', 'insert', 'irrelevant'):
            base.pop(k, None)
    plan = _scaled(base, n_mc)
    sa_plan = _scaled(SA_BASE, n_sa) if n_sa else {}
    plan_text = ', '.join(f'{TYPE_KO[k]}({k}) {n}' for k, n in plan.items())
    sa_text = ', '.join(f'{SA_KO[k]}({k}) {n}' for k, n in sa_plan.items())
    head = f"""[지문 정보]
제목: {task.get('title') or '-'}
출처: {task.get('source') or '-'}
{level_guide(task.get('options'))}

{text}"""
    seeds = task.get('seeds') or []
    blocks = seed_blocks(seeds, fetch_seed, log)
    ask = f"""{_have_text(task.get('have'))}

이 지문으로 make_bank 를 제출해 주세요.
- 객관식 {n_mc}문항: {plan_text}
- 서술형 {n_sa}문항{': ' + sa_text if sa_text else ''}
{'- 위 선생님 문제 자료의 유형과 말투를 본보기로 삼되, 문제를 베끼지 말고 새로 만들어 주세요.' if blocks else ''}"""
    user = [{'type': 'text', 'text': head}, *blocks, {'type': 'text', 'text': ask}] if blocks else head + '\n' + ask
    client = anthropic.Anthropic(api_key=key, max_retries=4, timeout=900)
    model = settings.get('claude_model') or 'claude-sonnet-5-5'

    prog(5, f'Claude가 지문으로 변형 문제를 만드는 중{" (선생님 자료를 본보기로)" if blocks else ""}')
    best, best_bad = None, None
    for attempt in range(2):
        msg, block = _errors(lambda: claude.call_tool(client, model=model, system=SYSTEM, user=user, tool=TOOL, max_tokens=30000, log=log))
        if not block:
            if best is not None:
                break
            if msg.stop_reason == 'max_tokens':
                raise ScriptError('문제가 너무 길어서 중간에 끊겼어요. 다시 시도해 주세요.')
            raise ScriptError('Claude가 문제를 돌려주지 않았어요. 다시 시도해 주세요.')
        raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
        items = tidy(raw)
        bad = [f'{i}번 문항: {p}' for i, x in enumerate(items, 1) for p in item_problems(x)]
        if best is None or len(bad) < len(best_bad):
            best, best_bad = items, bad
        if len(bad) <= max(2, len(items) // 8):
            break
        fix = '\n\n[앞에서 낸 문제에서 고칠 점]\n' + '\n'.join(f'- {b}' for b in bad[:14]) + '\n고칠 점을 반영해서 전체를 다시 제출해 주세요.'
        user = user + [{'type': 'text', 'text': fix}] if isinstance(user, list) else user + fix
    items = [x for x in best if not item_problems(x)]
    if len(items) < 4:
        raise ScriptError('문제를 충분히 만들지 못했어요. 다시 시도해 주세요.')
    prog(60, f'만든 문제 {len(items)}개를 하나씩 검사하는 중')
    rv = review(client, model, head, items, log)
    kept, dropped = judge(items, rv)
    if log:
        if rv is None:
            log('  · 검사 없이 넣어요', 'warn')
        for i, x, why in dropped[:12]:
            kind = TYPE_KO.get(x.get('area'), '') if x['type'] == 'mc' else SA_KO.get(x.get('kind'), '')
            log(f'  · 뺀 문제 {i}번({kind}): {why}')
        log(f'  · 문제 은행에 넣을 문제 {len(kept)}개 (객관식 {sum(1 for x in kept if x["type"] == "mc")}, 서술형 {sum(1 for x in kept if x["type"] == "sa")}), 검사에서 뺀 문제 {len(dropped)}개')
    if not kept:
        raise ScriptError('검사를 통과한 문제가 없어요. 다시 시도해 주세요.')
    balance(kept, seed=int(task.get('id') or 0))  # 정답 번호가 몰리지 않게 (차례가 있는 보기는 그대로)
    return {'items': kept, 'generated_by': model, 'reviewed': rv is not None, 'seeded': bool(blocks)}
