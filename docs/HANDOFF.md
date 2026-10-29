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
  - 학년 `options.level`: `mid1`, `mid2`, `mid3`, `high1`, `high2`, `high3` (`util.js LECTURE_LEVELS`, 모르는 값은 high1). 새 강의와 내 영상 올리기에서 고르고(마지막에 고른 학년을 기억해요), 강의 화면의 '이름, 학년 바꾸기'로 바꿔요. 강의 목록은 학년별로 나눠 보고(`ivy.lgrade`), 과제 내기 창은 학년별로 묶어 보여요. 엔진에는 `engineOptions` 가 mid1, mid2 를 '중학교 1학년' 같은 이름으로 바꿔 보내요(1.4.0 이전 엔진도 알아듣게). 엔진은 `textutil.level_text`로 대본의 학생 수준을, `level_guide`로 확인 문제와 문제 은행의 난이도와 말투를 맞춰요(1.4.1부터)
  - `voice` 그 강의를 만든 목소리 정보 JSON `{k, provider, voice, model, speed, tone, label}` (비밀 키 없음)
  - `name_slots` 이름 부르는 자리 `[{t, d}]` (초)
  - `edit` 편집 `{cuts: [[시작, 끝]], chapters: [{t, title}], strokes: [{t, d, c, w, k: pen|hl, p: [x,y,...]}]}` (p 는 영상 화면 기준 0~1000). AI 강의는 엔진이 단계별 목차를 보내 `auto_chapters: true` 로 넣어요. 선생님이 편집에서 저장하면 이 표시가 없어져서 다시 만들 때 덮어쓰지 않아요.
  - `transcript` 자막 원문 `[{s, e, text}]`, `summary` AI 요약 `{one_line, points, chapters, vocab, quiz}`
- `assignments` (반별 과제, 마감, 0005부터 `closed_at`), `progress` (학생별 시청 비트맵 `bits` base64, 1초=1비트)
- `tasks` 엔진 작업 (`transcribe` 자막, `summarize` 요약, `quiz` 확인 문제, `bank` 문제 은행, `read` 교과서 사진 읽기, `ltwrite` 레벨테스트 라이팅 채점). status `queued → running → done|failed`. `payload`(작업에 넘길 것, 예: 읽을 자료 id, 만들 문항 수)와 `result`(사진에서 읽은 지문)는 0003부터
  - 엔진이 받는 순서(`api_engine.js claimTask`): `read` → `ltwrite` → 보통 작업 → 예전 강의 채우기(`payload` 에 `"backfill":true`). 같은 순서 안에서는 먼저 생긴 것부터라서, 예전 강의를 한꺼번에 채우는 중에도 새 강의의 확인 문제가 먼저 만들어져요
- `name_clips` (user_id, voice=목소리 k) → R2 의 이름 목소리 파일
- 0002: `lectures.quiz`(확인 문제 묶음), `quiz_attempts`
- 0003: `bank_items`(문제 은행 문항 하나가 한 줄, `data` 에 정답·해설까지, `score` 검사 점수, `source` ai|seed, `hidden` 선생님이 뺀 문제), `lectures.homework`(사이트 숙제 묶음, `bank_ids` 같이), `hw_attempts`(숙제 낸 기록, `hw_ver` 마다 한 번), `mock_attempts`(모의고사, 뽑은 문항 id 목록 `items`, 내면 `submitted_at`), `print_sets`(출력용 숙제지, 문항을 그대로 담아 둬서 정답지와 늘 같아요), `materials`(올린 자료: `passage` 교과서 사진·PDF, `seed` 문제 자료. 파일은 R2 `materials/…`, 붙여 넣은 글은 `text`)
- 설정 `academy_phone` 학원 전화번호(숙제지 머리글과 꼬리말)
- 0004: `lt_sessions`(레벨테스트 응시 하나가 한 줄: 학생 이름, 학년 1~12, 학교, 학부모 휴대폰, 진행 상태와 답 `state` JSON, `status` running|scoring|review|done, 목록용 요약 `summary`, 선생님 의견 `comment`, 학생 계정 `user_id`, 응시 열쇠 `token_hash`, 같은 곳 시작 횟수용 `ip_hash`, 선생님이 본 시각 `seen_at`). 설정 `lt_open`(링크로 받기, 기본 켬), `lt_preset`(기본 영역 묶음 이름이나 `voc,read` 같은 목록), `lt_books`(학원 교재 목록 JSON, 없으면 예시 교재)
- 0005: `assignments.closed_at`(선생님이 끝난 과제를 '목록에서 지우기' 한 때). 오늘 화면, 반 과제, 위쪽 메뉴 숫자, 시청표 기본 보기에서만 빠지고 학생 앱은 그대로예요(다 본 학생은 '다 본 강의'에서 다시 봐요). 같은 강의를 그 반에 다시 내면 NULL 로 돌아가요
- 0006: `exams`(시험: `title`, 문항을 정답과 해설까지 그대로 담은 `items` `{v, ver, items}`, 문항마다 어디서 왔는지 `src` `{k: quiz|bank, l: 강의, n: 확인 문제 번호, v: 그때 확인 문제 버전, id: 은행 문항, t: 강의 제목}`, 문제를 가져온 `lecture_ids`, `bank_ids`, 학생이 낸 뒤 정답과 해설을 보여 줄지 `reveal`), `exam_classes`(시험을 낸 반, `due_at`, 풀기 마감 `closed_at`), `exam_attempts`(학생마다 한 번, 선생님이 넣은 종이 답안은 `by_teacher = 1`)

### 주요 API
- 선생님 `/api/admin/*`: dashboard(`?lite=1` 숫자만), classes, students(call_name), lectures(만들기·고치기·지우기·approve·rerender·retry·rescript·finish), lectures/:id/edit|summary|subtitle|tasks, tasks/:id(취소), assignments(`?class_id=` 그 반만), watch(.csv, 강의마다 `closed_at`, 숙제 칸 `hw`), settings, logo, engine-token, engine-installer(설치 .bat)
  - 과제 현황 `classStats`(대시보드, 반 과제, 강의 화면이 같이 써요): `{total, watched, quiz, hw, done, partial, avg, pending}`. `watched` 시청 기준을 넘긴 학생, `quiz`/`hw` 지금 버전 확인 문제와 숙제를 낸 학생(없는 강의는 null), `done` 끝낸 학생(강의를 다 보고, 숙제가 있으면 숙제까지), `pending` 아직 끝내지 않은 학생 `[{id, name, percent, watched, quiz, hw}]` 60명까지. 목록에서 지운 과제는 `stats` 가 null
  - `POST /api/admin/assignments/close {ids, closed}`(목록에서 지우기, `closed: false` 면 다시 보이기), `PUT /api/admin/assignments/:id {due_at, note, closed}`(보낸 것만 바꿔요), `DELETE /api/admin/assignments/:id`(학생 앱에서도 빼기)
- 학생 `/api/student/*`: lectures, lectures/:id (편집 정보, 요약, 이름 정보 `{slots, text, clip}`), progress (잘라낸 구간 빼고 계산)
- 엔진 `/api/engine/*`: hello, next(강의 또는 작업), lectures/:id/progress|script|done|fail|video, tasks/:id/progress|done|fail, names/missing, names/:uid(PUT 음성 파일), logo, materials/:id/file(올린 자료 파일)
- 문제 은행 `src/api_bank.js`
  - 선생님: `GET/POST /api/admin/lectures/:id/bank`(문항과 쓰인 곳 `used`: hw, print, mock / 더 만들기), `PUT /api/admin/bank/:itemId {hidden}`(빼기), `GET/POST/DELETE /api/admin/lectures/:id/homework`(숙제, 다시 뽑기), `PUT/DELETE /api/admin/hw-attempts/:id`, `GET/POST /api/admin/lectures/:id/prints`(숙제지 목록, 새로 뽑기: 모자라면 409 `bank_more` 와 함께 은행 작업을 줄 세워요), `GET/DELETE /api/admin/prints/:id`(인쇄 화면이 쓰는 문항, 강의, 학원 이름·전화·로고), `GET /api/admin/lectures/:id/mock`(푼 기록, 모의고사에 나오는 문제 수 `pool`)
  - 예전 강의 채우기: `GET /api/admin/backfill`(완성 강의 중 확인 문제 없는 것 `quiz`, 문제 은행 없는 것 `bank`, 은행은 있는데 숙제 없는 것 `hw`, 그 강의 수 `lectures`, 줄 서 있거나 만드는 중인 채우기 작업 수 `working`), `POST /api/admin/backfill`(숙제는 바로 뽑고, 확인 문제와 은행은 `backfill` 표시를 붙여 줄 세워요. 대본도 자막도 없는 올린 강의는 건너뛰어요). 은행 작업이 끝나면 `ensureHomework` 가 숙제를 저절로 만들어요
  - 자료: `GET /api/admin/materials?lecture_id=`, `POST /api/admin/materials`(붙여 넣은 글), `PUT /api/admin/materials?purpose=&lecture_id=&name=`(파일 그대로, JPG·PNG·WebP·GIF·PDF·TXT, 20MB까지. 화면은 사진을 긴 변 2000px JPG로 줄여 올려요), `POST /api/admin/materials/read {ids}`(사진 읽기 작업, `task_id`), `POST /api/admin/materials/attach {lecture_id, ids}`, `GET/DELETE /api/admin/materials/:id(/file)`, `GET /api/admin/tasks/:id`(진행률과 결과)
  - 학생: `GET/POST /api/student/lectures/:id/homework`(한 번 내요), `GET/POST /api/student/lectures/:id/mock`(풀던 것 이어서 / 새로 뽑기, 전에 본 문제 수 `repeat` 와 새 문제를 만드는 중인지 `making`), `POST /api/student/mock/:aid`(내기. `aid` 0 은 선생님 미리보기라 채점만). 강의 화면 `GET /api/student/lectures/:id` 에 `homework`, `homework_result`, `mock` 요약이 같이 와요
- 시험 `src/api_exam.js` (확인 문제와 문제 은행에서 골라 만든 시험, 인쇄 문서, 반 성적표)
  - 선생님: `GET/POST /api/admin/exams`(목록: 문항 수, 낸 반, 푼 학생, 평균 / 만들기 `{title, picks, reveal}`), `GET/PUT/DELETE /api/admin/exams/:id`(결과 `attempts`, 안 푼 학생 `pending`, 문항마다 맞힌 수 `right`, 반마다 `done`·`avg` / `{title, reveal, picks}` 문제 바꾸기는 푼 학생이 없을 때만, 409 `has_attempts`), `POST /api/admin/exams/:id/classes {class_ids, due_at}`(반에 내기, 다시 내면 마감만 바뀌고 다시 열려요), `PUT|DELETE /api/admin/exams/:id/classes/:cid {due_at, closed}`(마감, 풀기 마감과 다시 열기 / 학생 앱에서 빼기), `POST /api/admin/exams/:id/attempts {user_id, answers}`(종이 답안 넣기, 같은 학생은 덮어써요), `GET/PUT/DELETE /api/admin/exam-attempts/:id`(답안 보기, 서술형 맞음 바꾸기, 다시 풀게 하기)
  - 고른 문제 `picks`: `{k:'quiz', l, n, v}` 확인 문제(버전이 바뀌었으면 빠지고 `dropped` 로 세요), `{k:'bank', l, id}` 문제 은행, `{k:'exam', e, n}` 다른 시험 문항 그대로(고치기, 복사). 서버가 지금 문제에서 정답과 해설을 다시 꺼내고 객관식 먼저, 서술형 뒤로 번호를 매겨요. 60문항까지
  - 시험 만들기 화면 `GET /api/admin/lectures/:id/pool`(강의 하나의 확인 문제와 숨기지 않은 은행 문제, 은행 문제가 쓰인 곳 `used`: hw, print, exam, mock)
  - 인쇄 문서: `GET /api/admin/lectures/:id/quiz/print`(확인 문제 그대로), `GET /api/admin/exams/:id/print`, `GET /api/admin/prints/:id` 도 `doc` 을 같이 보내요. `doc = {kind, title, label, what, kicker, date, items, file}`
  - 반 성적표 `GET /api/admin/classes/:id/scores(.csv)`: `{students, cols, cells}`. 칸 `cols` 은 이 반에 낸 시험과 이 반 학생 답안이 있는 시험(`e<id>`), 과제로 낸 강의의 확인 문제(`q<id>`)와 숙제(`h<id>`), 최근 것부터. `closed` 는 목록에서 지운 과제나 풀기 마감한 시험. 셀을 누르면 `GET /api/admin/quiz-attempts/:id`, `hw-attempts/:id`, `exam-attempts/:id` 로 답안을 열어요
  - 학생: `GET/POST /api/student/exams/:id`(반에 낸 시험이거나 선생님이 종이 답안을 넣은 시험만. 한 번 내요. 풀기 마감이면 문제를 안 보내고 409 `closed`. `reveal` 이 꺼져 있으면 낸 뒤에 점수만). 학생 홈 `GET /api/student/lectures` 에 `exams` 가 같이 와요
  - 시험에 쓴 은행 문제는 숙제지에 쓴 문제처럼 숙제, 숙제지, 모의고사에 다시 나오지 않아요(`bank.js reserved`). 반을 지우면 그 반에 낸 기록(`exam_classes`)도 지워요
- 레벨테스트 `src/api_lt.js` (정답과 채점은 `src/lt` 에서만, 학생에게는 정답을 뺀 문항만)
  - 학생(로그인 없이): `GET /api/lt/info?p=new|all|read` 또는 `?m=voc,read`(학원 이름, 전화, 로고, 볼 영역, 로그인한 재원생이면 이름과 학년), `POST /api/lt/start {name, grade, school, years, phone, consent, mods}` → `{token, view}`, 그다음은 머리글 `X-LT-Token` 으로 `GET /api/lt/me`, `POST /api/lt/block {mod, key, answers, times}`(블록 하나: 어휘 4낱말, 나머지 3문항), `POST /api/lt/write {answers, times}`, `POST /api/lt/skip {mod:'listen'}`(소리가 안 날 때). 지금 블록이 아닌 답은 409 `lt_stale`. 같은 곳(IP 해시)에서 한 시간 20번, 하루 전체 400번까지 시작해요(로그인한 학생과 선생님은 IP 제한 없음)
  - 선생님: `GET/PUT /api/admin/lt`(받기, 기본 묶음, 교재 목록, 결과 목록 300개. 열 때 계정과 잇지 않은 6개월 지난 기록과 일주일 지난 미완료 응시를 지워요. 오늘 화면을 열 때도), `GET /api/admin/lt/:id`(영역별 자세한 기록 `detail`, 라이팅 채점 상태, 리포트 HTML `html`, 카톡 문구 `msg`, PDF 파일 이름. 열면 `seen_at`), `PUT /api/admin/lt/:id {comment | book:{skill,name} | scoring | user_id}`, `POST /api/admin/lt/:id/rescore`, `DELETE`. 대시보드 `counts.lt_new` 는 아직 안 본 결과 수
- 나눠 올리기 `/api/up/start|part|complete|abort` (관리자 또는 엔진)
- 파일 `/media/lecture/:id/(video|note|practice|thumb|subtitle)`, `/media/name/:lectureId` (로그인한 학생 자기 이름 목소리), `/media/logo`
- 엔진 업데이트 묶음 `/_engine/manifest.json|bundle.json|install.ps1` (엔진 토큰 필요)

### 화면
- `app.js` 로그인·처음 설정·역할별 화면, `teacher.js`, `student.js`, `editor.js`, `player.js`
- 선생님 화면(`teacher.js`) 주소: `#/` 오늘(챙길 일, 진행 중인 과제, 만드는 강의, 최근 시청), `#/lectures` 강의 목록(표지/목록 보기), `#/new` 새 강의(지문, `?mode=upload` 내 영상), `#/lecture/:id`, `#/review/:id`, `#/edit/:id`, `#/classes/:id/(students|watch)` 반(과제, 학생, 시청표), `#/settings/(board|engine|preview|account)` 설정
  - 위쪽 칠판 막대 메뉴 4개, 휴대폰은 아래 탭 4개 + 가운데 새 강의. `Ctrl+K` 빠른 찾기(`Palette`, 초성 검색 `ui.js matchScore`)
  - 과제 내기 창 `openAssign()`, 과제를 내면 `ivy:assigned`·`ivy:changed` 이벤트로 열린 화면이 새로 고쳐져요
  - 대시보드 API 는 과제마다 아직 끝내지 않은 학생(`stats.pending`, 빠진 것: 강의, 숙제)을 같이 보내요. '알림 문구 복사'가 이걸로 단톡방 문구를 만들어요(`missText`: "김하준(강의, 숙제)", 숙제 없는 강의는 이름만). 위쪽 메뉴 숫자는 `GET /api/admin/dashboard?lite=1`
  - 반 → 과제(`ClassAssign`, `AsgRow`): 과제마다 'n/m명 끝냄' 막대, 강의, 확인 문제, 숙제를 한 학생 수, 남은 학생과 빠진 것. 모두 끝낸 과제는 위 알림의 '모두 목록에서 지우기'나 줄마다 '목록에서 지우기'로 정리하고, 아래 '목록에서 지운 과제'(접힘)에서 다시 보이기와 학생 앱에서도 지우기(휴지통, 확인 창)를 해요. 강의 화면의 과제 칸도 지운 과제에 '다시 보이기'가 있어요
  - 시청표(`ClassWatch`): 칸마다 시청률, 확인 문제, 숙제 점수(`.hcell`). 머리에 'n/m 끝냄'. 목록에서 지운 과제는 '목록에서 지운 과제도 보기'를 켜야 보여요. 엑셀에는 숙제 열이 같이 나가요
  - 강의 목록 위 `BackfillBar`: 확인 문제나 숙제가 없는 예전 강의가 있으면 노란 알림과 '한 번에 만들기', 만드는 중이면 남은 작업 수를 보여요
  - 학생 앱 강의 카드(`student.js LectureCard`): 다 본 강의에 확인 문제 점수와 숙제 점수(안 냈으면 노란 '숙제 안 냈어요')
  - 시험(`exams.js`, 강의 목록 머리의 '시험' 버튼): `#/exams` 목록, `#/exams/new` 시험 만들기(`?l=강의`로 그 강의를 골라 두고 열어요. 강의 화면 확인 문제 칸과 모의고사 칸의 '골라서 시험 만들기'), `?from=시험` 복사, `#/exams/:id/edit` 문제 고치기, `#/exams/:id` 시험 하나(결과, 많이 틀린 문제, 문항별 정답률, 낸 반, 종이 답안 넣기, 정답 공개, 인쇄)
    - 만들기 화면(`ExamBuilder`, `PoolCard`): 강의마다 확인 문제와 문제 은행 탭, 객관식과 서술형 거르기, 보이는 문제 모두 고르기, 문제 자세히 보기. 오른쪽에 고른 문제와 '골고루 채우기'(강의마다 돌아가며 유형을 섞어, 안 쓴 은행 문제, 확인 문제, 숙제나 모의고사에 쓴 은행 문제 차례). 휴대폰은 아래 막대에 만들기 버튼
    - 종이 답안 넣기(`PaperModal`): 학생을 고르고 객관식 답을 "31524 15234"처럼 이어서 치면 칸마다 맞으면 초록, 틀리면 빨강. 서술형은 학생이 쓴 그대로. '저장하고 다음 학생'은 시험을 낸 반의 안 푼 학생으로 넘어가요
  - 반 → 성적(`ClassScores`): 학생마다 시험, 확인 문제, 숙제 점수와 평균(80% 이상 초록, 60% 아래 빨강). 머리를 누르면 시험이나 강의 화면, 점수를 누르면 답안. '시험 내기'는 만든 시험을 골라 이 반에 내요. 엑셀로 받기
  - 학생 앱: 홈에 '시험'(풀 것 먼저, 푼 것은 2주 동안), '다 본 강의'에 푼 시험. `#/exam/:id` 는 `quizview.js StudentQuiz kind="exam"`
- 판서 `board.js` 는 세 곳에서 같은 코드로 그려요: 검수 미리보기(preview), 엔진 영상(render 1920×1080), 판서노트 PDF(print)
  - 워터마크(설정의 학원 로고, 둘레 빈 여백은 `trimLogo` 가 잘라요): 기울이지 않고 정중앙에 흐리게. 영상·미리보기는 한 변 540px(화면 세로의 절반, `.bd-water`), PDF(판서노트·연습지·복습 노트)는 쪽마다 A4 정중앙에 한 변 148.5mm(A4 세로의 절반) 정사각형(`printWatermark`, `.bd-pwater`, 인쇄할 때 `position: fixed` 가 쪽마다 찍혀요). 판서노트는 0.44배로 줄여 찍어서 엔진이 `pageScale` 을 같이 넘겨요(`media.NOTE_PDF_SCALE`)
  - 카메라 `{cx, cy, z}` (화면 가운데 판서 위치와 배율), `camFor(i)` 단계별 카메라, `setSpot` 설명하는 문장만 또렷하게
  - 표시마다 `setReveal(id, t)` (0~1), `syncPen()` 그리는 끝에 펜, `revealDur(id)` 그리는 시간
  - 상자 줄(메모·내용 정리·단어)은 왼쪽부터 쓰듯 나타나고, `flow`(글의 흐름)은 상자와 화살표를 펜으로 그려요
  - 2형식(`scPairs`): 동사(V) 바로 뒤 주격 보어(C, S.C)가 3단어까지면 동사와 보어를 한 동그라미로 묶어요(이름표 V, C는 따로). 3단어가 넘으면 동사는 동그라미, 보어는 괄호. 판서 스타일 `sc_circle`(기본 켬). 사이에 목적어가 있거나(5형식) 보어가 괄호(box)면 묶지 않아요. 예전 기본 규칙 줄은 `migrateRules`(board.js, util.js)가 새 문장으로 바꿔요
  - 판서 규칙 버전(`rules_v`, 지금 4): 새 기본 규칙은 `RULES_ADDED[버전]`(board.js, util.js 둘 다)에 더해요. 예전에 저장한 규칙에는 `migrateRules(text, rules_v)` 가 한 번만 더하고, 선생님이 저장하면 `rules_v` 가 올라가서 지운 줄은 다시 들어오지 않아요. 문구를 바꾼 줄은 `OLD_RULE_LINES` 로 바꿔요. 버전 2: 괄호 안은 사선만(긴 절에서 자연스럽게 쉬는 곳), 문장 뒤 분사구문은 괄호 없이 분사를 동사처럼(그리고/그래서), 의문문(의문사 괄호, 주어 은/는/이/가, 주어 다음 말 동그라미 ~니?/~까?), 도치(앞으로 나온 말 괄호, 나머지는 의문문처럼). 버전 3: 부사·전치사구 수식어는 괄호, 이어지면 통으로. 버전 4: 판서는 해석 기준, 동사는 조동사·사이 부사까지 한 동그라미(현재완료 have~p.p. 포함), 동그라미는 동사만(접속부사는 괄호), 문두 전명구(For example 등) 괄호, 주어 없이 동사로 이어지는 병렬도 세모, 긴 주절 주어 뒤 사선, 의문문·도치는 앞의 be동사·조동사를 주어와 함께 밑줄, 소제목은 따로
  - 괄호 안은 사선만(`parenRules`): 괄호(box, 또는 길어서 괄호가 되는 S·O) 안에 들어간 under·circle·box·triangle 은 그리지 않아요(note·hl·arrow 는 그려요). 사선은 괄호 안, 그리고 긴 주절 주어 뒤(`subjSlash`: 주어부터 사선까지 5단어 이상, 바로 뒤 2단어 안에 V)에만 그려요. 동사 동그라미 안에 들어간 괄호·밑줄도 그리지 않아요
  - 해석 덩어리(`joinChunks`, 그리기 전에 표시 범위를 넓혀요): V 표시 앞의 조동사(will, have, had, been …)와 사이 부사(also, never, -ly, 부사 괄호)를 동사 동그라미에 넣어요(will (also) search → will also search, have (already) finished). 조동사만 따로 V 로 표시돼 있으면 합쳐요. 의문문·도치·문장 첫 조동사는 주어 밑줄에 넣고(Did + the students), 의문문에서 주어 바로 뒤 부사는 동사 동그라미에 넣어요(ever seen). 주어 길이(`coreWords`)를 셀 때 앞 조동사는 빼요. 예전 대본도 화면에서 이렇게 보여요
  - 동그라미는 동사만(`kindOf`): 이름표가 V 가 아닌 circle 표시(접속부사·신호어 등)는 기본 스타일에서 괄호로 그려요
  - 소제목(`sentences[].heading`): 엔진 `textutil.split_passage` 가 `## ` 줄과 따로 한 줄에 있는 소제목(제목처럼 대문자로 시작하는 짧은 줄)을 떼고, 문장에 붙어 버린 소제목은 자료 검토(`review_material`의 head_prefix)나 대본 Claude의 `heading` 으로 `strip_heading` 해서 떼요. 판서에서는 그 문장 위(`.bd-subhead`)에 써요
  - 새 강의 자료 정리(`material.js`, 엔진 `textutil` 과 같은 규칙): 여러 줄을 붙여 넣으면 `prepareMaterial` 이 바로 정리해요(되돌리기 있음). 쪽·줄 번호만 있는 줄, `*` 어휘 풀이, `Q1.` 문제, 한글이 많은 줄(`noiseLine`)은 빼고, 소제목은 `## 소제목` 줄로 떼고(`titleLike` 대문자 제목, `shortHead` 7단어 이하 문장꼴), PDF처럼 끊긴 줄은 문단으로 이어요. `outline` 이 소제목·문단·문장 수를 세고, 20문장부터 `planParts` 가 소제목(없으면 문단, 길면 문장)마다 8~20문장으로 나눠요. 30문장이 넘으면 '나눠서 강의 N개 만들기'가 저절로 켜지고 40문장이 넘으면 꼭 나눠요. 나누면 강의마다 `POST /api/admin/lectures` 를 차례로 보내고 제목 뒤에 'N부', 출처 뒤에 '(N/전체)'를 붙여요. 해석은 문장 수가 같을 때만 부마다 나눠요(`splitTranslation`)
  - 아래쪽 상자는 메모, 내용 정리, 글의 흐름, 핵심 단어(유의어 `.sy` 파랑 =, 반의어 `.an` 빨강 ↔. 있으면 한 줄에 하나씩 넓게), 변형 포인트(`.bd-exam`, 유형 이름표 `.k`, 글에 'N번'이 없을 때만 오른쪽에 문장 번호) 순서예요. 단계 view 와 상자: summary→`sum`, memo→`memo`, flow→`flow`, vocab→`voc`, exam→`exam`(`camFor`). 연습지 정답의 단어 뜻에도 유의어·반의어가 붙어요(`practice.js`)
  - 띄우기: 사선 자리 `.sl-gap`(0.5em), 긴 주어 뒤 사선 `.sl-gap2`(1.15em), 닫는 괄호·동그라미 뒤 문장부호 `.pn-gap`(0.3em), 빈칸 하나(또는 쉼표)를 두고 붙은 괄호·동그라미 `.mk-gap`(0.22em), 테두리 앞뒤 낱말 `.rm-gap`(0.14em), 세모 앞뒤 `.tr-gap`·`.tr-gap2`. 표시가 겹치지 않게 낱말 자리를 조금 넓혀요
- 학생 플레이어 `player.js`: 노란 진행 바(본 곳), 목차 눈금, 자막(VTT 직접 그림), 잘라낸 곳 건너뛰기, 영상 위 그림(canvas), 이름 부르기(그 자리에서 영상 소리를 잠깐 끄고 이름 목소리를 틀고 말풍선)
- 숙제, 모의고사, 문제 자료: 선생님 강의 화면(`#/lecture/:id`)의 `bankcards.js` 카드 셋. `HomeworkCard`(낸 학생, 답안 보기와 서술형 맞음 바꾸기, 다른 문제로 다시 뽑기, 출력용 숙제지 만들기와 목록), `MockCard`(모의고사에 나오는 문제 수, 푼 기록, 문제 은행 창 `BankModal` 에서 억지 문제 빼기), `MaterialsCard`(문제 자료 올리기, 붙여 넣기, 이 자료로 문제 더 만들기, 강의를 만들 때 올린 사진 보기와 지우기). 학생 화면은 `quizview.js` 의 `HomeworkEntry`·`MockEntry`(강의 화면 칸), `StudentQuiz kind="hw"`(`#/hw/:id`), `StudentMock`(`#/mock/:id`, 처음 화면과 지난 기록, 풀기, 해설, 새 문제로 또 풀기)
- 인쇄 화면 `print.html#번호`(선생님 로그인 필요, `#12` 출력용 숙제지, `#q12` 강의 12번의 확인 문제, `#e12` 시험 12번): `printsheet.js` 가 서버의 `doc`(제목, 숙제지 3이나 확인 문제나 시험지 같은 이름표, 출처 줄)으로 문항을 블록으로 만들어 A4 2단에 흘려요. 쓰인 글자를 모두 담은 글꼴 조각을 먼저 받은 다음 재요(`loadFonts`). 단 끝에 걸리면 다음 단으로(영역 머리 `keep` 은 다음 문항과 같이), 빈 단에도 안 들어가면 글자를 조금 줄이고(`tight`), 그래도 넘치면 그 문항만 한 쪽 전체 너비로. 보기는 한 줄에 5개, 3개, 2개, 1개 중 넘치지 않는 것으로(`layoutChoices`). 단을 채우게 문항 사이를 고르게 벌리고 빈 쪽은 지워요. 묶음은 시험지와 답안지(`g-exam`), 정답과 해설(`g-key`)이고 인쇄 버튼이 `body[data-print]` 로 고른 묶음만 찍어요(마지막 쪽 뒤에 빈 종이가 나오지 않게 `.page.last`). 좁은 화면은 쪽을 나눈 다음 통째로 줄여 보여 줘요(`fitScreen`)
- 레벨테스트
  - 학생 화면 `/lt`(`public/lt.html`, `assets/lt/lt.js`·`lt.css`·`pics.js`·`fonts.css`, 반 강의실과 따로인 밝은 배색): 응시 정보와 개인정보 동의 → 영역마다 안내 → 문항마다 제한 시간(시간이 끝나면 '시간 초과'로 다음 문항) → 블록마다 서버로 보내 다음 블록을 받아요. 응시 열쇠와 블록 안에서 푼 데까지는 그 기기 `localStorage`(`ivy.lt.token`, `ivy.lt.part`)에 둬서 새로 고쳐도 이어서 봐요. 듣기는 기기의 영어 목소리(speechSynthesis)로 학생이 '듣기 시작'을 눌러 들어요(초등 단계는 두 번). 소리가 안 나면 듣기를 건너뛰어요. 글쓰기 칸은 붙여 넣기를 막아요. 서비스 워커는 `/lt`, `/lt-report`, `/print` 를 건드리지 않아요
  - 선생님 화면 `#/classes/lt`(반 화면 왼쪽 '상담' 아래, `assets/lt/admin.js`·`admin.css`·`report.css` 를 그때 불러요): 시험 링크(볼 영역 고르기, 링크 복사, 안내 문구 복사, 받기 켜고 끄기), 결과 목록(새 결과는 노란 점, 위쪽 메뉴 '반'과 오늘 할 일에 숫자), 교재 목록 창. `#/classes/lt/:id` 한 학생 결과: 종합 레벨과 지수, 영역별 레벨, 영역 탭(문항 기록과 정답, 리딩 경로, 라이팅 채점 칸: 조건 영작 0~2점, 글쓰기 기준마다 1~5점, 한 줄 평), 어머니께 보내기(영역별 교재 고르기, 선생님 의견, 리포트 PDF, 카톡 문구), 학생 계정과 잇기
  - 리포트 `/lt-report#결과번호`(선생님 로그인 필요, `assets/lt/report-page.js`): 서버가 만든 A4 세 장(로고, 정중앙 워터마크)을 늘어놓고 'PDF로 저장'으로 인쇄 창을 열어요. 창 제목이 PDF 파일 이름(`이름_영어레벨테스트_날짜`)이 돼요
  - 서버 `src/lt/core.js`: 예시 화면에서 옮긴 문제 은행(리딩 12단계, 어휘 9구간, 문법·듣기 12단계, 라이팅 A·B·C), 채점, 계단식 진행(`ltNext`, `ltVocNext`), 영역별 분석, 종합 레벨(가중 평균), CEFR·렉사일·AR 참고표, 교재 고르기, 의견 초안, 리포트 HTML(`ltReport2HTML`). `src/lt/flow.js`: 응시 상태 넘기기(`newState`, `submitBlock`, `submitWrite`, `skipModule`), 학생에게 보낼 모양(`publicView`), 선생님 채점과 교재 고르기, 엔진에 줄 라이팅 자료(`writePayload`)와 받은 채점 다듬기(`cleanScoring`). `src/lt/admin.js`: 선생님 결과 화면의 문항 기록 HTML
  - 라이팅 A(초1~초4)는 자동 채점, B·C 는 끝나면 `ltwrite` 작업을 줄 세워 엔진(1.5.0부터)의 Claude가 채점해요. 엔진이 실패하면 `review`(라이팅 직접 채점)가 되고, 선생님이 점수를 고르면 끝나요. 선생님이 채점한 뒤에 온 엔진 결과는 덮어쓰지 않아요
- 새 강의 화면의 '사진, PDF로 넣기': 올린 자료로 사진 읽기 작업을 걸고 2.5초마다 `GET /api/admin/tasks/:id` 를 봐요. 끝나면 지문 칸(제목, 출처, 해석이 비어 있으면 그것도)을 채워요. 지문 칸에 글이 있으면 바꿀지 먼저 물어요

## 3. 제작 엔진 (engine/)

### 강의 만들기
1. 자료 검토(`scriptgen.review_material`, 강의 옵션 `review`(기본 켬)): 대본 전에 Claude 도구 호출(review_material, 작은 출력) 한 번으로 번호 문장마다 drop(문제·지시문·어휘 풀이·그림 설명 등 본문 아님)·heading(문장 전체가 소제목)·head_prefix(문장 앞에 붙은 소제목)·cut(줄 번호 같은 군더더기, 어법 표시 ①~⑤·(A)는 안 지움)을 받아 고쳐요. 본문을 너무 많이 빼면(남는 문장이 3개 미만이거나 4분의 1 미만) 검토를 버려요. 키·권한·크레딧 오류가 아니면 검토 없이 계속 만들어요. 결과는 `script.material`({headings, removed, cuts})로 넣어 검수·강의 화면(`MaterialNote`)에 보여요. 40문장이 넘으면 나눠 만들라고 안내해요
2. `scriptgen.generate`: Claude 도구 호출(make_lecture) 한 번으로 문장 표시, 상자, 글의 흐름, 연습지, 단계별 대본(say)을 받아요. 대본에 `{호명}` (이름 부르는 자리), ElevenLabs v4, v3이면 `[excited]` 같은 감정 표시.
   - 상자: memo(메모), summary(내용 정리), flow(글의 흐름), vocab(핵심 단어, 1.4.0부터 단어마다 유의어 `syn`, 반의어 `ant` 영어 3개까지), exam(변형 포인트, 1.4.0부터: 이 지문이 내신에서 어떻게 변형돼 나올지 `{id, k: 유형, text, n: 문장 번호}` 4~6줄). 단계 순서는 … memo → vocab → exam → review 이고, exam 단계가 없으면 `finalize` 가 마무리 앞에 짧게 넣어요(대본에는 기호를 빼요). 예전 대본(syn, ant, exam 없음)도 그대로 그려져요. 확인 문제(`quizgen`)와 문제 은행(`bankgen`)이 이 유의어·반의어와 변형 포인트를 문제 만들 때 써요
   - Claude 부르기는 `claude.py call_tool` 한곳에서 해요(요약도 같이). Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1 은 도구를 꼭 부르게 하는 `tool_choice`(tool, any)를 400 오류로 거절해서 `auto` 와 시스템 지시로 부르게 해요. 처음 보는 모델이 같은 오류를 내면 auto 로 한 번 더, 도구를 안 부르고 글로만 답하면 한 번 더 부탁해요.
   - 5.x 모델은 생각하기(adaptive thinking)가 기본으로 켜져 있고 출력 토큰으로 값을 내요. Sonnet 5.5 는 `thinking: between_tools` 로 미리 생각하기를 꺼서 예전 값과 속도를 지켜요. Opus 5.5 는 끌 수 없어요. 생각하기도 `max_tokens` 안에 들어가서 5.x 는 두 배(최대 64000)로 둬요. 엔진 기록에 생각하기 토큰이 같이 나와요.
   - 말투(`options.tone`, 설정 '학원 정보'의 기본값 `default_tone`): `banmal` 반말 강의체, `banjon` 반존대(존댓말 바탕에 반말을 섞어요), `jondaet` 존댓말. 이름 부르기는 반말·반존대가 '하준아', 존댓말이 '하준 학생'(`util.js callText`). 예전 엔진은 모르는 말투를 반말로 만들어요.
3. `media.build_audio`: 단계마다 목소리. ElevenLabs, Gemini, Typecast는 단계 통째로(자연스럽게), 나머지는 문장마다. `{호명}` 자리는 1.2초 비우고 '여러분'을 가운데 넣어요. ElevenLabs와 Typecast는 글자별 시간을 받아 판서 표시를 말과 정확히 맞춰요.
4. `media.open_board` → `/board` 를 headless Edge/Chrome으로 열어 대본을 그려요.
5. `media.build_timeline`: 카메라 이동, 자막 시간, 표시 그리는 시간(대본에서 그 말을 할 때, ElevenLabs는 글자별 시간으로 정확히), 이름 자리.
6. `media.render_frames`: 화면이 바뀔 때만 찍어 concat 목록 → ffmpeg(libx264, stillimage) → MP4.
7. 판서노트·연습지 PDF → R2 → `done` (목소리 정보, 이름 자리, 단계별 목차 `chapters`)

### 학생 이름 목소리
- 쉬는 동안 1분마다 `names/missing` → 강의를 만든 목소리(voice spec)로 "하준아," 를 만들어 앞뒤 무음 자르고 AAC(m4a)로 올려요. 학생 이름이나 부를 이름이 바뀌면 다시 만들어요.

### 자막·요약
- `stt.transcribe`: faster-whisper (기본 large-v3-turbo, int8). 모델은 `%LOCALAPPDATA%\IvyEngine\models` 에 처음 한 번 받아요.
- `summarize.generate`: Claude 도구 호출(make_summary). 올린 강의면 복습 노트 PDF(`practice.js renderStudy`)도 만들어 연습지 자리에 올려요.
- `quizgen.generate`: 확인 문제. 1.2.0부터 모두 객관식(폰이나 PC에서 바로 풀고 바로 채점)이에요. 대본이면 지문 문장과 해석, 선생님이 한 말(say), 단어(동의어·반의어), 내용 정리, 메모, 변형 포인트, 흐름을, 올린 강의면 자막(과 지문)을 줘요.
  1. `make_quiz` 로 영역마다 넉넉히 31문항(어휘 7, 문법 9, 해석 4, 내용 8, 변형 3)을 받아요. `problems`/`item_problems` 로 모양(보기 5개, 같은 보기, 정답 번호, 밑줄 짝, ①~⑤ 보기와 text 번호, 해설의 보기 번호)을 검사해 틀리면 한 번 더 부탁해요.
  2. `review_quiz` 검사: 출제자 정답과 해설을 가리고 강의 내용만으로 직접 풀게 해요(`solved` 1~5, 답이 애매하면 0), 점수 1~5, drop 이유. 다르게 풀린 문항, drop, 2점 이하는 빼요(`scored`). 검사 호출이 실패하면 검사 없이 골라요.
  3. `choose`: 영역별 25문항(어휘 6, 문법 7, 해석 3, 내용 7, 변형 2)을 점수 순으로 골라요. 25개가 안 되거나 한 영역이 2개 이상 모자라면 모자란 영역만 한 번 더 만들어 검사해요.
  4. `balance` 로 정답 번호가 몰리면 보기를 맞바꿔요(①~⑤나 (A)-(B)-(C)처럼 차례가 있는 보기, 해설에 보기 번호가 있는 문항은 그대로). 영역 `translate`(해석), `variant`(변형: 빈칸, 순서, 문장 위치, 요약문)가 새로 생겼고, 순서 문항은 text 에 줄바꿈(\n)을 써요. 밑줄 다섯 곳 중 고르기와 문장 위치는 보기가 `①`~`⑤` 뿐이에요(화면은 `markOnly` 로 번호를 한 번만 보여 줘요).
  - 예전 엔진이 만든 문제(객관식 20 + 서술형 5, `word`·`fix`·`form`·`blank`·`refer`)도 그대로 풀고 채점돼요. 예시: `engine/samples/maengsu_quiz.json`
  - 사이트 `src/quiz.js`: `cleanQuiz`(저장 모양, `ver` 는 만든 시각), `publicQuiz`(학생에게 정답 빼고), `gradeAll`/`autoGrade`(객관식은 번호, 서술형은 대소문자·따옴표·마침표·띄어쓰기를 봐주고 accept 도 맞음, 단어·빈칸·가리키는 말은 앞 관사 차이도 봐줘요, fix 는 기호와 고친 말 둘 다). 채점 값 1 맞음, 0 틀림, 2·3 선생님이 맞음·틀림으로 바꿈
  - 학생: `GET/POST /api/student/lectures/:id/quiz` (한 번만 내요, 다시 내면 처음 기록을 돌려줘요. 선생님 미리보기는 채점만 하고 남기지 않아요). 화면 `quizview.js` (`StudentQuiz` 풀기·해설, `QuizEntry` 강의 화면 칸, 푸는 중인 답은 그 기기 브라우저에 잠깐 저장)
  - 선생님: `GET/DELETE /api/admin/lectures/:id/quiz`(문제, 푼 학생, 안 푼 학생, 문항별 맞힌 수), `PUT/DELETE /api/admin/quiz-attempts/:id`(서술형 맞음·틀림 바꾸기, 다시 풀게 하기), 다시 만들기는 `POST /api/admin/lectures/:id/tasks {kind:'quiz'}`. 새로 만들면 `ver` 가 바뀌어 예전 점수는 시청표에서 빠지고(기록은 남아요) 학생은 새로 풀어요. 시청표·엑셀·학생별 기록에 점수가 같이 나와요
- `bankgen.generate`(문제 은행, 1.3.0): 지문, 해석, 강의 대본 내용(단어 동의어·반의어, 변형 포인트 등)과 선생님 문제 자료(글은 그대로, PDF·사진은 Claude에 파일로)를 주고 `make_bank` 로 내신 변형 문제를 받아요. 객관식 유형(area): topic 주제, title 제목, gist 요지, detail 내용 일치, translate 해석, vocab 어휘, grammar 어법, refer 지칭, blank 빈칸, order 순서, insert 문장 위치, irrelevant 무관한 문장, summary 요약문. 서술형(kind): word 단어 쓰기, fix 어법 고치기(기호와 고친 말), form 형태 바꾸기, blank 빈칸, refer 가리키는 말(영작 문제는 내지 않아요, 답은 4단어 이내). 이미 은행에 있는 문항 목록(`have`, 최근 160개)을 줘서 겹치지 않게 해요. `review_bank` 로 정답을 가리고 다시 풀게 해서(객관식 `solved`, 서술형 `written` 을 `sa_match` 로 비교) 다르게 풀린 것, drop, 2점 이하를 빼요. 정답 번호는 고르게 맞바꿔요
- `reader.read`(사진 읽기, 1.3.0): 사진·PDF(사진 한 장 5MB까지)를 Claude에 주고 `read_passage` 로 제목, 출처, 지문, 해석, 알릴 말(`note`: 흐린 곳 등)을 받아요. 문제, 번호, 어휘 풀이는 지문에서 빼요
- 선생님이 영상을 올리면 브라우저가 앞쪽 한 장면을 떠서 썸네일(`thumb`)로 함께 올려요 (`ui.js videoThumb`).
- `ltscore.score`(레벨테스트 라이팅 채점, 1.5.0): 사이트가 준 `task.lt`(학년, 과제 단계, 조건 영작 문항과 모범 답, 글쓰기 과제와 권장 단어 수, 기준표, 학생 답)를 Claude `score_writing` 도구로 채점해요. 조건 영작 0~2점과 고친 문장, 글쓰기 기준 4개 1~5점, 고칠 곳 4개까지, 학부모님께 보일 한 줄 평. 학생 답 안의 지시는 따르지 않게 해요. 예전 엔진은 `kinds` 에 `ltwrite` 가 없어서 받지 않아요

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
