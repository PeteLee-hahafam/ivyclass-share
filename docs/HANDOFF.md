> 공개판에서는 원본 저장소의 `cloud/` 안 파일이 맨 위에 있고, `engine/` 은 그 옆에 있어요. 아래 경로에서 `cloud/` 는 빼고 보세요.

# 인수인계 문서

다음에 이 코드를 고칠 사람(또는 AI)을 위한 정리예요. 처음 보는 사람이 30분 안에 전체를 이해하는 것을 목표로 해요.

## 1. 전체 그림

```
학생 휴대폰 (설치형 웹 앱)      선생님 PC·휴대폰 (같은 사이트, 관리자 로그인)
        │                                   │
        └──────────── Cloudflare Worker (cloud/src) ────────────┐
                       │ D1 (데이터베이스)                         │ R2 (영상, PDF, 자막, 이름 목소리)
                       │                                          │
                  /api/engine/* (Bearer 연결 코드)                  │
                       │                                          │
               학원 PC 제작 엔진 (engine/ivy_engine) ───────────────┘
               Claude 대본 → 목소리(TTS) → Playwright로 /board 판서 장면 찍기 → ffmpeg 영상 → R2 나눠 올리기
               faster-whisper 자막, Claude 요약, 학생 이름 목소리, 자동 업데이트
```

## 2. 사이트 (cloud/)

### 인증
- 세션 쿠키 `ivy_s` (HttpOnly, SameSite=Lax). 관리자 14일, 학생 60일, 반 이상 지나면 연장.
- 비밀번호 PBKDF2-SHA256 10,000회 (무료 요금제 CPU 한도 때문에 이 정도).
- 브라우저의 GET 아닌 요청은 `X-Ivy: 1` 머리글 필수 (CSRF 막기).
- 처음 설정: 관리자가 없을 때만 `/api/setup`. `SETUP_CODE` 비밀값이 있으면 코드도 확인. 계정을 만들면 복구 코드를 바로 만들어 응답에 한 번만 담아요.
- 계정 되찾기: 복구 코드는 숫자 16자리, 비밀번호처럼 PBKDF2 해시로 `settings.recovery_hash`, `recovery_salt`, 만든 시각 `recovery_at` 에 둬요. 쓴 뒤에도 새로 만들기 전까지 계속 써요.
  - `POST /api/recover/check {code}` → 관리자 아이디 목록, `POST /api/recover/reset {code, user_id, password}` → 새 비밀번호, 그 계정의 세션 모두 지우고 새로 로그인.
  - `SETUP_CODE`(8자 이상)도 비상 코드로 받아요. 비상 코드로 되찾았거나 복구 코드가 없으면 새 복구 코드를 만들어 응답에 담아요(`recovery_code`, 예전 코드를 바꿨으면 `replaced`).
  - 시도 제한: 틀리면 `login_attempts` 의 `rc:ip:<IP>` 10분 8번, `rc:all` 10분 50번. 맞으면 그 IP 기록은 지워요.
  - `GET /api/admin/recovery` 복구 코드가 있는지(`ready`, `made_at`, `master`), `POST /api/admin/recovery {password}` 지금 비밀번호 확인 뒤 새로 만들기. 대시보드는 `recovery_ready` 를 보내서 없으면 '오늘' 할 일에 꼭 보여요.
  - 화면: `app.js Forgot`(로그인 화면의 '아이디나 비밀번호를 잊었어요'), `ui.js RecoveryCard`(복사, 카드만 인쇄), `teacher.js SettingsAccount`, `RecoveryModal`.
- 한/영 키 실수: 아이디는 영문·숫자만이라 한글이 섞이면 `ui.js hanToEng` 로 두벌식 자판 글자로 바꿔 보내요. 비밀번호에 한글이 있고 틀리면 바꾼 값으로 한 번 더 해 봐요. Caps Lock, 한글 입력은 칸 아래에 안내해요(`KeyWarn`). 아이디 비교는 대소문자를 가리지 않아요(`login_id COLLATE NOCASE`).
- 엔진: `Authorization: Bearer <토큰>`. 토큰은 sha256 으로만 저장 (`settings.engine_token_hash`). 연결 코드 형식 `ivy1.<사이트 주소 base64url>.<토큰>`.
- 파일 주소 서명: `/media/lecture/:id/:kind?e=만료&s=HMAC` (쿠키 없이 열리는 PDF 창 등).

### DB 표 (migrations/0001_init.sql, src/db.js 가 첫 요청 때 자동 적용)
- `settings` (key, value): 학원 이름, 시청 기준, 판서 스타일(JSON), 엔진 상태, link_secret, 복구 코드 해시(recovery_*)
- `classes`, `users`(role admin|student, call_name=강의에서 부를 이름), `sessions`, `login_attempts`
- `lectures`: status `queued → scripting → review → render_queued → rendering → done` (실패 `failed`, 올린 강의 `manual`)
  - `script` 대본 JSON, `options` 만들기 옵션 JSON, `*_key` R2 파일 위치
  - `voice` 그 강의를 만든 목소리 정보 JSON `{k, provider, voice, model, speed, tone, label}` (비밀 키 없음)
  - `name_slots` 이름 부르는 자리 `[{t, d}]` (초)
  - `edit` 편집 `{cuts: [[시작, 끝]], chapters: [{t, title}], strokes: [{t, d, c, w, k: pen|hl, p: [x,y,...]}]}` (p 는 영상 화면 기준 0~1000). AI 강의는 엔진이 단계별 목차를 보내 `auto_chapters: true` 로 넣어요. 선생님이 편집에서 저장하면 이 표시가 없어져서 다시 만들 때 덮어쓰지 않아요.
  - `transcript` 자막 원문 `[{s, e, text}]`, `summary` AI 요약 `{one_line, points, chapters, vocab, quiz}`
- `assignments` (반별 과제, 마감), `progress` (학생별 시청 비트맵 `bits` base64, 1초=1비트)
- `tasks` 엔진 작업 (`transcribe` 자막, `summarize` 요약). status `queued → running → done|failed`
- `name_clips` (user_id, voice=목소리 k) → R2 의 이름 목소리 파일

### 주요 API
- 선생님 `/api/admin/*`: dashboard(`?lite=1` 숫자만), classes, students(call_name), lectures(만들기·고치기·지우기·approve·rerender·retry·rescript·finish), lectures/:id/edit|summary|subtitle|tasks, tasks/:id(취소), assignments(`?class_id=` 그 반만, 안 본 학생 이름 포함), watch(.csv), settings, logo, engine-token, engine-installer(설치 .bat)
- 학생 `/api/student/*`: lectures, lectures/:id (편집 정보, 요약, 이름 정보 `{slots, text, clip}`), progress (잘라낸 구간 빼고 계산)
- 엔진 `/api/engine/*`: hello, next(강의 또는 작업), lectures/:id/progress|script|done|fail|video, tasks/:id/progress|done|fail, names/missing, names/:uid(PUT 음성 파일), logo
- 나눠 올리기 `/api/up/start|part|complete|abort` (관리자 또는 엔진)
- 파일 `/media/lecture/:id/(video|note|practice|thumb|subtitle)`, `/media/name/:lectureId` (로그인한 학생 자기 이름 목소리), `/media/logo`
- 엔진 업데이트 묶음 `/_engine/manifest.json|bundle.json|install.ps1` (엔진 토큰 필요)

### 화면
- `app.js` 로그인·처음 설정·역할별 화면, `teacher.js`, `student.js`, `editor.js`, `player.js`
- 선생님 화면(`teacher.js`) 주소: `#/` 오늘(챙길 일, 진행 중인 과제, 만드는 강의, 최근 시청), `#/lectures` 강의 목록(표지/목록 보기), `#/new` 새 강의(지문, `?mode=upload` 내 영상), `#/lecture/:id`, `#/review/:id`, `#/edit/:id`, `#/classes/:id/(students|watch)` 반(과제, 학생, 시청표), `#/settings/(board|engine|preview|account)` 설정
  - 위쪽 칠판 막대 메뉴 4개, 휴대폰은 아래 탭 4개 + 가운데 새 강의. `Ctrl+K` 빠른 찾기(`Palette`, 초성 검색 `ui.js matchScore`)
  - 과제 내기 창 `openAssign()`, 과제를 내면 `ivy:assigned`·`ivy:changed` 이벤트로 열린 화면이 새로 고쳐져요
  - 대시보드 API 는 과제마다 아직 다 보지 않은 학생 이름(`stats.pending`)을 같이 보내요. '알림 문구 복사'가 이걸로 단톡방 문구를 만들어요. 위쪽 메뉴 숫자는 `GET /api/admin/dashboard?lite=1`
- 판서 `board.js` 는 세 곳에서 같은 코드로 그려요: 검수 미리보기(preview), 엔진 영상(render 1920×1080), 판서노트 PDF(print)
  - 카메라 `{cx, cy, z}` (화면 가운데 판서 위치와 배율), `camFor(i)` 단계별 카메라, `setSpot` 설명하는 문장만 또렷하게
  - 표시마다 `setReveal(id, t)` (0~1), `syncPen()` 그리는 끝에 펜, `revealDur(id)` 그리는 시간
  - 상자 줄(메모·내용 정리·단어)은 왼쪽부터 쓰듯 나타나고, `flow`(글의 흐름)은 상자와 화살표를 펜으로 그려요
  - 2형식(`scPairs`): 동사(V) 바로 뒤 주격 보어(C, S.C)가 3단어까지면 동사와 보어를 한 동그라미로 묶어요(이름표 V, C는 따로). 3단어가 넘으면 동사는 동그라미, 보어는 괄호. 판서 스타일 `sc_circle`(기본 켬). 사이에 목적어가 있거나(5형식) 보어가 괄호(box)면 묶지 않아요. 예전 기본 규칙 줄은 `migrateRules`(board.js, util.js)가 새 문장으로 바꿔요
- 학생 플레이어 `player.js`: 노란 진행 바(본 곳), 목차 눈금, 자막(VTT 직접 그림), 잘라낸 곳 건너뛰기, 영상 위 그림(canvas), 이름 부르기(그 자리에서 영상 소리를 잠깐 끄고 이름 목소리를 틀고 말풍선)

## 3. 제작 엔진 (engine/)

### 강의 만들기
1. `scriptgen.generate`: Claude 도구 호출(make_lecture) 한 번으로 문장 표시, 상자, 글의 흐름, 연습지, 단계별 대본(say)을 받아요. 대본에 `{호명}` (이름 부르는 자리), ElevenLabs v4, v3이면 `[excited]` 같은 감정 표시.
   - Claude 부르기는 `claude.py call_tool` 한곳에서 해요(요약도 같이). Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1 은 도구를 꼭 부르게 하는 `tool_choice`(tool, any)를 400 오류로 거절해서 `auto` 와 시스템 지시로 부르게 해요. 처음 보는 모델이 같은 오류를 내면 auto 로 한 번 더, 도구를 안 부르고 글로만 답하면 한 번 더 부탁해요.
   - 5.x 모델은 생각하기(adaptive thinking)가 기본으로 켜져 있고 출력 토큰으로 값을 내요. Sonnet 5.5 는 `thinking: between_tools` 로 미리 생각하기를 꺼서 예전 값과 속도를 지켜요. Opus 5.5 는 끌 수 없어요. 생각하기도 `max_tokens` 안에 들어가서 5.x 는 두 배(최대 64000)로 둬요. 엔진 기록에 생각하기 토큰이 같이 나와요.
2. `media.build_audio`: 단계마다 목소리. ElevenLabs, Gemini, Typecast는 단계 통째로(자연스럽게), 나머지는 문장마다. `{호명}` 자리는 1.2초 비우고 '여러분'을 가운데 넣어요. ElevenLabs와 Typecast는 글자별 시간을 받아 판서 표시를 말과 정확히 맞춰요.
3. `media.open_board` → `/board` 를 headless Edge/Chrome으로 열어 대본을 그려요.
4. `media.build_timeline`: 카메라 이동, 자막 시간, 표시 그리는 시간(대본에서 그 말을 할 때, ElevenLabs는 글자별 시간으로 정확히), 이름 자리.
5. `media.render_frames`: 화면이 바뀔 때만 찍어 concat 목록 → ffmpeg(libx264, stillimage) → MP4.
6. 판서노트·연습지 PDF → R2 → `done` (목소리 정보, 이름 자리, 단계별 목차 `chapters`)

### 학생 이름 목소리
- 쉬는 동안 1분마다 `names/missing` → 강의를 만든 목소리(voice spec)로 "하준아," 를 만들어 앞뒤 무음 자르고 AAC(m4a)로 올려요. 학생 이름이나 부를 이름이 바뀌면 다시 만들어요.

### 자막·요약
- `stt.transcribe`: faster-whisper (기본 large-v3-turbo, int8). 모델은 `%LOCALAPPDATA%\IvyEngine\models` 에 처음 한 번 받아요.
- `summarize.generate`: Claude 도구 호출(make_summary). 올린 강의면 복습 노트 PDF(`practice.js renderStudy`)도 만들어 연습지 자리에 올려요.
- 선생님이 영상을 올리면 브라우저가 앞쪽 한 장면을 떠서 썸네일(`thumb`)로 함께 올려요 (`ui.js videoThumb`).

### 자동 업데이트
- 배포할 때 `cloud/scripts/pack-engine.mjs` 가 엔진 파일 해시 목록(manifest)과 묶음(bundle)을 만들어요.
- 엔진은 30분마다(시작할 때 바로) 비교해서 바뀐 파일만 바꾸고 `exit 3` → `launcher.py` 가 다시 켜요. requirements.txt 가 바뀌면 pip install.
- `.bat`, `.ps1` 은 실행 중에 바꾸면 위험해서 자동 업데이트하지 않아요(설치 파일을 다시 실행하면 바뀌어요).

### 설정 파일
`%LOCALAPPDATA%\IvyEngine\settings.json` (연결 코드, API 키, 목소리). 캐시 `cache/tts`(30일), 작업 폴더 `work`(2일) 자동 정리.

## 4. 다른 학원에 나눠 주기 (공개판)
- 원본(이 저장소, 비공개)과 공개판 `PeteLee-hahafam/ivyclass-share` 를 따로 둬요. 공개판은 `node share/publish.mjs <폴더>` 로 만들어요.
  - 구조: 원본 `cloud/*` → 공개판 맨 위, `engine/` → `engine/`, `docs/HANDOFF.md`. 원본 README·AGENTS·CLAUDE·DEPLOY·설치 배치 파일은 빼요.
  - `wrangler.toml` 의 `database_id` 는 빈 값(0000…)으로, `watch_dir` 는 `engine/ivy_engine` 으로. Cloudflare 설치 버튼(Deploy to Cloudflare)이 원장님 계정에 D1·R2를 새로 만들고 원장님 저장소의 설정 파일을 새 ID로 바꿔요.
  - `package.json` 의 `cloudflare.bindings` 설명과 `.dev.vars.example`(SETUP_CODE)은 설치 버튼 화면에 나와요.
  - `share/README.md`(원장님용 안내), `share/LICENSE`(이용 조건: 무료, 팔기 금지), `share/update.yml` → `.github/workflows/update.yml`, `share/update_from_upstream.py` → `scripts/update_from_upstream.py`, `.share-files`(공개판 파일 목록).
- 원장님 저장소의 자동 업데이트: 6시간마다 공개판을 받아 같은 내용으로 맞춰요. 학원마다 다른 `wrangler.toml` 의 사이트 이름, `database_name`, `database_id`, `bucket_name` 은 그대로 옮겨 넣고, `.github/` 는 건드리지 않아요. 예전 공개판에 있던 파일만 지워서 학원이 따로 넣은 파일은 남아요. GITHUB_TOKEN 으로는 `.github/workflows` 를 못 바꿔서 `update.yml` 은 처음 것이 계속 쓰여요.
- 원장님 저장소에 커밋이 올라가면 Cloudflare Workers Builds가 다시 배포하고, 학원 PC 엔진은 그 사이트에서 스스로 업데이트해요. DB 표는 새 칸·표를 더하기만 해서 기록은 그대로예요.

## 5. 알려진 한계와 다음 할 일
- 아이폰 Safari 의 '기본 전체 화면'에서는 영상 위 그림과 이름 말풍선이 안 보여요 (플레이어의 크게 보기 버튼은 괜찮아요).
- ElevenLabs 감정 표시는 한국어에서 효과가 고르지 않을 수 있어요. 엔진 설정에서 Multilingual v2 로 바꿀 수 있어요. 기본 목소리는 영어 원어민이라 한국어 목소리(보이스 라이브러리)를 권해요. 엔진은 글자별 시간(with-timestamps)을 못 받으면 소리만 받아 시간을 글자 수로 나눠요.
- 대화문·문법 개념 강의 도구는 아직 '곧 추가'예요 (`teacher.js TOOLS`).
- 더 아낄 수 있는 것: Claude Message Batches(50% 할인, 최대 24시간 대기)로 대본 만들기.
- 시험: `samples/maengsu.json` 대본으로 무음(test) 렌더, 플레이어 이름 부르기·잘라내기·그림 시험은 개발 중 Playwright로 확인했어요.
