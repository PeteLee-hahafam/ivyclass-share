"""Claude로 판서 강의 대본 만들기."""

import json
import re
import time

from . import claude
from .textutil import clean, split_sentences, split_korean, resolve_range, fuzzy_fix, snap_words

CHARS_PER_MIN = 330  # 한국어 강의 음성 1분에 읽는 글자 수 (속도 1.0 기준)

MARK_TYPES = ['under', 'box', 'arrow', 'circle', 'triangle', 'hl', 'note', 'slash']
COLORS = ['blue', 'red', 'green', 'orange', 'purple']
VIEWS = ['intro', 'summary', 'sentence', 'flow', 'memo', 'vocab', 'review']

TOOL = {
    'name': 'make_lecture',
    'description': '판서 강의의 문장 표시, 상자 내용, 연습지, 단계별 대본을 한 번에 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['title', 'sentences', 'summary', 'flow', 'memo', 'vocab', 'practice', 'steps'],
        'properties': {
            'title': {'type': 'string', 'description': '강의 제목. 한국어 20자 이내.'},
            'sentences': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'required': ['n', 'en', 'ko', 'marks'],
                    'properties': {
                        'n': {'type': 'integer'},
                        'en': {'type': 'string', 'description': '주어진 영어 원문 그대로'},
                        'ko': {'type': 'string', 'description': '자연스러운 우리말 해석'},
                        'marks': {
                            'type': 'array',
                            'items': {
                                'type': 'object',
                                'required': ['id', 'type', 'text'],
                                'properties': {
                                    'id': {'type': 'string', 'description': '문장번호+알파벳. 예: 3a'},
                                    'type': {'type': 'string', 'enum': MARK_TYPES},
                                    'text': {'type': 'string', 'description': '표시할 부분. 문장에서 그대로 복사한 부분 문자열'},
                                    'occ': {'type': 'integer', 'description': '같은 말이 여러 번 나올 때 몇 번째인지'},
                                    'on': {'type': 'string', 'enum': ['en', 'ko']},
                                    'label': {'type': 'string', 'description': '아래 이름표. S, V, O, 관계사절 등'},
                                    'note': {'type': 'string', 'description': '위쪽 손글씨 메모. 16자 이내'},
                                    'to': {'type': 'string', 'description': 'arrow 일 때 화살표가 가리키는 말'},
                                    'color': {'type': 'string', 'enum': COLORS},
                                },
                            },
                        },
                    },
                },
            },
            'summary': {
                'type': 'array',
                'items': {'type': 'object', 'required': ['id', 'k', 'v'], 'properties': {'id': {'type': 'string'}, 'k': {'type': 'string'}, 'v': {'type': 'string'}}},
            },
            'flow': {
                'type': 'array',
                'description': '글의 흐름 그림: 논리 전개 단계 3~5개',
                'items': {
                    'type': 'object',
                    'required': ['id', 'k', 'text'],
                    'properties': {
                        'id': {'type': 'string'},
                        'k': {'type': 'string', 'description': '단계 이름 (도입, 통념, 반박, 사례, 결론, 주제 등)'},
                        'text': {'type': 'string', 'description': '그 단계 내용. 한국어 30자 이내'},
                        'n': {'type': 'string', 'description': '해당 문장 번호 범위. 예: 1-2'},
                        'hot': {'type': 'boolean', 'description': '주제·결론 단계면 true'},
                    },
                },
            },
            'memo': {
                'type': 'array',
                'items': {'type': 'object', 'required': ['id', 'text'], 'properties': {'id': {'type': 'string'}, 'text': {'type': 'string'}, 'tone': {'type': 'string', 'enum': ['red', 'blue', 'green']}}},
            },
            'vocab': {
                'type': 'array',
                'items': {'type': 'object', 'required': ['id', 'en', 'ko'], 'properties': {'id': {'type': 'string'}, 'en': {'type': 'string'}, 'ko': {'type': 'string'}}},
            },
            'practice': {
                'type': 'object',
                'properties': {
                    'grammar': {'type': 'array', 'items': {'type': 'object', 'required': ['q', 'a'], 'properties': {'n': {'type': 'integer'}, 'q': {'type': 'string'}, 'a': {'type': 'string'}, 'why': {'type': 'string'}}}},
                    'blanks': {'type': 'array', 'items': {'type': 'object', 'required': ['q', 'a'], 'properties': {'n': {'type': 'integer'}, 'q': {'type': 'string'}, 'a': {'type': 'string'}}}},
                },
            },
            'steps': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'required': ['view', 'say'],
                    'properties': {
                        'view': {'type': 'string', 'enum': VIEWS},
                        'n': {'type': 'integer', 'description': 'sentence 단계일 때 문장 번호'},
                        'say': {'type': 'string', 'description': '이 단계에서 선생님이 말할 대본'},
                        'show': {'type': 'array', 'items': {'type': 'string'}, 'description': '이 단계에서 그릴 표시·상자 줄 id (설명 순서대로)'},
                        'focus': {'type': 'string', 'description': '긴 문장에서 화면을 맞출 표시 id (선택)'},
                    },
                },
            },
        },
    },
}

CALL_RULE = '''

[학생 이름 부르기]
- 강의 전체에서 3~4번, 집중이 필요한 순간에 say 안에 {호명} 을 쓴다. 예: "{호명}, 여기 진짜 중요해.", "자, {호명}! 이 동사 시제가 뭐였지?"
- {호명} 은 영상을 보는 학생의 이름("하준아")으로 바뀌어 들린다. 뒤에 아·야·님을 붙이지 말고 {호명} 그대로 쓰고, 바로 뒤에 쉼표나 느낌표를 둔다.
- intro(인사) 단계와 review(마무리) 단계에서는 쓰지 않는다. 한 단계에 한 번만.'''

TAG_RULE = '''

[목소리 감정 표시]
- 목소리에 생기를 주려고 say 안에 [excited], [curious], [surprised], [warmly], [playfully], [laughs], [whispers], [sighs] 중에서 골라 강의 전체에 5~8번만 넣는다. 대괄호와 영어 단어 그대로 쓴다.
- 예: "[excited] 자, 이게 이 지문의 핵심이야!", "[whispers] 여기 시험에 꼭 나와." 감정 표시는 화면에 보이지 않고 목소리에만 들어간다.'''

TONES = {
    'banmal': '반말 강의체. "자, 보자.", "~거야", "~지?", "~거든" 처럼 친근하지만 핵심은 단호하게. 존댓말과 섞지 않는다 (첫 인사만 "안녕하세요, ○○입니다.").',
    'jondaet': '존댓말 강의체. "~입니다", "~예요", "~거든요" 처럼 정중하고 차분하게.',
}
LEVELS = {'mid3': '중학교 3학년', 'high1': '고등학교 1학년', 'high2': '고등학교 2학년', 'high3': '고등학교 3학년(수능 대비)'}
FOCUS = {
    'balanced': '구문 분석, 어법, 어휘, 글의 흐름을 골고루',
    'grammar': '어법·구문 분석을 가장 자세히 (내신 어법 문제 대비)',
    'reading': '글의 흐름, 주제·요지, 논리 전개를 가장 자세히 (독해·수능 대비)',
    'vocab': '핵심 어휘와 숙어, 유의어·반의어를 가장 자세히',
}

EXAMPLE = {
    'sentences': [
        {
            'n': 2,
            'en': 'Bears, cougars, and other wild animals sometimes remind us of their formidable presence.',
            'ko': '곰, 퓨마, 그리고 다른 야생 동물들은 때때로 우리에게 그들의 가공할 만한 존재감을 상기시킨다.',
            'marks': [
                {'id': '2a', 'type': 'under', 'text': 'Bears, cougars, and other wild animals', 'label': 'S'},
                {'id': '2b', 'type': 'under', 'text': 'remind', 'label': 'V', 'note': 'remind A of B'},
                {'id': '2c', 'type': 'under', 'text': 'us', 'label': 'O'},
                {'id': '2d', 'type': 'box', 'text': 'of their formidable presence', 'label': '전치사구'},
                {'id': '2e', 'type': 'note', 'text': 'formidable', 'note': '=fearsome'},
                {'id': '2f', 'type': 'box', 'on': 'ko', 'text': '가공할 만한', 'color': 'red'},
            ],
        },
        {
            'n': 5,
            'en': "In Oregon's forests in 1995, a man was found dead, initially blamed on a cougar, but subsequent investigation revealed otherwise.",
            'ko': '1995년 오리건주의 숲에서 한 남자가 죽은 채로 발견되었는데, 처음에는 퓨마의 탓으로 여겨졌지만 이후의 조사는 그렇지 않다는 것을 밝혀냈다.',
            'marks': [
                {'id': '5a', 'type': 'box', 'text': "In Oregon's forests in 1995", 'label': '문두 부사구'},
                {'id': '5b', 'type': 'under', 'text': 'a man', 'label': 'S'},
                {'id': '5c', 'type': 'under', 'text': 'was found', 'label': 'V', 'note': '수동태'},
                {'id': '5d', 'type': 'under', 'text': 'dead', 'label': 'C', 'note': 'died ✕'},
                {'id': '5e', 'type': 'box', 'text': 'initially blamed on a cougar', 'label': '분사구문', 'note': 'blame A on B'},
                {'id': '5f', 'type': 'triangle', 'text': 'but'},
                {'id': '5g', 'type': 'under', 'text': 'subsequent investigation', 'label': 'S'},
                {'id': '5h', 'type': 'under', 'text': 'revealed', 'label': 'V'},
                {'id': '5i', 'type': 'under', 'text': 'otherwise', 'label': 'O', 'note': '그렇지 않다는 것'},
            ],
        },
    ],
    'steps': [
        {'view': 'sentence', 'n': 2, 'say': '자, 두 번째 문장 보자. 주어가 좀 길지? Bears, cougars, and other wild animals. 곰, 퓨마, 그리고 다른 야생 동물들. 여기까지가 통째로 주어야. 그럼 동사는? 그렇지, remind. 그런데 remind 뒤에 of가 보이지? remind A of B. A에게 B를 떠올리게 하다. 그래서 us가 A, of their formidable presence가 B가 되는 거야.', 'show': ['2a', '2b', '2c', '2d']},
        {'view': 'sentence', 'n': 5, 'say': '{호명}, 여기 진짜 시험에 잘 나와. 맨 앞 In Oregon\'s forests in 1995는 부사구니까 괄호 치고 넘어가자. 주어는 a man, 동사는 was found. 발견되었다. 그럼 dead는 뭘까? 보어야. 그래서 died로 바꾸면 틀려. 꼭 기억해 둬. 그리고 but이 문장과 문장을 이어 주지? 그래서 세모.', 'show': ['5a', '5b', '5c', '5d', '5f']},
    ],
}


def build_prompt(job, academy, style=None, expressive=False):
    opts = job.get('options') or {}
    call_names = opts.get('call_names', True) is not False
    minutes = int(opts.get('minutes') or 15)
    chars = minutes * CHARS_PER_MIN
    tone = TONES.get(opts.get('tone'), TONES['banmal'])
    level = LEVELS.get(opts.get('level'), opts.get('level') or '고등학교 1학년')
    focus = FOCUS.get(opts.get('focus'), FOCUS['balanced'])
    st = style or {}
    verb_desc = '동그라미' if st.get('verb_mark', 'circle') == 'circle' else '밑줄'
    box_desc = {'box': '둥근 박스', 'paren2': '구는 괄호 ( ), 절은 대괄호 [ ]'}.get(st.get('modifier', 'paren'), '괄호 ( )')
    conj_desc = {'circle': '동그라미', 'none': '표시하지 않음'}.get(st.get('conj_mark', 'triangle'), '세모')
    long_on = st.get('long_paren', True)
    sc_on = st.get('sc_circle', True) and st.get('verb_mark', 'circle') == 'circle'
    long_desc = (' 주어·목적어(목적격 보어 포함)가 3단어 이상이면 화면에서 자동으로 괄호가 된다.' if sc_on else ' 주어·목적어·보어가 3단어 이상이면 화면에서 자동으로 괄호가 된다.') if long_on else ''
    # 2형식: 동사와 보어를 따로 표시하면 화면이 '~다'로 해석하는 대로 한 동그라미로 묶어요 (보어 3단어까지)
    sc_desc = (
        "\n  · 2형식(주격 보어): 동사(V)와 보어(C)를 각각 under 로 따로 표시한다. 보어가 3단어까지면 화면에서 동사와 보어가 한 동그라미로 묶이고, "
        f"3단어가 넘으면 동사는 동그라미, 보어는 {'괄호가' if long_on else '밑줄이'} 된다. 둘은 같은 단계의 show 에 함께 넣고, '~다'로 묶어서 해석해 준다 "
        "(예: is important → 중요하다, was found dead → 죽은 채로 발견되었다). 5형식의 목적격 보어는 O.C 로 적는다."
    ) if sc_on else ''
    system = f"""너는 한국 고등학교 영어 내신·수능을 20년 가르친 인기 강사이자, 판서 강의 영상 대본 작가다.
영어 지문 하나로 약 {minutes}분짜리 판서 강의를 만든다. 결과는 반드시 make_lecture 도구 한 번으로만 낸다.

[판서 화면]
- 화면에는 지문 문장이 번호와 함께 영어 원문(위)과 해석(아래)으로 적혀 있고, 선생님이 설명하면서 문장 위에 표시(marks)를 그린다.
- 표시 종류 (화면에 그려지는 모양은 선생님이 고른 판서 스타일을 따른다)
  · under: 문장 성분 표시 + 아래 이름표(label). 이름표는 S, V, O, C, O.C, I.O, D.O, 가S, 진S, 가O, 진O 처럼 짧게. 동사(V)는 {verb_desc}로, 주어·목적어·보어는 밑줄로 그려진다.{long_desc}{sc_desc}
  · box: 구·절 덩어리 묶기 → 화면에서 {box_desc}. 수식어구, 준동사구(동명사구·to부정사구·분사구), 관계사절, 명사절, 분사구문, 부사절, 문두 부사어 등. label 에 문법 이름을 짧게.
  · triangle: 절과 절을 잇는 등위접속사 → 화면에서 {conj_desc}.
  · circle: 꼭 짚을 단어를 동그라미 (연결어, 신호어 등).
  · arrow: 수식어(text)에서 꾸밈받는 말(to)로 화살표. 수식 관계가 헷갈리는 곳에만 쓴다.
  · hl: 노란 형광펜. 정답의 근거, 주제와 바로 이어지는 핵심 표현.
  · note: 표시 없이 단어 위에 손글씨 메모만 단다.
  · slash: 끊어 읽기 빗금 (text 의 바로 앞에 그려진다).
  · 모든 표시에 note(위쪽 메모, 16자 이내)를 붙일 수 있다. 어법 함정은 틀린 보기에 ✕ ("Although ✕", "is ✕"), 유의어는 "=fearsome", 구문 패턴은 "remind A of B".
  · on 을 "ko" 로 하면 해석 문장에 표시한다 (핵심 어휘 뜻에 빨간 box 등).
- text 는 그 문장(en, on 이 "ko"면 ko)에서 그대로 복사한 부분 문자열만 쓴다. 철자, 대소문자, 쉼표까지 똑같이. 같은 말이 두 번 나오면 occ 로 몇 번째인지 적는다.
- id 는 "문장번호+알파벳"(3a, 3b …)으로 겹치지 않게. 문장마다 4~10개. 같은 단어 위에 메모가 겹치지 않게 한다.
- 판서 아래쪽 상자 세 개
  · memo(메모, 빨간 손글씨): 글의 구조(도입·전개·결론과 문장 범위), "어법 포인트: …" 모음, "유의어: … / 반의어: …". 2~5줄. 줄마다 id(memo1 …).
  · summary(내용 정리): k 는 "제목", "주제", "요지"(영어 문장 + 괄호 안 우리말) 다음에 흐름(도입, 전개, 반전, 사례, 결론 등). 5~8줄. id(sum1 …).
  · vocab(핵심 단어·구문): 8~12개, 시험에 나올 단어와 숙어. id(v1 …).
- flow(글의 흐름 그림): 글의 논리 전개를 3~5개 상자와 화살표로 그린다. k 는 단계 이름(도입, 통념, 반박, 연구 결과, 사례, 결론, 주제 등 2~6자), text 는 그 단계 내용(한국어 30자 이내, 손글씨로 그려짐), n 은 문장 번호 범위("1-2"), 주제·결론 단계는 hot 을 true 로. id(f1 …).

[강의 흐름 = steps]
1) intro 1단계: "안녕하세요, {academy}입니다."로 시작해 오늘 지문을 소개하고 흥미를 끈다.
2) summary 1~2단계: 본문을 보기 전에 내용 정리 상자를 채우며 글 전체를 먼저 잡아 준다.
3) sentence: 1번 문장부터 순서대로, 문장마다 1~3단계. show 에는 그 단계에서 새로 그릴 표시 id 를 말하는 순서대로 넣는다.
4) memo 1~2단계 → vocab 1단계 → review 1단계(정리와 마무리 인사).
3-1) flow 1단계: 문장 설명을 모두 마친 뒤, 글의 흐름 그림을 함께 그리며 글 전체가 어떻게 전개되는지 짚는다.
- 단계마다 say 는 120~350자. 모든 say 글자 수를 합치면 약 {chars}자(±10%)가 되게 한다.
- say 는 음성으로 그대로 읽힌다. 기호(✕ = ~ → / ( ) [ ] ① 등)나 표시 이름(3a)을 쓰지 말고 말로 풀어 쓴다. 영어 단어·구절은 영어 그대로 쓴다 (한글 발음 표기 금지).
- 말투: {tone}

[말하듯이 자연스럽게 — 진짜 선생님 목소리처럼 들려야 한다]
- 교실에서 학생 한 명을 보며 말하듯 쓴다. 글 읽듯 나열하지 말고 "자,", "봐 봐.", "여기서 잠깐!", "그렇지?", "왜 그럴까?" 같은 입말을 섞는다.
- 문장은 짧게 끊는다 (한 문장 40자 안팎). 정말 중요한 말은 한 번 더 말해서 힘을 준다.
- 질문을 던진 다음 바로 답한다. 예: "이 that은 뭘까? 그렇지, 명사절이야."
- 화면에 그리는 표시를 가리키듯 말한다. 예: "여기 동그라미 친 동사 보이지?", "괄호 친 부분은 일단 빼고 보자."
- 같은 말버릇을 계속 되풀이하지 않는다. 단계마다 첫마디를 다르게 시작한다.
- 학생 수준: {level}. 설명 중점: {focus}.
- 시험 포인트를 꼭 짚는다: 어법(수일치, 능동·수동, 관계사, 분사, 준동사, 병렬, 대명사 등), 어휘, 내용 일치 함정, 주제·요지·빈칸 추론의 단서.{{call_rule}}{{tag_rule}}

[문장]
- sentences 는 주어진 번호와 영어 원문을 한 글자도 바꾸지 않고 그대로 쓴다. 문장을 합치거나 나누지 않는다. ko 에는 자연스러운 우리말 해석을 쓴다. 선생님이 준 해석이 있으면 그 해석을 그대로 쓴다.

[연습지 = practice]
- grammar 4~6개: q 는 지문 문장(일부)에 "(정답 / 오답)" 또는 "(오답 / 정답)" 괄호 선택지를 넣은 것, a 는 정답, why 는 한 줄 해설, n 은 문장 번호.
- blanks 3~5개: q 는 지문 문장에서 핵심 표현을 ____ 로 비운 것, a 는 정답, n 은 문장 번호.

[예시 — 형식과 말투만 참고]
{json.dumps(EXAMPLE, ensure_ascii=False)}
"""
    rules = clean((style or {}).get('rules')) if style else ''
    system = system.replace('{call_rule}', CALL_RULE if call_names else '\n- 학생 이름을 부르는 말({호명})은 쓰지 않는다.').replace('{tag_rule}', TAG_RULE if expressive else '')
    if rules:
        system += f"""
[선생님 판서 규칙 — 위 설명보다 이 규칙을 먼저 따른다]
{(style or {}).get('rules', '').strip()}
(규칙의 말을 표시 종류로 바꾸는 법: 밑줄 = under, 동그라미 = circle (동사는 under 에 이름표 V 로 해도 화면에서 동그라미가 된다), 괄호 = box, 세모 = triangle, 형광펜 = hl, 메모 = note, 화살표 = arrow, 빗금·끊어 읽기 = slash. 쓸 수 있는 표시는 이것뿐이니 다른 모양은 가장 가까운 표시로 바꿔 쓴다. 문장 성분 표시에는 이름표(S, V, O, C …)를 붙인다.)
"""
    sents = split_sentences(job.get('passage') or '')
    lines = '\n'.join(f'{i + 1}. {s}' for i, s in enumerate(sents))
    tr = split_korean(job.get('translation') or '')
    tr_block = ''
    if tr:
        if len(tr) == len(sents):
            tr_block = '\n[선생님이 준 해석 — 문장 번호대로 그대로 쓰기]\n' + '\n'.join(f'{i + 1}. {t}' for i, t in enumerate(tr))
        else:
            tr_block = '\n[선생님이 준 해석 — 문장 수가 달라서 참고만]\n' + clean(job.get('translation'))
    title = clean(job.get('title'))
    auto_title = (opts.get('auto_title') or not title)
    memo = clean(opts.get('memo'))
    user = f"""[지문 정보]
제목: {'(지어 주세요: 내용이 궁금해지는 한국어 제목, 20자 이내)' if auto_title else title}
출처: {clean(job.get('source')) or '-'}
학원: {academy}
강의 길이: 약 {minutes}분 (대본 약 {chars}자)

[문장] 번호와 원문을 절대 바꾸지 마세요.
{lines}
{tr_block}
{('[선생님 요청]' + chr(10) + memo) if memo else ''}"""
    return system, user, sents, (tr if len(tr) == len(sents) else None), chars


def _uniq(ids, want, prefix):
    base = re.sub(r'[^A-Za-z0-9_-]', '', str(want or '')) or prefix
    x, k = base, 1
    while x in ids:
        k += 1
        x = f'{base}_{k}'
    ids.add(x)
    return x


def finalize(raw, sents, tr, job):
    """Claude가 준 데이터를 판서에 맞게 다듬어요. 원문은 언제나 선생님이 넣은 그대로 둬요."""
    warnings = []
    ids = set()
    by_n = {}
    for i, s in enumerate(raw.get('sentences') or []):
        try:
            n = int(s.get('n') or i + 1)
        except (TypeError, ValueError):
            n = i + 1
        by_n.setdefault(n, s)
    sentences = []
    for i, en in enumerate(sents):
        n = i + 1
        src = by_n.get(n) or {}
        ko = clean(tr[i]) if tr else clean(src.get('ko'))
        marks = []
        for m in src.get('marks') or []:
            if not isinstance(m, dict):
                continue
            t = m.get('type') if m.get('type') in MARK_TYPES else 'under'
            on = 'ko' if m.get('on') == 'ko' else 'en'
            line = ko if on == 'ko' else en
            text = clean(m.get('text'))
            rng = resolve_range(line, text, m.get('occ') or 1)
            if not rng:
                fixed = fuzzy_fix(line, text)
                if not fixed:
                    warnings.append(f'{n}번 문장 표시 "{text}"를 찾지 못해 뺐어요')
                    continue
                text = fixed
                rng = resolve_range(line, text)
            if on == 'en' and rng:
                a, b = snap_words(line, rng)
                if (a, b) != tuple(rng):
                    text = line[a:b]
            mk = {'id': _uniq(ids, m.get('id') or f'{n}x', f'{n}m'), 'type': t, 'text': text}
            if on == 'ko':
                mk['on'] = 'ko'
            if m.get('occ') and int(m.get('occ') or 1) > 1:
                mk['occ'] = int(m['occ'])
            if t == 'arrow':
                to = clean(m.get('to'))
                if not resolve_range(line, to):
                    to = fuzzy_fix(line, to)
                if not to:
                    warnings.append(f'{n}번 문장 화살표 끝 "{m.get("to")}"을 찾지 못해 뺐어요')
                    continue
                mk['to'] = to
            for k, lim in (('label', 16), ('note', 24)):
                v = clean(m.get(k))
                if v:
                    mk[k] = v[:lim]
            if m.get('color') in COLORS:
                mk['color'] = m['color']
            marks.append(mk)
        sentences.append({'n': n, 'en': en, 'ko': ko, 'marks': marks})

    def items(key, prefix, fields):
        out = []
        for x in raw.get(key) or []:
            if not isinstance(x, dict):
                continue
            row = {f: clean(x.get(f)) for f in fields}
            if not any(row.values()):
                continue
            row['id'] = _uniq(ids, x.get('id') or f'{prefix}{len(out) + 1}', prefix)
            if key == 'memo' and x.get('tone') in ('blue', 'green'):
                row['tone'] = x['tone']
            out.append(row)
        return out

    summary = items('summary', 'sum', ['k', 'v'])
    flow = []
    for x in raw.get('flow') or []:
        if not isinstance(x, dict) or not clean(x.get('text')):
            continue
        row = {'id': _uniq(ids, x.get('id') or f'f{len(flow) + 1}', 'f'), 'k': clean(x.get('k'))[:12], 'text': clean(x.get('text'))[:60]}
        if clean(x.get('n')):
            row['n'] = clean(x.get('n'))[:12]
        if x.get('hot'):
            row['hot'] = True
        flow.append(row)
        if len(flow) >= 6:
            break
    memo = items('memo', 'memo', ['text'])
    vocab = items('vocab', 'v', ['en', 'ko'])
    known = ids
    nset = {s['n'] for s in sentences}
    steps = []
    for st in raw.get('steps') or []:
        if not isinstance(st, dict):
            continue
        view = st.get('view') if st.get('view') in VIEWS else 'sentence'
        say = re.sub(r'\{\s*(호명|이름|name)\s*\}(아|야|님)?', '{호명}', clean(st.get('say')))
        if not say:
            continue
        step = {'view': view, 'say': say}
        if view in ('sentence', 'review') and st.get('n') is not None:
            try:
                n = int(st['n'])
            except (TypeError, ValueError):
                n = None
            if n in nset:
                step['n'] = n
            elif view == 'sentence':
                step['view'] = 'review'
        elif view == 'sentence':
            step['view'] = 'review'
        show = [str(x) for x in (st.get('show') or []) if str(x) in known]
        if show:
            step['show'] = show
        if st.get('focus') and str(st['focus']) in known:
            step['focus'] = str(st['focus'])
        steps.append(step)
    if not steps:
        raise ValueError('대본 단계가 비어 있어요.')
    # 이름 부르기는 강의 전체에 5번까지만, 인사·마무리에서는 빼요
    used = 0
    for st in steps:
        if '{호명}' not in st['say']:
            continue
        if st['view'] in ('intro', 'review') or used >= 5:
            st['say'] = clean(re.sub(r'\{호명\}\s*[,!.?]?\s*', '', st['say']))
            continue
        first = st['say'].index('{호명}') + len('{호명}')
        st['say'] = st['say'][:first] + clean(re.sub(r'\{호명\}\s*[,!.?]?\s*', '', st['say'][first:])) if '{호명}' in st['say'][first:] else st['say']
        used += 1
    if flow and not any(st['view'] == 'flow' for st in steps):
        # 흐름 그림 단계가 없으면 메모 앞에 짧게 넣어요
        at = next((i for i, st in enumerate(steps) if st['view'] in ('memo', 'vocab', 'review')), len(steps))
        steps.insert(at, {'view': 'flow', 'say': '자, 지금까지 본 내용을 그림으로 한번 정리해 보자. ' + ' '.join(f"{f['k']}, {f['text']}." for f in flow), 'show': [f['id'] for f in flow]})

    pr = raw.get('practice') or {}
    practice = {
        'grammar': [{k: (clean(g.get(k)) if k != 'n' else g.get(k)) for k in ('n', 'q', 'a', 'why') if g.get(k) not in (None, '')} for g in (pr.get('grammar') or []) if isinstance(g, dict) and g.get('q')],
        'blanks': [{k: (clean(b.get(k)) if k != 'n' else b.get(k)) for k in ('n', 'q', 'a') if b.get(k) not in (None, '')} for b in (pr.get('blanks') or []) if isinstance(b, dict) and b.get('q')],
    }
    title = clean(raw.get('title'))[:40] or clean(job.get('title')) or '지문 강의'
    script = {
        'version': 1,
        'title': title,
        'source': clean(job.get('source')),
        'sentences': sentences,
        'summary': summary,
        'flow': flow,
        'memo': memo,
        'vocab': vocab,
        'practice': practice,
        'steps': steps,
    }
    return script, warnings


class ScriptError(Exception):
    pass


def generate(job, settings, academy, on_progress=None, style=None, log=None):
    from .tts import is_expressive

    """Claude에게 대본을 받아 다듬어서 돌려줘요. (script, warnings, usage)"""
    import anthropic

    key = (settings.get('claude_key') or '').strip()
    if not key:
        raise ScriptError('Claude API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    system, user, sents, tr, chars = build_prompt(job, academy, style, expressive=is_expressive(settings))
    if not sents:
        raise ScriptError('지문에서 영어 문장을 찾지 못했어요.')
    if len(sents) > 40:
        raise ScriptError(f'문장이 {len(sents)}개라 너무 길어요. 지문을 나눠서 만들어 주세요.')
    client = anthropic.Anthropic(api_key=key, max_retries=4, timeout=900)
    model = settings.get('claude_model') or 'claude-sonnet-5-5'
    expect = chars * 4.2 + len(sents) * 900  # 대략적인 결과 길이 (진행률 표시용)
    tick = {'last': 0, 'got': 0}

    def on_event(ev):
        if getattr(ev, 'type', '') == 'input_json':
            tick['got'] += len(getattr(ev, 'partial_json', '') or '')
            now = time.time()
            if on_progress and now - tick['last'] > 3:
                tick['last'] = now
                on_progress(min(95, 5 + int(90 * tick['got'] / expect)))

    try:
        msg, block = claude.call_tool(client, model=model, system=system, user=user, tool=TOOL, max_tokens=40000, stream=True, on_event=on_event, log=log)
    except anthropic.AuthenticationError:
        raise ScriptError('Claude API 키가 맞지 않아요. 제작 엔진 설정에서 키를 확인해 주세요.')
    except anthropic.PermissionDeniedError:
        raise ScriptError('Claude API 키에 이 모델을 쓸 권한이 없어요.')
    except anthropic.NotFoundError:
        raise ScriptError(f'Claude 모델 이름({model})을 찾지 못했어요. 엔진 설정에서 모델을 바꿔 주세요.')
    except anthropic.RateLimitError:
        raise ScriptError('Claude API 사용 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요.')
    except anthropic.BadRequestError as e:
        m = str(e)
        if 'credit' in m.lower() or 'balance' in m.lower():
            raise ScriptError('Claude API 크레딧이 없어요. console.anthropic.com → Billing에서 크레딧을 충전해 주세요. Claude 앱 구독과는 따로예요.')
        raise ScriptError(f'Claude가 요청을 거절했어요: {m[:300]}')
    except anthropic.APIConnectionError:
        raise ScriptError('Claude에 연결하지 못했어요. 인터넷을 확인해 주세요.')
    except anthropic.APIStatusError as e:
        raise ScriptError(f'Claude 쪽에서 문제가 생겼어요 ({e.status_code}). 잠시 뒤 다시 시도해 주세요.')
    if msg.stop_reason == 'max_tokens':
        raise ScriptError('대본이 너무 길어서 중간에 끊겼어요. 강의 길이를 줄여서 다시 만들어 주세요.')
    if not block:
        raise ScriptError('Claude가 대본을 돌려주지 않았어요. 다시 시도해 주세요.')
    raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
    script, warnings = finalize(raw, sents, tr, job)
    script['generated_by'] = model
    total = sum(len(s['say']) for s in script['steps'])
    script['call_names'] = (job.get('options') or {}).get('call_names', True) is not False
    if total < chars * 0.6:
        warnings.append(f'대본이 짧아요 ({total}자, 목표 {chars}자).')
    usage = getattr(msg, 'usage', None)
    return script, warnings, usage
