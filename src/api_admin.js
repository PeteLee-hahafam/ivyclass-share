import { HttpError, json, readJson, str, int, now, hashPassword, randomDigits, randomToken, getSettings, setSettings, sha256Hex, safeParse, logoUrl, cleanStyle, LECTURE_LEVELS } from './util.js';
import { deleteLectureFiles, lectureLinks } from './media.js';
import { studentLectures } from './api_student.js';
import { cleanSummary, TASK_KINDS } from './api_engine.js';
import { readQuiz, reviewQuiz, autoGrade, isOk, attemptOut } from './quiz.js';
import { deleteLectureBank } from './api_bank.js';
import { ltNewCount, ltCleanup } from './api_lt.js';

const round2 = (x) => Math.round(Number(x) * 100) / 100;

function lectureOut(l) {
  if (!l) return null;
  const slots = safeParse(l.name_slots, []) || [];
  return {
    id: l.id,
    title: l.title,
    source: l.source,
    tool: l.tool,
    status: l.status,
    progress: l.progress,
    progress_msg: l.progress_msg,
    error: l.error,
    duration: l.duration,
    video_bytes: l.video_bytes,
    has_video: !!l.video_key,
    has_note: !!l.note_key,
    has_practice: !!l.practice_key,
    has_thumb: !!l.thumb_key,
    has_script: !!l.script,
    has_subtitle: !!l.subtitle_key,
    has_transcript: !!l.transcript,
    has_summary: !!l.summary,
    has_quiz: !!l.quiz,
    has_homework: !!l.homework,
    name_slots: Array.isArray(slots) ? slots.length : 0,
    created_at: l.created_at,
    updated_at: l.updated_at,
    done_at: l.done_at,
    options: safeParse(l.options, {}),
  };
}

// 편집 내용: 잘라낼 구간, 목차, 영상 위에 그린 그림
function cleanEdit(b, duration) {
  const D = Number(duration) > 0 ? Number(duration) : 6 * 3600;
  const cuts = (Array.isArray(b.cuts) ? b.cuts : [])
    .slice(0, 120)
    .map((c) => [round2(c && c[0]), round2(c && c[1])])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s + 0.2 && s < D)
    .map(([s, e]) => [s, Math.min(e, D)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
    else merged.push([...c]);
  }
  const chapters = (Array.isArray(b.chapters) ? b.chapters : [])
    .slice(0, 60)
    .map((c) => ({ t: Math.max(0, round2(c && c.t)), title: str(c && c.title, 60) }))
    .filter((c) => Number.isFinite(c.t) && c.title && c.t < D)
    .sort((a, b) => a.t - b.t);
  let budget = 60000;
  const strokes = [];
  for (const s of (Array.isArray(b.strokes) ? b.strokes : []).slice(0, 600)) {
    if (!s || !Array.isArray(s.p)) continue;
    const p = s.p.slice(0, 4000).map((v) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
    if (p.length < 4 || p.length % 2) continue;
    if ((budget -= p.length) < 0) break;
    const t = round2(s.t);
    if (!Number.isFinite(t) || t < 0 || t > D) continue;
    strokes.push({
      t,
      d: Math.max(0, Math.min(3600, round2(s.d) || 0)),
      c: /^#[0-9a-fA-F]{6}$/.test(String(s.c || '')) ? s.c : '#e5372b',
      w: Math.max(1, Math.min(40, int(s.w, 6))),
      k: s.k === 'hl' ? 'hl' : 'pen',
      p,
    });
  }
  strokes.sort((a, b) => a.t - b.t);
  return { cuts: merged, chapters, strokes };
}

// 학원 PC에서 한 번 실행하면 제작 엔진을 받아 설치하는 파일 (영문만 써요: 윈도우 명령 창이 한글을 잘못 읽을 수 있어요)
function installerBat(origin, code) {
  const ps = [
    '[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12',
    "$ProgressPreference='SilentlyContinue'",
    "$t=($env:IVY_CODE -split '\\.',3)[2]",
    "$f=Join-Path $env:TEMP 'ivy_engine_install.ps1'",
    "Invoke-WebRequest -UseBasicParsing -Headers @{Authorization=('Bearer '+$t)} -Uri ($env:IVY_ORIGIN+'/_engine/install.ps1') -OutFile $f",
    '& $f -Origin $env:IVY_ORIGIN -Code $env:IVY_CODE',
  ].join('; ');
  return [
    '@echo off',
    'setlocal',
    'title IvyEngine Setup',
    'echo.',
    'echo   Installing the lecture engine. Please wait...',
    'echo.',
    `set "IVY_ORIGIN=${origin}"`,
    `set "IVY_CODE=${code}"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    'if errorlevel 1 pause',
    'endlocal',
    '',
  ].join('\r\n');
}

function connectionCode(origin, token) {
  const b64 = btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `ivy1.${b64}.${token}`;
}

// withPending: 아직 다 보지 않은 학생 이름도 함께 (알림 문구 복사에 써요)
// 과제 하나의 반 학생 현황: 강의를 다 봤는지, 확인 문제를 풀었는지, 숙제를 냈는지
// 완료는 강의를 다 보고 숙제까지 낸 것이에요 (숙제가 없는 강의는 다 보면 완료). 확인 문제는 점수 참고로만 보여요
async function classStats(env, lectureId, classId, withPending = false) {
  const v = await env.DB.prepare("SELECT json_extract(quiz, '$.ver') AS qv, json_extract(homework, '$.ver') AS hv FROM lectures WHERE id = ?").bind(lectureId).first();
  const qv = v && v.qv != null ? v.qv : null;
  const hv = v && v.hv != null ? v.hv : null;
  const binds = [];
  if (qv != null) binds.push(lectureId, qv);
  if (hv != null) binds.push(lectureId, hv);
  binds.push(lectureId, classId);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, COALESCE(p.percent, 0) AS percent, p.completed_at IS NOT NULL AS watched,
            ${qv != null ? 'EXISTS (SELECT 1 FROM quiz_attempts q WHERE q.user_id = u.id AND q.lecture_id = ? AND q.quiz_ver = ?)' : '0'} AS quiz,
            ${hv != null ? 'EXISTS (SELECT 1 FROM hw_attempts h WHERE h.user_id = u.id AND h.lecture_id = ? AND h.hw_ver = ?)' : '0'} AS hw
       FROM users u LEFT JOIN progress p ON p.user_id = u.id AND p.lecture_id = ?
      WHERE u.role = 'student' AND u.active = 1 AND u.class_id = ?
      ORDER BY COALESCE(p.percent, 0), u.name`,
  )
    .bind(...binds)
    .all();
  const rows = results.map((r) => ({ id: r.id, name: r.name, percent: r.percent, watched: !!r.watched, quiz: !!r.quiz, hw: !!r.hw }));
  const isDone = (r) => r.watched && (hv == null || r.hw);
  const out = {
    total: rows.length,
    watched: rows.filter((r) => r.watched).length,
    quiz: qv != null ? rows.filter((r) => r.quiz).length : null,
    hw: hv != null ? rows.filter((r) => r.hw).length : null,
    done: rows.filter(isDone).length,
    partial: rows.filter((r) => r.percent > 0 && !r.watched).length,
    avg: rows.length ? Math.round(rows.reduce((a, r) => a + r.percent, 0) / rows.length) : 0,
  };
  if (withPending) out.pending = rows.filter((r) => !isDone(r)).slice(0, 60);
  return out;
}

export async function handleAdmin(request, env, path, user) {
  const m = request.method;
  const url = new URL(request.url);
  let mm;

  // ---------------------------------------------------------------- 대시보드
  if (path === '/api/admin/dashboard' && m === 'GET') {
    const s = await getSettings(env);
    const engine = { last_seen: s.engine_last_seen, info: s.engine_info, connected: !!s.engine_token_hash };
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users WHERE role = 'student' AND active = 1) AS students,
              (SELECT COUNT(*) FROM classes WHERE archived = 0) AS classes,
              (SELECT COUNT(*) FROM lectures WHERE status = 'done') AS lectures,
              (SELECT COUNT(*) FROM lectures WHERE status IN ('queued','scripting','render_queued','rendering')) AS working,
              (SELECT COUNT(*) FROM lectures WHERE status = 'review') AS review`,
    ).first();
    counts.lt_new = await ltNewCount(env);
    // 위쪽 메뉴의 숫자와 엔진 표시만 필요할 때 (화면을 옮길 때마다 불러요)
    if (url.searchParams.get('lite')) return json({ counts, engine });
    await ltCleanup(env);
    const jobs = await env.DB.prepare(
      `SELECT * FROM lectures WHERE status IN ('queued','scripting','review','render_queued','rendering','failed') ORDER BY updated_at DESC LIMIT 12`,
    ).all();
    const asg = await env.DB.prepare(
      `SELECT a.*, l.title, l.source, l.duration, c.name AS class_name, c.color AS class_color FROM assignments a
         JOIN lectures l ON l.id = a.lecture_id JOIN classes c ON c.id = a.class_id
        WHERE c.archived = 0 AND a.closed_at IS NULL AND l.status = 'done' AND (a.due_at IS NULL OR a.due_at > ?)
        ORDER BY COALESCE(a.due_at, 9999999999), a.created_at DESC LIMIT 8`,
    )
      .bind(now() - 7 * 86400)
      .all();
    const assignments = [];
    for (const a of asg.results) assignments.push({ ...a, stats: await classStats(env, a.lecture_id, a.class_id, true) });
    const recent = await env.DB.prepare(
      `SELECT p.percent, p.updated_at, p.completed_at, u.name AS student, u.id AS user_id, u.class_id, l.title, l.id AS lecture_id, c.name AS class_name
         FROM progress p JOIN users u ON u.id = p.user_id JOIN lectures l ON l.id = p.lecture_id LEFT JOIN classes c ON c.id = u.class_id
        ORDER BY p.updated_at DESC LIMIT 10`,
    ).all();
    return json({
      counts,
      jobs: jobs.results.map(lectureOut),
      assignments,
      recent: recent.results,
      engine,
      academy_name: s.academy_name,
      recovery_ready: s.recovery_at > 0,
    });
  }

  // ---------------------------------------------------------------- 반
  if (path === '/api/admin/classes' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student' AND u.active = 1) AS students,
              (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id AND a.closed_at IS NULL) AS assignments
         FROM classes c WHERE c.archived = 0 ORDER BY c.name`,
    ).all();
    return json({ classes: results });
  }
  if (path === '/api/admin/classes' && m === 'POST') {
    const b = await readJson(request);
    const name = str(b.name, 40);
    if (!name) throw new HttpError(400, '반 이름을 적어 주세요.');
    const r = await env.DB.prepare('INSERT INTO classes (name, note, color, created_at) VALUES (?, ?, ?, ?)').bind(name, str(b.note, 200), str(b.color, 20), now()).run();
    return json({ id: r.meta.last_row_id });
  }
  if ((mm = path.match(/^\/api\/admin\/classes\/(\d+)$/))) {
    const id = int(mm[1]);
    if (m === 'PUT') {
      const b = await readJson(request);
      const name = str(b.name, 40);
      if (!name) throw new HttpError(400, '반 이름을 적어 주세요.');
      await env.DB.prepare('UPDATE classes SET name = ?, note = ?, color = ? WHERE id = ?').bind(name, str(b.note, 200), str(b.color, 20), id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('UPDATE classes SET archived = 1 WHERE id = ?').bind(id),
        env.DB.prepare('UPDATE users SET class_id = NULL WHERE class_id = ?').bind(id),
        env.DB.prepare('DELETE FROM assignments WHERE class_id = ?').bind(id),
        env.DB.prepare('DELETE FROM exam_classes WHERE class_id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------------- 학생
  if (path === '/api/admin/students' && m === 'GET') {
    const cid = url.searchParams.get('class_id');
    const where = ["u.role = 'student'", 'u.active = 1'];
    const binds = [];
    if (cid === 'none') where.push('u.class_id IS NULL');
    else if (cid) {
      where.push('u.class_id = ?');
      binds.push(int(cid));
    }
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.login_id, u.name, u.call_name, u.class_id, u.school, u.grade, u.memo, u.created_at, u.last_login_at, c.name AS class_name,
              (SELECT COUNT(*) FROM assignments a JOIN lectures l ON l.id = a.lecture_id WHERE a.class_id = u.class_id AND l.status = 'done') AS assigned,
              (SELECT COUNT(*) FROM progress p JOIN assignments a ON a.lecture_id = p.lecture_id AND a.class_id = u.class_id
                 WHERE p.user_id = u.id AND p.completed_at IS NOT NULL) AS completed,
              (SELECT MAX(p.updated_at) FROM progress p WHERE p.user_id = u.id) AS last_watch_at
         FROM users u LEFT JOIN classes c ON c.id = u.class_id
        WHERE ${where.join(' AND ')} ORDER BY c.name, u.name`,
    )
      .bind(...binds)
      .all();
    return json({ students: results });
  }
  if (path === '/api/admin/students' && m === 'POST') {
    const b = await readJson(request);
    const rows = Array.isArray(b.students) ? b.students : [b];
    const created = [];
    for (const r of rows.slice(0, 200)) {
      const name = str(r.name, 40);
      if (!name) continue;
      let login_id = str(r.login_id, 40);
      if (login_id && !/^[A-Za-z0-9_.-]{2,40}$/.test(login_id)) throw new HttpError(400, `${name}: 아이디는 영문, 숫자로 정해 주세요.`);
      if (!login_id) {
        for (let i = 0; i < 20; i++) {
          const cand = `s${randomDigits(5)}`;
          const ex = await env.DB.prepare('SELECT 1 FROM users WHERE login_id = ?').bind(cand).first();
          if (!ex) {
            login_id = cand;
            break;
          }
        }
      } else {
        const ex = await env.DB.prepare('SELECT 1 FROM users WHERE login_id = ?').bind(login_id).first();
        if (ex) throw new HttpError(409, `아이디 ${login_id}는 이미 쓰고 있어요.`);
      }
      const password = str(r.password, 40) || randomDigits(4);
      const { hash, salt } = await hashPassword(password);
      const res = await env.DB.prepare(
        "INSERT INTO users (role, login_id, name, call_name, pw_hash, pw_salt, class_id, school, grade, memo, created_at) VALUES ('student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(login_id, name, str(r.call_name, 20) || null, hash, salt, int(r.class_id), str(r.school, 40), str(r.grade, 20), str(r.memo, 300), now())
        .run();
      created.push({ id: res.meta.last_row_id, name, login_id, password });
    }
    return json({ created });
  }
  if ((mm = path.match(/^\/api\/admin\/students\/(\d+)$/))) {
    const id = int(mm[1]);
    if (m === 'PUT') {
      const b = await readJson(request);
      const name = str(b.name, 40);
      if (!name) throw new HttpError(400, '이름을 적어 주세요.');
      const login_id = str(b.login_id, 40);
      if (!/^[A-Za-z0-9_.-]{2,40}$/.test(login_id)) throw new HttpError(400, '아이디는 영문, 숫자로 정해 주세요.');
      const ex = await env.DB.prepare('SELECT id FROM users WHERE login_id = ? AND id != ?').bind(login_id, id).first();
      if (ex) throw new HttpError(409, `아이디 ${login_id}는 이미 쓰고 있어요.`);
      await env.DB.prepare("UPDATE users SET name = ?, call_name = ?, login_id = ?, class_id = ?, school = ?, grade = ?, memo = ? WHERE id = ? AND role = 'student'")
        .bind(name, str(b.call_name, 20) || null, login_id, int(b.class_id), str(b.school, 40), str(b.grade, 20), str(b.memo, 300), id)
        .run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET active = 0, login_id = login_id || '#' || id WHERE id = ? AND role = 'student'").bind(id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/students\/(\d+)\/password$/)) && m === 'POST') {
    const id = int(mm[1]);
    const b = await readJson(request);
    const password = str(b.password, 40) || randomDigits(4);
    const { hash, salt } = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ? AND role = 'student'").bind(hash, salt, id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    ]);
    return json({ password });
  }
  if ((mm = path.match(/^\/api\/admin\/students\/(\d+)\/progress$/)) && m === 'GET') {
    const id = int(mm[1]);
    const u = await env.DB.prepare("SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ? AND u.role = 'student'").bind(id).first();
    if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
    const lectures = await studentLectures(env, u);
    return json({ student: { id: u.id, name: u.name, login_id: u.login_id, class_name: u.class_name, last_login_at: u.last_login_at }, lectures });
  }

  // ---------------------------------------------------------------- 강의
  if (path === '/api/admin/lectures' && m === 'GET') {
    const st = url.searchParams.get('status');
    const q = str(url.searchParams.get('q'), 80);
    const where = [];
    const binds = [];
    const WORKING = ['queued', 'scripting', 'render_queued', 'rendering'];
    if (st === 'working') where.push(`status IN (${WORKING.map(() => '?').join(',')})`), binds.push(...WORKING);
    else if (st) where.push('status = ?'), binds.push(st);
    if (q) where.push('(title LIKE ? OR source LIKE ?)'), binds.push(`%${q}%`, `%${q}%`);
    const { results } = await env.DB.prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM assignments a WHERE a.lecture_id = l.id) AS assigned_classes
         FROM lectures l ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.updated_at DESC LIMIT 300`,
    )
      .bind(...binds)
      .all();
    return json({ lectures: results.map((l) => ({ ...lectureOut(l), assigned_classes: l.assigned_classes })) });
  }
  if (path === '/api/admin/lectures' && m === 'POST') {
    const b = await readJson(request);
    const manual = !!b.manual;
    let title = str(b.title, 120);
    const autoTitle = !title && !manual;
    if (autoTitle) title = '새 지문 강의';
    if (!title) throw new HttpError(400, '강의 제목을 적어 주세요.');
    const passage = str(b.passage, 12000);
    if (!manual && passage.length < 40) throw new HttpError(400, '지문을 붙여 넣어 주세요.');
    const options = {
      minutes: Math.min(30, Math.max(5, int(b.options?.minutes, 15))),
      tone: ['jondaet', 'banjon'].includes(b.options?.tone) ? b.options.tone : 'banmal',
      focus: ['balanced', 'grammar', 'reading', 'vocab'].includes(b.options?.focus) ? b.options.focus : 'balanced',
      captions: b.options?.captions !== false,
      practice: b.options?.practice !== false,
      auto_approve: !!b.options?.auto_approve,
      level: LECTURE_LEVELS.includes(b.options?.level) ? b.options.level : 'high1',
      memo: str(b.options?.memo, 500),
      call_names: b.options?.call_names !== false,
      review: b.options?.review !== false,
      auto_title: autoTitle,
    };
    if (manual) {
      options.auto_subtitle = b.options?.auto_subtitle === true;
      options.auto_summary = b.options?.auto_summary === true;
    }
    const r = await env.DB.prepare(
      'INSERT INTO lectures (title, source, tool, passage, translation, options, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(title, str(b.source, 120), manual ? 'manual' : str(b.tool, 30) || 'passage', passage, str(b.translation, 12000), JSON.stringify(options), manual ? 'manual' : 'queued', now(), now())
      .run();
    return json({ id: r.meta.last_row_id });
  }
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)$/))) {
    const id = int(mm[1]);
    const l = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    if (m === 'GET') {
      const asg = await env.DB.prepare(
        'SELECT a.*, c.name AS class_name, c.color AS class_color FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.lecture_id = ? AND c.archived = 0 ORDER BY c.name',
      )
        .bind(id)
        .all();
      const assignments = [];
      for (const a of asg.results) assignments.push({ ...a, stats: await classStats(env, id, a.class_id, true) });
      const tasks = await env.DB.prepare('SELECT * FROM tasks WHERE lecture_id = ? ORDER BY id DESC LIMIT 10').bind(id).all();
      return json({
        lecture: {
          ...lectureOut(l),
          passage: l.passage,
          translation: l.translation,
          script: safeParse(l.script, null),
          edit: { cuts: [], chapters: [], strokes: [], ...(safeParse(l.edit, null) || {}) },
          summary: safeParse(l.summary, null),
          transcript: safeParse(l.transcript, null),
          slots: safeParse(l.name_slots, []) || [],
        },
        assignments,
        tasks: tasks.results,
        files: await lectureLinks(env, l, ['video', 'note', 'practice', 'subtitle']),
      });
    }
    if (m === 'PUT') {
      const b = await readJson(request);
      const sets = ['updated_at = ?'];
      const vals = [now()];
      const opts = { ...(safeParse(l.options, {}) || {}) };
      let optsChanged = false;
      if (b.title !== undefined) {
        sets.push('title = ?');
        vals.push(str(b.title, 120) || l.title);
        opts.auto_title = false;
        optsChanged = true;
      }
      // 학년 바꾸기 (강의 목록 구분, 다음에 만드는 문제 수준)
      if (b.level !== undefined && LECTURE_LEVELS.includes(b.level)) {
        opts.level = b.level;
        optsChanged = true;
      }
      if (optsChanged) sets.push('options = ?'), vals.push(JSON.stringify(opts));
      if (b.source !== undefined) sets.push('source = ?'), vals.push(str(b.source, 120));
      if (b.script !== undefined) {
        if (!['review', 'done', 'failed', 'manual'].includes(l.status)) throw new HttpError(409, '지금은 대본을 고칠 수 없어요.');
        sets.push('script = ?');
        vals.push(typeof b.script === 'string' ? b.script : JSON.stringify(b.script));
      }
      await env.DB.prepare(`UPDATE lectures SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await deleteLectureFiles(env, l);
      const bank = await deleteLectureBank(env, id);
      await env.DB.batch([
        ...bank,
        env.DB.prepare('DELETE FROM assignments WHERE lecture_id = ?').bind(id),
        env.DB.prepare('DELETE FROM progress WHERE lecture_id = ?').bind(id),
        env.DB.prepare('DELETE FROM quiz_attempts WHERE lecture_id = ?').bind(id),
        env.DB.prepare('DELETE FROM tasks WHERE lecture_id = ?').bind(id),
        env.DB.prepare('DELETE FROM lectures WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------------- 강의 편집 (자르기·목차·덧그리기·자막·요약)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/(edit|summary|subtitle|tasks)$/))) {
    const id = int(mm[1]);
    const what = mm[2];
    const l = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    if (what === 'edit' && m === 'PUT') {
      const edit = cleanEdit(await readJson(request), l.duration);
      await env.DB.prepare('UPDATE lectures SET edit = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(edit), now(), id).run();
      return json({ ok: true, edit });
    }
    if (what === 'summary' && m === 'PUT') {
      const b = await readJson(request);
      const sm = b.summary ? cleanSummary(b.summary) : null;
      await env.DB.prepare('UPDATE lectures SET summary = ?, updated_at = ? WHERE id = ?').bind(sm ? JSON.stringify(sm) : null, now(), id).run();
      return json({ ok: true, summary: sm });
    }
    if (what === 'subtitle' && m === 'PUT') {
      const text = (await request.text()).replace(/^﻿/, '');
      if (text.length > 1_000_000) throw new HttpError(400, '자막이 너무 길어요.');
      if (!text.trim()) {
        if (l.subtitle_key) await env.BUCKET.delete(l.subtitle_key);
        await env.DB.prepare('UPDATE lectures SET subtitle_key = NULL, updated_at = ? WHERE id = ?').bind(now(), id).run();
        return json({ ok: true, has_subtitle: false });
      }
      if (!/^WEBVTT/.test(text.trimStart())) throw new HttpError(400, '자막 형식(WebVTT)이 올바르지 않아요.');
      const key = `lectures/${id}/subtitle-${Date.now()}.vtt`;
      await env.BUCKET.put(key, text, { httpMetadata: { contentType: 'text/vtt; charset=utf-8' } });
      await env.DB.prepare('UPDATE lectures SET subtitle_key = ?, updated_at = ? WHERE id = ?').bind(key, now(), id).run();
      if (l.subtitle_key && l.subtitle_key !== key) await env.BUCKET.delete(l.subtitle_key);
      return json({ ok: true, has_subtitle: true });
    }
    if (what === 'tasks' && m === 'POST') {
      const b = await readJson(request);
      const kind = String(b.kind || '');
      if (!TASK_KINDS.includes(kind) || kind === 'read' || kind === 'ltwrite') throw new HttpError(400, '작업 종류가 올바르지 않아요.');
      if (kind === 'transcribe' && !l.video_key) throw new HttpError(400, '영상을 먼저 올려 주세요.');
      if (kind === 'summarize' && !l.transcript && !l.script && !l.passage) throw new HttpError(400, '자막을 먼저 만들어 주세요. 요약은 자막 내용으로 만들어요.');
      if (kind === 'quiz' && !l.transcript && !l.script) throw new HttpError(400, '확인 문제는 강의 대본이나 자막으로 만들어요. 자막을 먼저 만들어 주세요.');
      const busy = await env.DB.prepare("SELECT id FROM tasks WHERE lecture_id = ? AND kind = ? AND status IN ('queued','running')").bind(id, kind).first();
      if (busy) return json({ ok: true, id: busy.id, already: true });
      const r = await env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)").bind(kind, id, now(), now()).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
  }
  // ---------------------------------------------------------------- 확인 문제 (문제, 학생 점수, 많이 틀린 문항)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/quiz$/))) {
    const id = int(mm[1]);
    const l = await env.DB.prepare('SELECT id, quiz FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE lectures SET quiz = NULL, updated_at = ? WHERE id = ?').bind(now(), id).run();
      return json({ ok: true });
    }
    if (m === 'GET') {
      const quiz = readQuiz(l.quiz);
      const task = await env.DB.prepare("SELECT id, status, progress, progress_msg, error FROM tasks WHERE lecture_id = ? AND kind = 'quiz' ORDER BY id DESC LIMIT 1").bind(id).first();
      if (!quiz) return json({ quiz: null, task });
      const rows = (
        await env.DB.prepare(
          `SELECT qa.*, u.name, u.login_id, c.name AS class_name FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id LEFT JOIN classes c ON c.id = u.class_id
            WHERE qa.lecture_id = ? AND qa.quiz_ver = ? ORDER BY c.name, u.name`,
        )
          .bind(id, quiz.ver)
          .all()
      ).results;
      const attempts = rows.map((r) => ({ ...attemptOut(r), user_id: r.user_id, name: r.name, login_id: r.login_id, class_name: r.class_name }));
      // 과제로 받은 반 학생 중 아직 안 푼 학생
      const pending = (
        await env.DB.prepare(
          `SELECT u.id, u.name, c.name AS class_name FROM assignments a JOIN users u ON u.class_id = a.class_id AND u.role = 'student' AND u.active = 1
             JOIN classes c ON c.id = a.class_id
            WHERE a.lecture_id = ? AND c.archived = 0 AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.user_id = u.id AND qa.lecture_id = a.lecture_id AND qa.quiz_ver = ?)
            ORDER BY c.name, u.name`,
        )
          .bind(id, quiz.ver)
          .all()
      ).results;
      const right = quiz.items.map((_, i) => attempts.filter((a) => isOk(a.results[i])).length);
      return json({ quiz: reviewQuiz(quiz), made_by: quiz.made_by || '', task, attempts, pending, right });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/quiz-attempts\/(\d+)$/))) {
    const aid = int(mm[1]);
    const r = await env.DB.prepare(
      `SELECT qa.*, l.quiz, u.name, c.name AS class_name FROM quiz_attempts qa JOIN lectures l ON l.id = qa.lecture_id
         JOIN users u ON u.id = qa.user_id LEFT JOIN classes c ON c.id = u.class_id WHERE qa.id = ?`,
    )
      .bind(aid)
      .first();
    if (!r) throw new HttpError(404, '푼 기록을 찾을 수 없어요.');
    if (m === 'GET') {
      // 반 성적표에서 한 학생 답안을 열 때
      const quiz = readQuiz(r.quiz);
      if (!quiz || quiz.ver !== r.quiz_ver) throw new HttpError(409, '확인 문제가 새로 바뀌어서 이 답안은 볼 수 없어요.');
      return json({ quiz: reviewQuiz(quiz), attempt: { ...attemptOut(r), name: r.name, class_name: r.class_name } });
    }
    if (m === 'DELETE') {
      // 다시 풀게 하기
      await env.DB.prepare('DELETE FROM quiz_attempts WHERE id = ?').bind(aid).run();
      return json({ ok: true });
    }
    if (m === 'PUT') {
      // 서술형처럼 자동 채점이 놓친 답을 선생님이 맞음·틀림으로 바꿔요 (ok 가 null 이면 자동 채점으로 되돌려요)
      const quiz = readQuiz(r.quiz);
      if (!quiz || quiz.ver !== r.quiz_ver) throw new HttpError(409, '문제가 바뀌어서 이 기록은 고칠 수 없어요.');
      const b = await readJson(request);
      const i = int(b.i, -1);
      if (i < 0 || i >= quiz.items.length) throw new HttpError(400, '문항 번호가 올바르지 않아요.');
      const results = safeParse(r.results, []) || [];
      const answers = safeParse(r.answers, []) || [];
      results[i] = b.ok === true ? 2 : b.ok === false ? 3 : autoGrade(quiz.items[i], answers[i] ?? null);
      const score = quiz.items.filter((_, k) => isOk(results[k])).length;
      await env.DB.prepare('UPDATE quiz_attempts SET results = ?, score = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(results), score, now(), aid).run();
      return json({ ok: true, results, score });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/tasks\/(\d+)$/)) && m === 'DELETE') {
    await env.DB.prepare("DELETE FROM tasks WHERE id = ? AND status != 'running'").bind(int(mm[1])).run();
    await env.DB.prepare("UPDATE tasks SET status = 'failed', error = '선생님이 취소했어요.', updated_at = ? WHERE id = ? AND status = 'running'").bind(now(), int(mm[1])).run();
    return json({ ok: true });
  }
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/(approve|rerender|retry|rescript|finish)$/)) && m === 'POST') {
    const id = int(mm[1]);
    const action = mm[2];
    const l = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    let next = null;
    if (action === 'approve' && l.status === 'review') next = 'render_queued';
    if (action === 'rerender' && l.script && ['done', 'failed', 'review'].includes(l.status)) next = 'render_queued';
    if (action === 'retry' && l.status === 'failed') next = l.script ? 'render_queued' : 'queued';
    if (action === 'rescript' && ['review', 'failed', 'done'].includes(l.status) && l.passage) next = 'queued';
    if (action === 'finish' && l.status === 'manual') {
      if (!l.video_key) throw new HttpError(400, '영상을 먼저 올려 주세요.');
      const b = await readJson(request);
      await env.DB.prepare("UPDATE lectures SET status = 'done', duration = COALESCE(?, duration), done_at = ?, updated_at = ? WHERE id = ?")
        .bind(b.duration ? Number(b.duration) : null, now(), now(), id)
        .run();
      // 올린 강의: 자동 자막(그다음 AI 요약)을 바로 줄 세워요
      const opts = safeParse(l.options, {}) || {};
      if (opts.auto_subtitle) {
        const busy = await env.DB.prepare("SELECT id FROM tasks WHERE lecture_id = ? AND kind = 'transcribe' AND status IN ('queued','running')").bind(id).first();
        if (!busy) await env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, created_at, updated_at) VALUES ('transcribe', ?, 'queued', ?, ?)").bind(id, now(), now()).run();
      }
      return json({ ok: true });
    }
    if (!next) throw new HttpError(409, '지금 상태에서는 할 수 없는 작업이에요.');
    await env.DB.prepare(
      `UPDATE lectures SET status = ?, progress = 0, progress_msg = NULL, error = NULL, updated_at = ?${action === 'rescript' ? ', script = NULL' : ''} WHERE id = ?`,
    )
      .bind(next, now(), id)
      .run();
    return json({ ok: true, status: next });
  }

  // ---------------------------------------------------------------- 과제
  if (path === '/api/admin/assignments' && m === 'GET') {
    // class_id 를 주면 그 반 과제만, 아직 안 본 학생 이름까지 보내요
    const cid = int(url.searchParams.get('class_id'));
    const { results } = await env.DB.prepare(
      `SELECT a.*, l.title, l.source, l.status, l.duration, l.thumb_key IS NOT NULL AS has_thumb, c.name AS class_name, c.color AS class_color FROM assignments a
         JOIN lectures l ON l.id = a.lecture_id JOIN classes c ON c.id = a.class_id
        WHERE c.archived = 0${cid ? ' AND a.class_id = ?' : ''} ORDER BY COALESCE(a.due_at, 9999999999) DESC, a.created_at DESC LIMIT 300`,
    )
      .bind(...(cid ? [cid] : []))
      .all();
    const out = [];
    for (const a of results) out.push({ ...a, has_thumb: !!a.has_thumb, stats: a.closed_at ? null : await classStats(env, a.lecture_id, a.class_id, !!cid) });
    return json({ assignments: out });
  }
  if (path === '/api/admin/assignments' && m === 'POST') {
    const b = await readJson(request);
    const lecture_id = int(b.lecture_id);
    const classIds = (Array.isArray(b.class_ids) ? b.class_ids : [b.class_id]).map((x) => int(x)).filter(Boolean);
    if (!lecture_id || !classIds.length) throw new HttpError(400, '강의와 반을 골라 주세요.');
    const l = await env.DB.prepare('SELECT status FROM lectures WHERE id = ?').bind(lecture_id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    const due = b.due_at ? int(b.due_at) : null;
    await env.DB.batch(
      classIds.map((cid) =>
        env.DB.prepare(
          `INSERT INTO assignments (lecture_id, class_id, due_at, note, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(lecture_id, class_id) DO UPDATE SET due_at = excluded.due_at, note = excluded.note, closed_at = NULL`,
        ).bind(lecture_id, cid, due, str(b.note, 300), now()),
      ),
    );
    return json({ ok: true });
  }
  // 끝난 과제를 선생님 목록에서 한꺼번에 지우거나(정리) 되돌려요. 학생 앱은 그대로예요
  if (path === '/api/admin/assignments/close' && m === 'POST') {
    const b = await readJson(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new HttpError(400, '정리할 과제를 골라 주세요.');
    await env.DB.prepare(`UPDATE assignments SET closed_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(b.closed === false ? null : now(), ...ids).run();
    return json({ ok: true, n: ids.length });
  }
  if ((mm = path.match(/^\/api\/admin\/assignments\/(\d+)$/))) {
    const id = int(mm[1]);
    if (m === 'PUT') {
      const b = await readJson(request);
      const sets = [];
      const vals = [];
      if ('due_at' in b) {
        sets.push('due_at = ?');
        vals.push(b.due_at ? int(b.due_at) : null);
      }
      if ('note' in b) {
        sets.push('note = ?');
        vals.push(str(b.note, 300));
      }
      if ('closed' in b) {
        sets.push('closed_at = ?');
        vals.push(b.closed ? now() : null);
      }
      if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');
      await env.DB.prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------------- 시청 현황
  if ((path === '/api/admin/watch' || path === '/api/admin/watch.csv') && m === 'GET') {
    const cid = int(url.searchParams.get('class_id'));
    const classes = (await env.DB.prepare('SELECT id, name FROM classes WHERE archived = 0 ORDER BY name').all()).results;
    const classId = cid || (classes[0] && classes[0].id);
    if (!classId) return json({ classes, students: [], lectures: [], cells: {} });
    const lectures = (
      await env.DB.prepare(
        `SELECT l.id, l.title, l.source, l.duration, a.due_at, a.id AS assignment_id, a.closed_at,
                json_array_length(l.quiz, '$.items') AS quiz_n, json_array_length(l.homework, '$.items') AS hw_n FROM assignments a JOIN lectures l ON l.id = a.lecture_id
          WHERE a.class_id = ? AND l.status = 'done' ORDER BY COALESCE(a.due_at, a.created_at) DESC, a.created_at DESC`,
      )
        .bind(classId)
        .all()
    ).results;
    const students = (
      await env.DB.prepare("SELECT id, name, login_id, last_login_at FROM users WHERE role = 'student' AND active = 1 AND class_id = ? ORDER BY name")
        .bind(classId)
        .all()
    ).results;
    const prog = (
      await env.DB.prepare(
        `SELECT p.user_id, p.lecture_id, p.percent, p.completed_at, p.updated_at, p.views, p.watched FROM progress p
           JOIN users u ON u.id = p.user_id WHERE u.class_id = ?`,
      )
        .bind(classId)
        .all()
    ).results;
    const cells = {};
    for (const p of prog) {
      cells[p.user_id] = cells[p.user_id] || {};
      cells[p.user_id][p.lecture_id] = { percent: p.percent, completed_at: p.completed_at, updated_at: p.updated_at, views: p.views, watched: p.watched };
    }
    const quizRows = (
      await env.DB.prepare(
        `SELECT qa.id, qa.user_id, qa.lecture_id, qa.score, qa.total, qa.created_at FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id JOIN lectures l ON l.id = qa.lecture_id
          WHERE u.class_id = ? AND qa.quiz_ver = json_extract(l.quiz, '$.ver')`,
      )
        .bind(classId)
        .all()
    ).results;
    for (const r of quizRows) {
      cells[r.user_id] = cells[r.user_id] || {};
      const c = (cells[r.user_id][r.lecture_id] = cells[r.user_id][r.lecture_id] || { percent: 0 });
      c.quiz = { id: r.id, score: r.score, total: r.total, created_at: r.created_at };
    }
    // 사이트 숙제 (지금 숙제 묶음으로 낸 것만)
    const hwRows = (
      await env.DB.prepare(
        `SELECT ha.id, ha.user_id, ha.lecture_id, ha.score, ha.total, ha.created_at FROM hw_attempts ha JOIN users u ON u.id = ha.user_id JOIN lectures l ON l.id = ha.lecture_id
          WHERE u.class_id = ? AND ha.hw_ver = json_extract(l.homework, '$.ver')`,
      )
        .bind(classId)
        .all()
    ).results;
    for (const r of hwRows) {
      cells[r.user_id] = cells[r.user_id] || {};
      const c = (cells[r.user_id][r.lecture_id] = cells[r.user_id][r.lecture_id] || { percent: 0 });
      c.hw = { id: r.id, score: r.score, total: r.total, created_at: r.created_at };
    }
    if (path.endsWith('.csv')) {
      const cname = (classes.find((c) => c.id === classId) || {}).name || '';
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['이름', '아이디', ...lectures.flatMap((l) => [l.title, ...(l.quiz_n ? [`${l.title} (확인 문제)`] : []), ...(l.hw_n ? [`${l.title} (숙제)`] : [])])];
      const lines = [head.map(esc).join(',')];
      for (const s of students) {
        const row = cells[s.id] || {};
        lines.push(
          [s.name, s.login_id, ...lectures.flatMap((l) => {
            const c = row[l.id];
            const out = [`${c?.percent ?? 0}%`];
            if (l.quiz_n) out.push(c && c.quiz ? `${c.quiz.score}/${c.quiz.total}` : '');
            if (l.hw_n) out.push(c && c.hw ? `${c.hw.score}/${c.hw.total}` : '');
            return out;
          })]
            .map(esc)
            .join(','),
        );
      }
      return new Response('﻿' + lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`시청현황_${cname}.csv`)}`,
        },
      });
    }
    return json({ classes, class_id: classId, students, lectures, cells });
  }

  // ---------------------------------------------------------------- 학생 화면 미리보기
  if (path === '/api/admin/preview/students' && m === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT u.id, u.name, u.class_id, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.role = 'student' AND u.active = 1 ORDER BY c.name, u.name",
    ).all();
    return json({ students: results });
  }

  // ---------------------------------------------------------------- 설정
  if (path === '/api/admin/settings' && m === 'GET') {
    const s = await getSettings(env);
    const { engine_token_hash, ...rest } = s;
    return json({ settings: { ...rest, engine_connected: !!engine_token_hash, logo_url: logoUrl(s) } });
  }
  if (path === '/api/admin/settings' && m === 'PUT') {
    const b = await readJson(request);
    const patch = {};
    if (b.academy_name !== undefined) patch.academy_name = str(b.academy_name, 60) || '우리 학원';
    if (b.app_name !== undefined) patch.app_name = str(b.app_name, 60) || '온라인 강의실';
    if (b.header_text !== undefined) patch.header_text = str(b.header_text, 80);
    if (b.academy_phone !== undefined) patch.academy_phone = str(b.academy_phone, 30);
    if (b.complete_threshold !== undefined) patch.complete_threshold = Math.min(100, Math.max(50, int(b.complete_threshold, 90)));
    if (b.prevent_skip !== undefined) patch.prevent_skip = b.prevent_skip ? '1' : '0';
    if (b.default_minutes !== undefined) patch.default_minutes = Math.min(30, Math.max(5, int(b.default_minutes, 15)));
    if (b.default_tone !== undefined) patch.default_tone = ['jondaet', 'banjon'].includes(b.default_tone) ? b.default_tone : 'banmal';
    if (b.board_style !== undefined) patch.board_style = JSON.stringify(cleanStyle(b.board_style));
    await setSettings(env, patch);
    return json({ ok: true });
  }
  if (path === '/api/admin/engine-token' && m === 'POST') {
    const token = randomToken(30);
    await setSettings(env, { engine_token_hash: await sha256Hex(token), engine_last_seen: 0 });
    return json({ code: connectionCode(new URL(request.url).origin, token) });
  }
  if (path === '/api/admin/engine-installer' && m === 'POST') {
    // 새 연결 코드를 넣은 설치 파일을 만들어요 (예전 연결 코드는 더 이상 안 돼요)
    const token = randomToken(30);
    await setSettings(env, { engine_token_hash: await sha256Hex(token), engine_last_seen: 0 });
    const origin = new URL(request.url).origin;
    return new Response(installerBat(origin, connectionCode(origin, token)), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="IvyEngine-Setup.bat"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (path === '/api/admin/logo' && m === 'PUT') {
    const ct = (request.headers.get('Content-Type') || '').split(';')[0];
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[ct];
    if (!ext) throw new HttpError(400, 'PNG, JPG, WEBP, SVG 그림만 올릴 수 있어요.');
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) throw new HttpError(400, '로고 파일은 2MB 이하로 올려 주세요.');
    const s = await getSettings(env);
    const key = `brand/logo-${Date.now()}.${ext}`;
    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: ct } });
    if (s.logo_key) await env.BUCKET.delete(s.logo_key);
    await setSettings(env, { logo_key: key });
    return json({ ok: true });
  }
  if (path === '/api/admin/logo' && m === 'DELETE') {
    const s = await getSettings(env);
    if (s.logo_key) await env.BUCKET.delete(s.logo_key);
    await setSettings(env, { logo_key: '' });
    return json({ ok: true });
  }
  return null;
}
