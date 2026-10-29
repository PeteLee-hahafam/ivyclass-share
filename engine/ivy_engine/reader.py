"""교과서 사진·PDF에서 영어 지문 글자를 읽어 새 강의 칸에 채울 글로 만들어요 (Claude가 사진을 읽어요)."""

import base64
import json

from . import claude
from .quizgen import _errors
from .scriptgen import ScriptError

IMG_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
MAX_IMAGE = 5 * 1024 * 1024  # Claude가 받는 사진 한 장 크기 (사이트에서 줄여서 올려요)

TOOL = {
    'name': 'read_passage',
    'description': '사진이나 PDF에서 읽어 낸 영어 지문을 제출한다.',
    'input_schema': {
        'type': 'object',
        'required': ['passage'],
        'properties': {
            'title': {'type': 'string', 'description': '지문 제목(영어 제목이 인쇄돼 있으면 그대로). 없으면 빈 문자열'},
            'source': {'type': 'string', 'description': '교재와 단원 정보가 보이면 짧게 (예: "동아(윤) 8과 본문", "2025 고1 3월 모의고사 20번"). 없으면 빈 문자열'},
            'passage': {'type': 'string', 'description': '영어 지문 전체. 문단은 빈 줄로, 소제목은 "## 소제목" 줄로'},
            'translation': {'type': 'string', 'description': '사진에 우리말 해석이 인쇄돼 있으면 문장 순서대로. 없으면 빈 문자열'},
            'note': {'type': 'string', 'description': '흐리거나 잘려서 확실하지 않은 곳이 있으면 한 줄로 알림. 없으면 빈 문자열'},
        },
    },
}

SYSTEM = """너는 영어 교재 편집자다. 선생님이 찍은 교과서·부교재·시험지 사진(또는 PDF)에서 영어 지문을 글자 그대로 옮겨 적는다.
옮긴 글은 판서 강의를 만드는 자료가 되니 한 글자도 틀리면 안 된다.

[옮기는 법]
- 인쇄된 영어 본문만 옮긴다. 철자, 대소문자, 문장부호, 따옴표를 그대로 둔다. 뜻이 이상해 보여도 고치지 않는다.
- 줄 끝에서 하이픈으로 끊긴 단어는 이어 붙이고, 줄바꿈은 없애서 문장을 잇는다. 문단이 바뀌는 곳은 빈 줄로 나눈다.
- 소제목(본문 중간의 짧은 제목)은 "## 소제목" 한 줄로 따로 쓴다. 지문 맨 위 제목은 title 에 쓰고 passage 에는 넣지 않는다.
- 빼는 것: 문제 번호와 지시문, 선택지, 쪽 번호, 머리말과 꼬리말, 어휘 풀이(* 표시나 옆 칸의 단어 뜻), 그림 설명, 손으로 쓴 필기와 밑줄, 형광펜.
- 지문 안에 인쇄된 어법 표시 ①~⑤, (A), (B), (C), 빈칸은 그대로 둔다.
- 여러 장이면 장 순서대로 이어서 하나의 지문으로 쓴다. 같은 문장이 두 장에 겹쳐 찍혔으면 한 번만 쓴다.
- 우리말 해석이 인쇄돼 있으면 translation 에 문장 순서대로 옮긴다.
- 영어 지문을 찾지 못하면 passage 를 빈 문자열로 두고 note 에 까닭을 쓴다."""


def read(files, fetch, settings, on_progress=None, log=None):
    """files: [{id, name, mime}], fetch(id) → 바이트. 읽어 낸 {title, source, passage, translation, note}"""
    import anthropic

    key = (settings.get('claude_key') or '').strip()
    if not key:
        raise ScriptError('Claude API 키가 없어요. 제작 엔진 설정에서 넣어 주세요.')
    if not files:
        raise ScriptError('읽을 사진이나 PDF가 없어요.')
    blocks = []
    for k, f in enumerate(files, 1):
        if on_progress:
            on_progress(5 + int(k / len(files) * 30), f'자료 받는 중 ({k}/{len(files)})')
        data = fetch(f['id'])
        mime = (f.get('mime') or '').lower()
        b64 = base64.b64encode(data).decode()
        blocks.append({'type': 'text', 'text': f'[{k}장째: {f.get("name") or "자료"}]'})
        if mime == 'application/pdf':
            blocks.append({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': b64}})
        elif mime in IMG_TYPES:
            if len(data) > MAX_IMAGE:
                raise ScriptError(f'사진 "{f.get("name")}"이 너무 커요. 다시 올려 주세요.')
            blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}})
        else:
            raise ScriptError(f'읽을 수 없는 파일이에요: {f.get("name")}')
    blocks.append({'type': 'text', 'text': '위 자료의 영어 지문을 글자 그대로 옮겨 read_passage 로 제출해 주세요.'})
    client = anthropic.Anthropic(api_key=key, max_retries=4, timeout=600)
    model = settings.get('claude_model') or 'claude-sonnet-5-5'
    if on_progress:
        on_progress(40, 'Claude가 사진에서 지문을 읽는 중')
    msg, block = _errors(lambda: claude.call_tool(client, model=model, system=SYSTEM, user=blocks, tool=TOOL, max_tokens=16000, log=log))
    if not block:
        raise ScriptError('Claude가 지문을 돌려주지 않았어요. 다시 시도해 주세요.')
    raw = block.input if isinstance(block.input, dict) else json.loads(block.input)
    out = {k: str(raw.get(k) or '').strip() for k in ('title', 'source', 'passage', 'translation', 'note')}
    if len(out['passage']) < 20:
        raise ScriptError(out['note'] or '사진에서 영어 지문을 찾지 못했어요. 지문이 잘 보이게 다시 찍어 주세요.')
    return out
