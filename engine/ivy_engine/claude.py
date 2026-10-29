"""Claude 부르기 공용 도구: 모델마다 다른 규칙을 여기서 맞춰요.

- Claude Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1 은 도구를 꼭 부르게 하는 설정
  (tool_choice 의 tool, any)을 받지 않아요(400 오류). 이 모델들은 auto 로 두고,
  시스템 지시로 도구를 한 번 부르게 해요. 처음 보는 모델이 같은 오류를 내도 auto 로 다시 해요.
- 5.x 모델은 생각하기(adaptive thinking)가 기본으로 켜져 있고, 생각한 만큼 출력 토큰으로 값을 내요.
  Sonnet 5.5 는 between_tools 로 미리 생각하기를 꺼서 예전과 같은 값·속도로 만들어요.
  Opus 5.5 는 생각하기를 끌 수 없어요(가장 꼼꼼한 대신 조금 더 비싸요).
"""
import re

_NO_FORCE = re.compile(r'claude-(?:opus|sonnet)-5-5|claude-(?:fable|mythos)-5-1')
_SONNET_55 = re.compile(r'claude-sonnet-5-5')
_GEN5 = re.compile(r'claude-[a-z]+-5\b|claude-[a-z]+-5-')

MUST = '\n\n[제출 방법]\n- 결과는 반드시 {name} 도구를 딱 한 번 호출해서 제출한다. 도구 호출 밖에는 아무 글도 쓰지 않는다.'
NUDGE = '\n\n(앞선 답에서 {name} 도구를 부르지 않았어요. 이번에는 반드시 {name} 도구를 호출해서 제출해 주세요.)'


def forced_ok(model):
    """tool_choice 로 도구를 꼭 부르게 할 수 있는 모델인지"""
    return not _NO_FORCE.search(model or '')


def thinking_for(model):
    """보낼 thinking 설정 (없으면 None: 모델 기본값)"""
    if _SONNET_55.search(model or ''):
        return {'type': 'between_tools'}
    return None


def max_out(model, base):
    """5.x 모델은 생각하기도 출력(max_tokens)에 들어가서 여유를 두 배로 둬요 (최대 64000)"""
    return min(base * 2, 64000) if _GEN5.search(model or '') else base


def _once(client, stream, on_event, kw):
    if not stream:
        return client.messages.create(**kw)
    with client.messages.stream(**kw) as s:
        for ev in s:
            if on_event:
                on_event(ev)
        return s.get_final_message()


def _add_text(user, extra):
    """user 가 글이면 뒤에 붙이고, 블록 목록(사진, PDF와 글)이면 글 블록을 하나 더해요"""
    if isinstance(user, list):
        return user + [{'type': 'text', 'text': extra}]
    return user + extra


def call_tool(client, *, model, system, user, tool, max_tokens, stream=False, on_event=None, log=None):
    """도구 하나로 결과를 받아요. (message, tool_use 블록 또는 None)

    user 는 글 하나, 또는 사진·PDF 블록이 섞인 내용 블록 목록이에요.
    anthropic 오류는 그대로 올려 보내요(부르는 쪽에서 한국어 안내로 바꿔요).
    """
    import anthropic

    name = tool['name']
    force = forced_ok(model)
    nudged = False
    while True:
        kw = {
            'model': model,
            'max_tokens': max_out(model, max_tokens),
            'system': system + MUST.format(name=name),
            'messages': [{'role': 'user', 'content': user}],
            'tools': [tool],
            'tool_choice': {'type': 'tool', 'name': name} if force else {'type': 'auto'},
        }
        th = thinking_for(model)
        if th:
            kw['thinking'] = th
        try:
            msg = _once(client, stream, on_event, kw)
        except anthropic.BadRequestError as e:
            # 처음 보는 모델이 도구 강제 호출을 안 받으면 auto 로 다시 해요
            if force and 'tool_choice' in str(e):
                if log:
                    log(f'  · {model} 은 도구 강제 호출을 받지 않아서 auto 로 다시 보내요')
                force = False
                continue
            raise
        block = next((b for b in msg.content if getattr(b, 'type', '') == 'tool_use' and getattr(b, 'name', '') == name), None)
        if block or force or nudged or msg.stop_reason in ('max_tokens', 'refusal'):
            return msg, block
        # 도구를 부르지 않고 글로만 답했으면 한 번 더 부탁해요
        if log:
            log(f'  · Claude가 {name} 도구를 부르지 않아서 한 번 더 부탁해요')
        nudged = True
        user = _add_text(user, NUDGE.format(name=name))
