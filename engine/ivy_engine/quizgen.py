"""확인 문제: 강의를 끝까지 듣고 이해했는지 보는 내신형 객관식 25문항을 만들어요.

1) 강의 대본(지문 문장과 해석, 선생님이 한 말, 단어, 메모)이나 올린 강의의 자막을 Claude에게 주고
   make_quiz 도구로 영역마다 조금 넉넉하게(31문항) 받아요.
2) review_quiz 로 한 번 더 검사해요. 정답을 가린 채 직접 풀어 보게 해서, 출제자 정답과 다르게 풀리거나
   억지스럽거나 답이 애매한 문항은 빼요.
3) 영역별 문항 수(어휘 6, 문법 7, 해석 3, 내용 7, 변형 2)에 맞춰 점수가 높은 문항으로 25개를 골라요.
   검사에서 너무 많이 빠지면 모자란 만큼만 한 번 더 만들어 검사해요.
"""

import json
import random
import re

from . import claude
from .textutil import level_guide
from .scriptgen import ScriptError

AREAS = ['vocab', 'grammar', 'translate', 'content', 'variant']  # 내는 순서
AREA_KO = {'vocab': '어휘', 'grammar': '문법', 'translate': '해석', 'content': '내용', 'variant': '변형'}
MC_PLAN = {'vocab': 6, 'grammar': 7, 'translate': 3, 'content': 7, 'variant': 2}  # 객관식 25
EXTRA = {'vocab': 1, 'grammar': 2, 'translate': 1, 'content': 1, 'variant': 1}  # 검사에서 빠질 몫까지 넉넉히
TOTAL = sum(MC_PLAN.values())
MIN_ITEMS = 15
CIRC = ['①', '②', '③', '④', '⑤']
VIEW_NAME = {'intro': '인사', 'summary': '내용 정리', 'sentence': '문장 설명', 'flow': '글의 흐름', 'memo': '메모', 'vocab': '핵심 어휘', 'exam': '변형 포인트', 'review': '마무리'}

ITEM = {
    'type': 'object',
    'required': ['area', 'q', 'choices', 'answer', 'why'],
    'properties': {
        'area': {'type': 'string', 'enum': AREAS, 'description': 'vocab 어휘, grammar 문법, translate 해석, content 내용, variant 변형'},
        'q': {'type': 'string', 'description': '발문. 한국어, 학교 시험지 말투'},
        'text': {'type': 'string', 'description': '풀 때 필요한 영어 문장(지문에서 그대로). 밑줄 __단어__, 빈칸 _____, 줄바꿈은 \\n'},
        'choices': {'type': 'array', 'items': {'type': 'string'}, 'description': '보기 5개. 앞에 번호를 붙이지 않는다'},
        'answer': {'type': 'integer', 'description': '정답 보기 번호 (0부터 센 0~4)'},
        'why': {'type': 'string', 'description': '해설: 강의에서 무엇이라고 설명했는지 근거로, 해요체 한두 문장. 보기 번호는 쓰지 않는다'},
        'ref': {'type': 'string', 'description': '근거 지문 문장 번호 (예: "3번 문장", "2~4번 문장", "강의 전체")'},
    },
}

TOOL = {
    'name': 'make_quiz',
    'description': '강의 확인 문제(모두 5지선다 객관식)를 한 번에 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['items'],
        'properties': {'items': {'type': 'array', 'description': '어휘 → 문법 → 해석 → 내용 → 변형 순서로 모은 객관식 문항', 'items': ITEM}},
    },
}

REVIEW_TOOL = {
    'name': 'review_quiz',
    'description': '확인 문제를 하나씩 직접 풀어 보고 검사한 결과를 한 번에 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['items'],
        'properties': {
            'items': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'required': ['i', 'solved', 'score', 'verdict'],
                    'properties': {
                        'i': {'type': 'integer', 'description': '문항 번호 (받은 번호 그대로)'},
                        'solved': {'type': 'integer', 'description': '직접 풀어서 고른 보기 번호 1~5. 답이 될 수 있는 보기가 둘 이상이거나 없으면 0'},
                        'score': {'type': 'integer', 'description': '1~5. 강의를 들은 학생이 분명히 맞히는 자연스러운 내신 문제일수록 높게'},
                        'verdict': {'type': 'string', 'enum': ['ok', 'drop']},
                        'issue': {'type': 'string', 'description': 'drop 이거나 score 가 3 이하일 때 문제점 한 줄'},
                    },
                },
            },
        },
    },
}

SYSTEM = f"""너는 한국 중고등학교 영어 교사다. 학생이 선생님의 강의 영상을 끝까지 듣고 이해했는지 확인하는 내신형 확인 문제를 만든다.
학생은 휴대폰이나 PC에서 바로 풀고 바로 채점받는다. 그래서 모든 문항은 5지선다 객관식이다. 서술형은 내지 않는다.

[무엇을 묻나 — 강의를 들은 학생이 맞힐 수 있게]
- 강의에서 선생님이 실제로 설명하고 강조한 것을 묻는다: 단어 뜻과 동의어·반의어, 어법 포인트(주어와 동사 찾기, 수일치, 능동과 수동, 관계사, 분사, 준동사, 병렬, 보어 등), 문장 해석, 글의 주제와 요지와 흐름, 세부 내용, 그리고 이 지문이 내신 변형 문제로 나올 때의 단서.
- 강의에 없는 지식, 지나치게 지엽적인 것, 지문에 없는 내용은 묻지 않는다. 강의를 들었으면 풀 수 있고, 안 들었으면 헷갈리게 만든다.

[영역별로 이렇게]
- vocab 어휘: 밑줄 친 단어나 표현의 뜻, 강의에서 정리한 동의어(바꿔 쓸 수 있는 말)와 반의어, 영영 풀이. 동의어와 반의어를 적어도 한 문항씩 넣는다.
- grammar 문법: 강의에서 짚은 어법 포인트. 빈칸에 알맞은 형태, 밑줄 친 다섯 곳 중 어법상 틀린 것, (A)(B) 괄호 안에서 알맞은 것 고르기. 일부러 틀리게 만드는 곳은 강의에서 "이렇게 바꾸면 틀린다"고 말한 함정으로만 만든다.
- translate 해석: 지문 한 문장(또는 밑줄 친 부분)의 우리말 해석으로 알맞은 것. 정답은 강의에서 풀어 준 해석이고, 오답은 주어와 동사를 잘못 잡거나 꾸밈 관계, 시제, 능동과 수동을 잘못 읽은 해석처럼 학생이 실제로 틀리는 해석으로 만든다.
- content 내용: 주제, 제목, 요지(강의에서 짚은 요지 문장), 내용 일치와 불일치, 사례와 그 의미, 글의 흐름과 구조.
- variant 변형: 이 지문이 내신 변형 문제로 나올 때의 유형으로, 강의에서 짚은 단서(연결어, 대명사, 요지 문장, 핵심 표현)로 풀 수 있게 만든다. 빈칸 추론(핵심 표현이나 요지 문장에 빈칸), 글의 순서((A)(B)(C) 배열), 주어진 문장의 위치, 요약문 완성((A)(B)) 중에서 고른다. text 에 필요한 지문 문장을 5문장 이내로 옮긴다.

[억지 문제를 내지 않는다]
- 정답은 강의와 지문을 근거로 하나로 분명해야 한다. 답이 될 수 있는 보기가 둘 이상이면 안 된다.
- 강의 몇 분에 무슨 말을 했나, 선생님의 농담이나 말버릇, 숫자 세기, 철자 하나 같은 지엽적인 것은 묻지 않는다.
- 말장난, 이중 부정, 보기끼리 차이가 너무 미세해서 운으로 갈리는 문제는 내지 않는다.
- 오답 보기는 그럴듯하게, 하지만 분명히 틀리게 만든다. 강의를 안 들어도 지울 수 있는 터무니없는 보기는 쓰지 않는다.
- 한 문항의 text 나 보기가 다른 문항의 정답을 알려 주지 않게 한다. 같은 단어나 같은 어법 포인트를 두 번 묻지 않는다.

[내신 시험 형식]
- 발문은 실제 학교 시험지 말투로 쓴다. 예: "밑줄 친 단어의 의미로 가장 알맞은 것은?", "밑줄 친 부분 중 어법상 틀린 것은?", "다음 문장의 해석으로 가장 알맞은 것은?", "이 글의 주제로 가장 알맞은 것은?", "빈칸에 들어갈 말로 가장 알맞은 것은?", "주어진 글 다음에 이어질 글의 순서로 가장 알맞은 것은?"
- 학생은 지문 전체를 보지 않고 문제만 본다. 풀 때 필요한 영어 문장은 text 에 지문에서 한 글자도 바꾸지 않고 옮긴다(어법 문제에서 일부러 바꾼 곳, 빈칸, 밑줄 표시만 다르게). "윗글" 대신 "다음 문장", "다음 글", "이 글"이라고 쓴다. 지문 전체 내용을 묻는 문항(주제, 요지, 흐름, 내용 일치)은 text 를 비워 두고 보기만으로 묻는다.
- text 안에서 밑줄은 __단어__ 처럼 밑줄 두 개로 감싸고, 빈칸은 _____ (밑줄 다섯 개)로 쓴다. 다섯 곳에 밑줄을 치고 그중 하나를 고르는 문항은 ①__was__ 처럼 번호를 밑줄 앞에 붙이고, choices 는 ["①", "②", "③", "④", "⑤"] 로 쓴다.
- 글의 순서 문항은 text 에 주어진 글을 쓰고 \\n 으로 줄을 바꿔 (A), (B), (C) 단락을 차례로 적는다. 보기는 "(A) - (C) - (B)" 꼴 다섯 개. 주어진 문장의 위치 문항은 text 맨 앞에 [주어진 문장]을 쓰고, 지문 문장 사이에 ( ① ) ~ ( ⑤ ) 를 넣고, choices 는 ["①", "②", "③", "④", "⑤"].
- (A), (B) 고르기는 text 에 (A) [ 정답 / 오답 ] 처럼 괄호를 넣고, 보기는 "disappointed – that" 꼴로 쓴다.
- 객관식 보기는 5개, 정답은 하나. 보기 앞에 번호를 붙이지 않는다. answer 는 0부터 센 정답 번호이고, 정답 번호가 한쪽으로 몰리지 않게 고르게 섞는다.
- 지문 앞부분부터 끝부분까지 고르게 다룬다.
- why(해설)는 강의에서 무엇이라고 설명했는지를 근거로 해요체 한두 문장으로 쓴다. 예: "강의에서 dead는 보어라서 died로 바꾸면 틀린다고 했어요." 해설에 보기 번호(①, 3번 등)를 쓰지 않는다.
- ref 는 근거가 된 지문 문장 번호("3번 문장", "2~4번 문장"). 강의 전체 내용이면 "강의 전체".
- 발문과 해설은 한국어, 영어 문장과 단어는 영어 그대로."""

REVIEW_SYSTEM = """너는 한국 중고등학교 영어과 수석 교사다. 동료 교사가 강의 영상을 보고 만든 확인 문제(5지선다 객관식)를 학생에게 내기 전에 검토한다.
억지 문제, 답이 애매한 문제, 틀린 문제를 걸러 내는 것이 목표다. 출제자의 정답은 일부러 가려 두었다.

[검토하는 법]
- 문항마다 강의 내용과 지문만 보고 직접 풀어서 solved 에 고른 보기 번호(1~5)를 적는다. 답이 될 수 있는 보기가 둘 이상이거나 하나도 없으면 0 을 적는다.
- score 는 1~5: 5 강의를 들은 학생은 분명히 맞히고 안 들었으면 헷갈리는 좋은 내신 문제, 4 좋음, 3 쓸 만하지만 아쉬움, 2 억지스럽거나 지엽적, 1 틀렸거나 답이 애매함.
- 아래 중 하나라도 해당하면 verdict 는 drop, 아니면 ok. 애매하면 drop 쪽으로 판단한다.
  · 정답이 하나로 정해지지 않는다(답이 될 수 있는 보기가 둘 이상이거나 없다).
  · 강의와 지문에 근거가 없고 배경지식이나 상식으로 풀어야 한다.
  · 지나치게 지엽적이다: 강의 몇 분에 무슨 말을 했나, 선생님의 농담이나 말버릇, 숫자 세기, 철자 하나.
  · 말장난이나 이중 부정으로 일부러 헷갈리게 하거나, 보기끼리 차이가 너무 미세해서 운으로 갈린다.
  · 오답 보기가 터무니없어서 강의를 안 들어도 맞힌다(다섯 개 중 셋 이상이 말이 안 됨).
  · 영어 문장이 어색하거나 틀렸다(어법 문제에서 일부러 틀리게 만든 곳은 빼고).
  · 발문과 text, 보기가 서로 맞지 않는다.
  · 앞 문항의 text 나 보기가 이 문항의 정답을 알려 준다, 또는 앞 문항과 같은 단어나 같은 어법 포인트를 또 묻는다(뒤에 나온 문항을 drop).
- issue 에는 drop 이거나 score 가 3 이하인 까닭을 한 줄로 쓴다."""


def _clean_say(t):
    t = re.sub(r'\[[a-z ]{2,20}\]\s*', '', str(t or ''))  # 목소리 감정 표시
    t = re.sub(r'\{\s*(호명|이름|name)\s*\}\s*[,!.?]?\s*', '', t)
    return re.sub(r'\s{2,}', ' ', t).strip()


def material(task):
    """Claude에게 줄 강의 내용. (글, 대본 강의인지)"""
    sc = task.get('script') or {}
    out = []
    sents = sc.get('sentences') or []
    if sc.get('steps'):
        if sents:
            out.append('[지문 문장]')
            for s in sents:
                head = f" (소제목: {s['heading']})" if s.get('heading') else ''
                out.append(f"{s.get('n')}. {s.get('en', '')}{head}\n   해석: {s.get('ko', '')}")
        out.append('\n[강의에서 선생님이 한 말 — 순서대로]')
        for i, st in enumerate(sc['steps'], 1):
            where = VIEW_NAME.get(st.get('view'), st.get('view') or '')
            if st.get('n'):
                where += f" ({st['n']}번 문장)"
            out.append(f"({i}) {where}: {_clean_say(st.get('say'))}")
        if sc.get('vocab'):
            out.append('\n[강의에서 정리한 핵심 단어·구문]')
            for v in sc['vocab']:
                extra = ''.join(f' / {k} {", ".join(v[f])}' for f, k in (('syn', '동의어'), ('ant', '반의어')) if isinstance(v.get(f), list) and v.get(f))
                out.append(f"- {v.get('en', '')}: {v.get('ko', '')}{extra}")
        if sc.get('summary'):
            out.append('\n[내용 정리]')
            out += [f"- {x.get('k', '')}: {x.get('v', '')}" for x in sc['summary']]
        if sc.get('memo'):
            out.append('\n[메모 (구조, 어법 포인트, 동의어·반의어)]')
            out += [f"- {x.get('text', '')}" for x in sc['memo']]
        if sc.get('exam'):
            out.append('\n[변형 포인트]')
            out += [f"- {x.get('k', '')}: {x.get('text', '')}" for x in sc['exam']]
        if sc.get('flow'):
            out.append('\n[글의 흐름]')
            out += [f"- {x.get('k', '')}: {x.get('text', '')} ({x.get('n', '')})" for x in sc['flow']]
        return '\n'.join(out), True
    tr = task.get('transcript') or []
    if task.get('passage'):
        out += ['[지문]', str(task['passage'])[:20000], '']
    if tr:
        out.append('[강의 자막 — 선생님이 한 말을 받아 적은 것이라 틀린 글자가 있을 수 있다]')
        out.append(' '.join(str(x.get('text', '')) for x in tr))
    return '\n'.join(out)[:90000], False


# ---------------------------------------------------------------- 모양 검사
def _norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().lower()


def item_problems(x):
    """문항 하나의 모양 문제 (빈 목록이면 통과)"""
    out = []
    if not isinstance(x, dict) or not str(x.get('q') or '').strip():
        return ['발문이 없어요.']
    ch = x.get('choices') or []
    a = x.get('answer')
    if len(ch) != 5:
        out.append(f'보기가 {len(ch)}개예요. 5개여야 해요.')
    elif len({_norm(c) for c in ch}) < 5:
        out.append('똑같은 보기가 있어요.')
    if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < max(1, len(ch)):
        out.append('answer 가 정답 보기 번호(0~4)가 아니에요.')
    t = str(x.get('text') or '')
    if t.count('__') % 2:
        out.append('text 의 밑줄 표시(__)가 짝이 맞지 않아요.')
    if ch and all(str(c).strip() in CIRC for c in ch) and not all(m in t for m in CIRC[:len(ch)]):
        out.append('보기가 ①~⑤ 번호뿐인데 text 에 그 번호가 다 있지 않아요.')
    if not _ordered(ch) and re.search(r'[①②③④⑤]|\d\s*번\s*보기', str(x.get('why') or '')):
        out.append('해설에 보기 번호를 썼어요.')  # 차례가 있는 보기(①~⑤)는 번호로 설명해도 돼요
    return out


def problems(raw, want=None):
    """받은 문제에서 고칠 점 (빈 목록이면 통과). want: 영역별로 바라는 문항 수"""
    items = raw.get('items') if isinstance(raw, dict) else None
    if not isinstance(items, list) or not items:
        return ['items 가 비어 있어요.']
    want = want or {k: MC_PLAN[k] + EXTRA[k] for k in AREAS}
    out = []
    for k, n in want.items():
        have = sum(1 for x in items if isinstance(x, dict) and x.get('area') == k)
        if have < n - 1:
            out.append(f'{AREA_KO[k]}({k}) 문항이 {have}개예요. {n}개를 만들어 주세요.')
    for i, x in enumerate(items, 1):
        for p in item_problems(x):
            out.append(f'{i}번 문항: {p}')
    return out


def _ordered(ch):
    """보기 순서를 바꾸면 안 되는 문항 (기호·번호 차례 보기)"""
    return all(re.match(r'^\s*([ⓐ-ⓔ①-⑤]|\(?[a-eA-E1-5]\)|[a-eA-E1-5]\.)', str(c)) for c in ch)


def balance(items, seed=0):
    """객관식 정답 번호가 한쪽으로 몰렸으면 보기를 맞바꿔 고르게 섞어요 (해설에 보기 번호가 없는 문항만)"""
    mc = [x for x in items if x.get('type') == 'mc' and isinstance(x.get('answer'), int) and len(x.get('choices') or []) == 5]
    if not mc:
        return items
    counts = [sum(1 for x in mc if x['answer'] == k) for k in range(5)]
    if max(counts) <= max(6, len(mc) * 0.3):
        return items
    targets = [i % 5 for i in range(len(mc))]
    random.Random(seed).shuffle(targets)
    for x, t in zip(mc, targets):
        if _ordered(x['choices']) or re.search(r'[①②③④⑤]|\d\s*번', str(x.get('why') or '')):
            continue
        a = x['answer']
        ch = list(x['choices'])
        ch[a], ch[t] = ch[t], ch[a]
        x['choices'], x['answer'] = ch, t
    return items


def tidy(raw):
    """도구 결과를 사이트에 보낼 모양으로 (모두 객관식, 정답 번호는 정수)"""
    items = []
    for x in (raw.get('items') if isinstance(raw, dict) else None) or []:
        if not isinstance(x, dict):
            continue
        x = {k: x[k] for k in ('area', 'q', 'text', 'choices', 'answer', 'why', 'ref') if k in x}
        try:
            x['answer'] = int(x.get('answer'))
        except (TypeError, ValueError):
            continue
        if x.get('area') not in AREAS:
            x['area'] = 'content'
        x['choices'] = [re.sub(r'^\s*(?:[①②③④⑤]|\(?[1-5][).])\s+', '', str(c)).strip() for c in (x.get('choices') or [])]
        x['type'] = 'mc'
        items.append(x)
    return {'items': items}


# ---------------------------------------------------------------- 검사해서 고르기
def _show(i, x):
    lines = [f'[{i}번] ({AREA_KO.get(x.get("area"), "")}) {x.get("q", "")}']
    if x.get('text'):
        lines.append(str(x['text']))
    for k, c in enumerate(x.get('choices') or []):
        lines.append(f'  {CIRC[k] if k < 5 else k + 1} {c}')
    return '\n'.join(lines)


def scored(items, reviews, base=0):
    """검사 결과로 점수를 매겨요. ([(점수, 순번, 문항)], [(번호, 문항, 뺀 까닭)])

    출제자 정답과 다르게 풀렸거나, drop 이거나, 점수가 2 이하이면 빼요. 검사 결과가 없는 문항은 보통(3점)으로 봐요.
    """
    good, dropped = [], []
    for i, x in enumerate(items, 1):
        r = (reviews or {}).get(i)
        score = 3
        if r:
            solved = r.get('solved')
            wrong = isinstance(solved, int) and solved != x['answer'] + 1
            if r.get('verdict') == 'drop' or wrong or int(r.get('score') or 0) <= 2:
                why = r.get('issue') or ('검사에서 다르게 풀렸어요' if wrong else '점수가 낮아요')
                dropped.append((i, x, why))
                continue
            score = int(r.get('score') or 3)
        good.append((score, base + i, x))
    return good, dropped


def choose(good, plan=None):
    """영역별 문항 수대로 점수 높은 순으로 골라요. 모자란 영역은 다른 영역에서 채워요. (고른 문항, 영역별 모자란 수)"""
    plan = plan or MC_PLAN
    chosen, left, short = [], [], {}
    for area in AREAS:
        cand = sorted([g for g in good if g[2].get('area') == area], key=lambda g: (-g[0], g[1]))
        n = plan.get(area, 0)
        chosen += cand[:n]
        left += cand[n:]
        if len(cand) < n:
            short[area] = n - len(cand)
    gap = sum(plan.values()) - len(chosen)
    if gap > 0:
        left.sort(key=lambda g: (-g[0], g[1]))
        chosen += left[:gap]
    order = {a: k for k, a in enumerate(AREAS)}
    chosen.sort(key=lambda g: (order.get(g[2].get('area'), 9), g[1]))
    return [g[2] for g in chosen], short


def _errors(fn):
    """Claude 오류를 한국어 안내로 바꿔요"""
    import anthropic

    try:
        return fn()
    except anthropic.AuthenticationError:
        raise ScriptError('Claude API 키가 맞지 않아요.')
    except anthropic.RateLimitError:
        raise ScriptError('Claude API 사용 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요.')
    except anthropic.BadRequestError as e:
        m = str(e).lower()
        if 'credit' in m or 'balance' in m:
            raise ScriptError('Claude API 크레딧이 없어요. console.anthropic.com → Billing에서 크레딧을 충전해 주세요. Claude 앱 구독과는 따로예요.')
        raise ScriptError(f'Claude가 요청을 거절했어요: {str(e)[:300]}')
    except anthropic.APIConnectionError:
        raise ScriptError('Claude에 연결하지 못했어요. 인터넷을 확인해 주세요.')
    except anthropic.APIStatusError as e:
        raise ScriptError(f'Claude 쪽에서 문제가 생겼어요 ({e.status_code}).')


def _make(client, model, user, want, log=None):
    """make_quiz 로 받아서 모양을 검사해요. 모양이 틀리면 한 번 더 부탁해요."""
    best, best_bad = None, None
    for attempt in range(2):
        msg, block = _errors(lambda: claude.call_tool(client, model=model, system=SYSTEM, user=user, tool=TOOL, max_tokens=20000, log=log))
        if not block:
            if best is not None:
                break
            if msg.stop_reason == 'max_tokens':
                raise ScriptError('확인 문제가 너무 길어서 중간에 끊겼어요. 다시 시도해 주세요.')
            raise ScriptError('Claude가 확인 문제를 돌려주지 않았어요. 다시 시도해 주세요.')
        raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
        raw = tidy(raw)
        bad = problems(raw, want)
        if best is None or len(bad) < len(best_bad):
            best, best_bad = raw, bad
        if not bad:
            break
        user = user + '\n\n[앞에서 낸 문제에서 고칠 점]\n' + '\n'.join(f'- {b}' for b in bad[:14]) + '\n고칠 점을 반영해서 전체를 다시 제출해 주세요.'
    # 모양이 끝내 틀린 문항은 빼요
    return [x for x in (best or {}).get('items', []) if not item_problems(x)]


def review(client, model, text, items, log=None):
    """정답을 가린 채 풀어 보고 문항마다 점수를 매겨요. {번호: 결과} (검사를 못 하면 None)"""
    shown = '\n\n'.join(_show(i, x) for i, x in enumerate(items, 1))
    user = f"""{text}

[검토할 확인 문제 — 출제자 정답과 해설은 가렸어요]
{shown}

문항마다 직접 풀어 보고 review_quiz 로 {len(items)}문항 모두의 검사 결과를 제출해 주세요."""
    try:
        msg, block = _errors(lambda: claude.call_tool(client, model=model, system=REVIEW_SYSTEM, user=user, tool=REVIEW_TOOL, max_tokens=8000, log=log))
    except ScriptError as e:
        if log:
            log(f'  · 문제 검사를 하지 못했어요: {e}', 'warn')
        return None
    if not block:
        return None
    raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
    out = {}
    for r in raw.get('items') or []:
        if not isinstance(r, dict):
            continue
        try:
            i = int(r.get('i'))
            out[i] = {'solved': int(r.get('solved')), 'score': int(r.get('score') or 0), 'verdict': str(r.get('verdict') or 'ok'), 'issue': str(r.get('issue') or '')}
        except (TypeError, ValueError):
            continue
    return out or None


def generate(task, settings, academy='', on_progress=None, log=None):
    import anthropic

    def prog(p, m):
        if on_progress:
            on_progress(p, m)

    key = (settings.get('claude_key') or '').strip()
    if not key:
        raise ScriptError('Claude API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    text, scripted = material(task)
    if len(text.strip()) < 80:
        raise ScriptError('확인 문제를 만들 강의 내용이 없어요. 대본이나 자막이 있어야 해요.')
    head = f"""[강의 정보]
제목: {task.get('title') or '-'}
출처: {task.get('source') or '-'}
학원: {academy or '-'}
{level_guide(task.get('options'))}

{text}"""
    want = {k: MC_PLAN[k] + EXTRA[k] for k in AREAS}
    plan_text = ', '.join(f'{AREA_KO[k]}({k}) {n}' for k, n in want.items())
    user = f"""{head}

위 강의를 듣고 푸는 확인 문제를 make_quiz 로 제출해 주세요. 모두 5지선다 객관식이고, 검사에서 빠질 문항까지 생각해 영역마다 넉넉히 {plan_text}, 모두 {sum(want.values())}문항을 이 순서로 모아서 내 주세요."""
    client = anthropic.Anthropic(api_key=key, max_retries=4, timeout=600)
    model = settings.get('claude_model') or 'claude-sonnet-5-5'

    prog(5, 'Claude가 강의를 읽고 확인 문제를 만드는 중')
    items = _make(client, model, user, want, log)
    if len(items) < MIN_ITEMS:
        raise ScriptError('확인 문제를 충분히 만들지 못했어요. 다시 시도해 주세요.')
    prog(55, f'만든 문제 {len(items)}개를 하나씩 검사하는 중')
    rv = review(client, model, head, items, log)
    good, dropped = scored(items, rv)
    chosen, short = choose(good)
    if log:
        if rv is None:
            log('  · 검사 없이 골랐어요', 'warn')
        for i, x, why in dropped[:12]:
            log(f'  · 뺀 문제 {i}번({AREA_KO.get(x.get("area"), "")}): {why}')
    if rv is not None and (len(chosen) < TOTAL or any(n >= 2 for n in short.values())):
        # 검사에서 한 영역이 많이 빠졌으면 그 영역만 한 번 더 만들어 검사해요
        prog(75, '모자란 문제를 더 만드는 중')
        have = '\n'.join(f'- ({AREA_KO.get(x.get("area"), "")}) {x.get("q", "")} {str(x.get("text") or "")[:80]}' for _, _, x in good)
        more_want = {k: n + 1 for k, n in short.items()} or {'content': TOTAL - len(chosen) + 1}
        more_text = ', '.join(f'{AREA_KO[k]}({k}) {n}' for k, n in more_want.items())
        user2 = f"""{head}

[이미 있는 문제 — 이것과 겹치지 않게]
{have}

[검사에서 빠진 까닭 — 이런 문제는 다시 내지 않기]
{chr(10).join(f'- {why}' for _, _, why in dropped[:12])}

모자란 문제만 make_quiz 로 제출해 주세요: {more_text}."""
        try:
            more = _make(client, model, user2, more_want, log)
        except ScriptError as e:
            more = []
            if log:
                log(f'  · 더 만들지 못했어요: {e}', 'warn')
        if more:
            prog(85, f'더 만든 문제 {len(more)}개를 검사하는 중')
            rv2 = review(client, model, head + '\n\n[이미 있는 문제]\n' + have, more, log)
            good2, dropped2 = scored(more, rv2, base=1000)
            dropped += dropped2
            chosen, short = choose(good + good2)
    if len(chosen) < MIN_ITEMS:
        raise ScriptError('검사를 통과한 확인 문제가 너무 적어요. 다시 시도해 주세요.')
    balance(chosen, seed=int(task.get('lecture_id') or 0))
    if log:
        by = ', '.join(f'{AREA_KO[k]} {sum(1 for x in chosen if x.get("area") == k)}' for k in AREAS)
        log(f'  · 확인 문제 {len(chosen)}개 ({by}), 검사에서 뺀 문제 {len(dropped)}개')
    return {'items': chosen, 'generated_by': model, 'scripted': scripted, 'reviewed': rv is not None}
