"""AI 요약·연습지: 강의 자막(또는 대본)을 읽고 한 줄 요약, 핵심 정리, 목차, 단어, 확인 문제를 만들어요."""

import json

from . import claude
from .scriptgen import ScriptError

TOOL = {
    'name': 'make_summary',
    'description': '강의 요약, 목차, 핵심 단어, 확인 문제를 한 번에 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['one_line', 'points', 'chapters', 'vocab', 'quiz'],
        'properties': {
            'one_line': {'type': 'string', 'description': '강의 전체를 한 문장으로 (60자 이내)'},
            'points': {'type': 'array', 'items': {'type': 'string'}, 'description': '핵심 정리 4~8개. 학생이 복습할 문장으로'},
            'chapters': {
                'type': 'array',
                'description': '영상 목차 4~10개. t 는 그 부분이 시작하는 초(자막의 [분:초]를 초로 바꿔서)',
                'items': {'type': 'object', 'required': ['t', 'title'], 'properties': {'t': {'type': 'number'}, 'title': {'type': 'string', 'description': '20자 이내'}}},
            },
            'vocab': {
                'type': 'array',
                'items': {'type': 'object', 'required': ['en', 'ko'], 'properties': {'en': {'type': 'string'}, 'ko': {'type': 'string'}}},
                'description': '강의에 나온 영어 단어·구문 6~12개',
            },
            'quiz': {
                'type': 'array',
                'description': '확인 문제 4~6개 (사지선다)',
                'items': {
                    'type': 'object',
                    'required': ['q', 'choices', 'answer', 'why'],
                    'properties': {
                        'q': {'type': 'string'},
                        'choices': {'type': 'array', 'items': {'type': 'string'}, 'description': '보기 4개'},
                        'answer': {'type': 'integer', 'description': '정답 보기 번호 (0부터)'},
                        'why': {'type': 'string', 'description': '한 줄 해설'},
                    },
                },
            },
        },
    },
}


def _mmss(x):
    x = int(max(0, x))
    return f'{x // 60}:{x % 60:02d}'


def source_text(task):
    """요약할 글: 자막이 있으면 시간과 함께, 없으면 AI 대본이나 지문."""
    tr = task.get('transcript') or []
    if tr:
        return '\n'.join(f"[{_mmss(x['s'])}] {x['text']}" for x in tr), True
    sc = task.get('script') or {}
    if sc.get('steps'):
        return '\n'.join(st.get('say', '') for st in sc['steps']), False
    return task.get('passage') or '', False


def generate(task, settings, academy=''):
    import anthropic

    key = (settings.get('claude_key') or '').strip()
    if not key:
        raise ScriptError('Claude API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    text, timed = source_text(task)
    if len(text.strip()) < 30:
        raise ScriptError('요약할 내용이 없어요. 자막을 먼저 만들어 주세요.')
    text = text[:120000]
    dur = task.get('duration') or 0
    system = f"""너는 한국 학원 영어 강사의 조교다. 선생님이 찍은 강의 영상의 내용을 학생 복습용으로 정리한다.
결과는 반드시 make_summary 도구 한 번으로만 낸다.
- 모든 설명은 한국어로, 영어 단어·문장은 영어 그대로.
- 자막은 음성 인식이라 틀린 글자가 있을 수 있다. 문맥에 맞게 바로잡아 이해하되, 없는 내용을 지어내지 않는다.
- points 는 시험 전에 다시 볼 핵심만. 문법 용어는 정확하게.
- quiz 는 강의에서 다룬 내용으로만, 보기 4개, 정답은 하나.
{'- chapters 의 t 는 자막의 [분:초] 시각을 초로 바꾼 값. 첫 목차는 0초.' if timed else '- 시간 정보가 없으니 chapters 는 빈 배열로 둔다.'}"""
    user = f"""[강의 정보]
제목: {task.get('title') or '-'}
출처: {task.get('source') or '-'}
학원: {academy or '-'}
영상 길이: {int(dur // 60)}분 {int(dur % 60)}초

[{'자막' if timed else '강의 내용'}]
{text}"""
    client = anthropic.Anthropic(api_key=key, max_retries=4, timeout=600)
    model = settings.get('claude_model') or 'claude-sonnet-5-5'
    try:
        msg, block = claude.call_tool(client, model=model, system=system, user=user, tool=TOOL, max_tokens=8000)
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
    if not block:
        if msg.stop_reason == 'max_tokens':
            raise ScriptError('요약이 너무 길어서 중간에 끊겼어요. 다시 시도해 주세요.')
        raise ScriptError('Claude가 요약을 돌려주지 않았어요. 다시 시도해 주세요.')
    raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
    chapters = []
    for c in raw.get('chapters') or []:
        try:
            t = float(c.get('t'))
        except (TypeError, ValueError):
            continue
        if 0 <= t <= (dur or 1e9) and str(c.get('title') or '').strip():
            chapters.append({'t': round(t, 1), 'title': str(c['title']).strip()[:40]})
    if chapters and chapters[0]['t'] > 5:
        chapters.insert(0, {'t': 0, 'title': '시작'})
    raw['chapters'] = sorted(chapters, key=lambda c: c['t'])
    raw['generated_by'] = model
    return raw
