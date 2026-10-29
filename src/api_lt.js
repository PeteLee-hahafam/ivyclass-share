// 영어 레벨테스트: 링크로 들어온 학생이 응시하고(로그인 없이), 선생님은 결과 목록과 어머니 리포트를 봐요.
// 정답과 채점은 서버(src/lt)에서만 해요. 학생 화면에는 정답을 뺀 문항만 가요.
import { HttpError, json, readJson, str, int, now, getSettings, setSettings, sha256Hex, randomToken, safeParse, logoUrl, linkSecret } from './util.js';
import { LT_BOOKS_DEFAULT, LT_MOD_ORDER, LT_YEARS, LT_LEVELS, LT_MODS, LT_MODNAME, ltReport2HTML } from './lt/core.js';
import {
  LT_PRESETS, LtError, cleanMods, newState, submitBlock, submitWrite, skipModule, needsAiScoring, publicView,
  analyze, summaryOf, messageText, writePayload, cleanScoring, setBook, teacherScoring,
} from './lt/flow.js';
import { ltAdminDetail } from './lt/admin.js';

const KEEP_NEW_DAYS = 180; // 학생 계정과 잇지 않은 기록은 6개월 뒤 지워요 (리포트 꼬리말과 같아요)
const KEEP_UNFINISHED_DAYS = 7; // 끝내지 않은 응시는 일주일 뒤 지워요
const PER_IP_HOUR = 20; // 같은 곳(인터넷 주소)에서 한 시간에 시작할 수 있는 수. 로그인한 학생과 선생님은 세지 않아요
const PER_DAY = 400;

function kstDate(t = Date.now()) {
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function booksOf(s) {
  return Array.isArray(s.lt_books) && s.lt_books.length ? s.lt_books : LT_BOOKS_DEFAULT;
}

// 링크에 붙은 영역(?p=all 또는 ?m=voc,read)이 없으면 선생님이 정해 둔 기본 묶음
function modsFor(s, url) {
  const m = url.searchParams.get('m');
  if (m) return cleanMods(m);
  const p = url.searchParams.get('p');
  if (p && LT_PRESETS[p]) return LT_PRESETS[p].mods.slice();
  return LT_PRESETS[s.lt_preset] ? LT_PRESETS[s.lt_preset].mods.slice() : cleanMods(s.lt_preset);
}

// 학생 정보의 학년(자유롭게 적은 글)에서 1~12 단계를 짐작해요. 모르면 0
function guessGrade(school, grade) {
  const t = `${school || ''} ${grade || ''}`;
  const m = t.match(/(초|중|고)\s*([1-6])/);
  const n = (grade || '').match(/([1-6])/);
  const kind = m ? m[1] : /초등/.test(t) ? '초' : /중학/.test(t) ? '중' : /고등/.test(t) ? '고' : '';
  const g = m ? Number(m[2]) : n ? Number(n[1]) : 0;
  if (!kind || !g) return 0;
  if (kind === '초') return g;
  if (g > 3) return 0;
  return kind === '중' ? 6 + g : 9 + g;
}

async function ipHash(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return (await sha256Hex(`${await linkSecret(env)}:lt:${ip}`)).slice(0, 32);
}

async function sessionByToken(env, request) {
  const tok = str(request.headers.get('X-LT-Token'), 100);
  if (!tok) throw new HttpError(401, '응시 기록을 찾을 수 없어요. 처음부터 다시 시작해 주세요.', 'lt_gone');
  const row = await env.DB.prepare('SELECT * FROM lt_sessions WHERE token_hash = ?').bind(await sha256Hex(tok)).first();
  if (!row) throw new HttpError(404, '응시 기록을 찾을 수 없어요. 처음부터 다시 시작해 주세요.', 'lt_gone');
  return row;
}

async function saveState(env, row, state, extra = {}) {
  const sets = ['state = ?', 'updated_at = ?'];
  const vals = [JSON.stringify(state), now()];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  await env.DB.prepare(`UPDATE lt_sessions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, row.id).run();
}

const taskKey = (sid) => JSON.stringify({ sid });

export async function queueWriteScoring(env, sid) {
  const busy = await env.DB.prepare("SELECT id FROM tasks WHERE kind = 'ltwrite' AND status IN ('queued','running') AND payload = ?").bind(taskKey(sid)).first();
  if (busy) return busy.id;
  // 다른 작업보다 먼저 받도록 조금 앞선 시각으로 줄 세워요 (학부모님이 기다리는 결과라서)
  const r = await env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('ltwrite', NULL, 'queued', ?, ?, ?)")
    .bind(taskKey(sid), now() - 600, now())
    .run();
  return r.meta.last_row_id;
}

// 응시를 다 마쳤을 때: 요약을 남기고, 라이팅을 Claude가 채점해야 하면 엔진 작업을 줄 세워요
async function finishIfDone(env, row, state) {
  if (!state.done) return {};
  const s = await getSettings(env);
  const a = analyze(row, state, booksOf(s));
  const extra = { summary: JSON.stringify(summaryOf(a)), finished_at: row.finished_at || now() };
  if (needsAiScoring(state)) {
    extra.status = 'scoring';
    await queueWriteScoring(env, row.id);
  } else extra.status = 'done';
  return extra;
}

// 학생 계정과 잇지 않은 기록은 6개월, 끝내지 않은 응시는 일주일 뒤 지워요 (레벨테스트 화면과 오늘 화면을 열 때)
export async function ltCleanup(env) {
  const { results } = await env.DB.prepare('SELECT id FROM lt_sessions WHERE (user_id IS NULL AND created_at < ?) OR (finished_at IS NULL AND updated_at < ?) LIMIT 200')
    .bind(now() - KEEP_NEW_DAYS * 86400, now() - KEEP_UNFINISHED_DAYS * 86400)
    .all();
  if (!results.length) return;
  await env.DB.batch(
    results.flatMap((r) => [
      env.DB.prepare('DELETE FROM lt_sessions WHERE id = ?').bind(r.id),
      env.DB.prepare("DELETE FROM tasks WHERE kind = 'ltwrite' AND payload = ?").bind(taskKey(r.id)),
    ]),
  );
}

function ltErr(e) {
  if (e instanceof LtError) throw new HttpError(e.code === 'stale' ? 409 : 400, e.message, e.code === 'stale' ? 'lt_stale' : 'lt_bad');
  throw e;
}

const modInfo = (k) => ({ key: k, name: LT_MODNAME[k], mins: LT_MODS[k].mins });

// ==================================================================== 학생 (로그인 없이)
export async function handleLtPublic(request, env, path, user) {
  const m = request.method;
  if (path === '/api/lt/info' && m === 'GET') {
    const s = await getSettings(env);
    const mods = modsFor(s, new URL(request.url));
    let me = null;
    if (user && user.role === 'student') {
      const u = await env.DB.prepare('SELECT name, school, grade FROM users WHERE id = ?').bind(user.id).first();
      if (u) me = { name: u.name, school: u.school || '', grade: guessGrade(u.school, u.grade) };
    }
    return json({
      open: s.lt_open,
      academy: s.academy_name,
      phone: s.academy_phone,
      logo: logoUrl(s),
      mods: mods.map(modInfo),
      years: LT_YEARS.map((y) => ({ key: y.key, label: y.label })),
      grades: LT_LEVELS.slice(1).map((L) => ({ lv: L.lv, short: L.short })),
      me,
      teacher: !!(user && user.role === 'admin'),
    });
  }
  if (path === '/api/lt/start' && m === 'POST') {
    const s = await getSettings(env);
    if (!s.lt_open) throw new HttpError(403, '지금은 레벨테스트를 받지 않아요. 학원에 물어봐 주세요.', 'lt_closed');
    const b = await readJson(request);
    const name = str(b.name, 20);
    const grade = int(b.grade, 0);
    if (!name) throw new HttpError(400, '학생 이름을 적어 주세요.');
    if (!(grade >= 1 && grade <= 12)) throw new HttpError(400, '학년을 골라 주세요.');
    if (!b.consent) throw new HttpError(400, '개인정보 수집과 이용에 동의해 주세요.');
    const years = LT_YEARS.some((y) => y.key === b.years) ? b.years : '1to2';
    const phone = str(b.phone, 20).replace(/[^0-9-]/g, '');
    const school = str(b.school, 40);
    const ih = await ipHash(env, request);
    const known = !!(user && (user.role === 'student' || user.role === 'admin'));
    const lim = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM lt_sessions WHERE ip_hash = ? AND created_at > ? AND user_id IS NULL) AS mine, (SELECT COUNT(*) FROM lt_sessions WHERE created_at > ?) AS day')
      .bind(ih, now() - 3600, now() - 86400)
      .first();
    if ((!known && lim.mine >= PER_IP_HOUR) || lim.day >= PER_DAY) throw new HttpError(429, '시험을 시작한 사람이 많아요. 잠시 뒤에 다시 시작해 주세요.', 'lt_busy');
    // 재원생이 로그인한 채로 보면 계정과 잇고, 지난번 결과 근처에서 시작해요
    let kind = 'new';
    let userId = null;
    let last = null;
    if (user && user.role === 'student') {
      kind = 'member';
      userId = user.id;
      const prev = await env.DB.prepare('SELECT summary FROM lt_sessions WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1').bind(user.id).first();
      const sm = prev ? safeParse(prev.summary, null) : null;
      if (sm && sm.overall && sm.overall.level > 0) last = sm.overall.level;
    }
    const student = { name, grade, school, years, phone, kind, ...(last ? { last } : {}) };
    const state = newState(student, cleanMods(b.mods), kstDate());
    const token = randomToken(24);
    const r = await env.DB.prepare(
      `INSERT INTO lt_sessions (token_hash, user_id, kind, name, grade, school, phone, state, status, ip_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    )
      .bind(await sha256Hex(token), userId, kind, name, grade, school, phone, JSON.stringify(state), ih, now(), now())
      .run();
    return json({ token, view: publicView({ id: r.meta.last_row_id, status: 'running' }, state) });
  }
  if (path === '/api/lt/me' && m === 'GET') {
    const row = await sessionByToken(env, request);
    const state = safeParse(row.state, null);
    if (!state) throw new HttpError(404, '응시 기록을 찾을 수 없어요. 처음부터 다시 시작해 주세요.', 'lt_gone');
    return json({ view: publicView(row, state) });
  }
  if ((path === '/api/lt/block' || path === '/api/lt/write' || path === '/api/lt/skip') && m === 'POST') {
    const row = await sessionByToken(env, request);
    const state = safeParse(row.state, null);
    if (!state) throw new HttpError(404, '응시 기록을 찾을 수 없어요. 처음부터 다시 시작해 주세요.', 'lt_gone');
    if (state.done) return json({ view: publicView(row, state) });
    const b = await readJson(request);
    try {
      if (path === '/api/lt/block') submitBlock(state, b);
      else if (path === '/api/lt/write') submitWrite(state, b);
      else skipModule(state, String(b.mod || ''));
    } catch (e) {
      ltErr(e);
    }
    const extra = await finishIfDone(env, row, state);
    await saveState(env, row, state, extra);
    return json({ view: publicView({ ...row, ...extra }, state) });
  }
  return null;
}

// ==================================================================== 선생님
function listRow(r) {
  const sm = safeParse(r.summary, null);
  const st = safeParse(r.state, {}) || {};
  return {
    id: r.id,
    name: r.name,
    grade: r.grade,
    grade_short: LT_LEVELS[r.grade] ? LT_LEVELS[r.grade].short : '',
    kind: r.kind,
    user_id: r.user_id || null,
    school: r.school || '',
    status: r.status,
    mods: st.mods || [],
    progress: st.mods ? Math.min(st.mods.length, st.mi || 0) : 0,
    summary: sm,
    created_at: r.created_at,
    updated_at: r.updated_at,
    finished_at: r.finished_at,
    seen: !!r.seen_at,
  };
}

function cleanBooks(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 80) : []) {
    if (!x || !LT_MOD_ORDER.includes(x.skill)) continue;
    const name = str(x.name, 60);
    if (!name) continue;
    let from = Math.max(1, Math.min(12, int(x.from, 1)));
    let to = Math.max(1, Math.min(12, int(x.to, from)));
    if (from > to) [from, to] = [to, from];
    out.push({ skill: x.skill, name, from, to, note: str(x.note, 60) });
  }
  return out;
}

async function detailOut(env, row) {
  const state = safeParse(row.state, null);
  if (!state) throw new HttpError(500, '응시 기록을 읽지 못했어요.');
  const s = await getSettings(env);
  const books = booksOf(s);
  const u = row.user_id ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(row.user_id).first() : null;
  const out = {
    session: {
      ...listRow(row),
      user_name: u ? u.name : '',
      phone: row.phone || '',
      years: state.student && state.student.years,
      comment: row.comment || '',
      skipped: state.skipped || [],
    },
  };
  if (!state.done) return { ...out, done: false };
  const a = analyze(row, state, books);
  const logo = logoUrl(s);
  const task = await env.DB.prepare("SELECT id, status, error, progress_msg, updated_at FROM tasks WHERE kind = 'ltwrite' AND payload = ? ORDER BY id DESC LIMIT 1").bind(taskKey(row.id)).first();
  const w = state.res && state.res.write;
  return {
    ...out,
    done: true,
    auto_comment: a.comment,
    detail: ltAdminDetail(a, state),
    scoring: w && w.tier !== 'A' ? { need: needsAiScoring(state), task: task ? { status: task.status, error: task.error || '', msg: task.progress_msg || '' } : null } : null,
    book_choice: (state.bookOv && typeof state.bookOv === 'object' && state.bookOv) || {},
    books: books.filter((b) => a.order.includes(b.skill)),
    html: ltReport2HTML(a, { academy: s.academy_name, phone: s.academy_phone, logo, watermark: logo, print: true, comment: row.comment || null }),
    msg: messageText(a, s.academy_name, s.academy_phone),
    file_name: `${row.name}_영어레벨테스트_${state.date}`,
  };
}

export async function handleLtAdmin(request, env, path) {
  const m = request.method;
  let mm;
  if (path === '/api/admin/lt' && m === 'GET') {
    await ltCleanup(env);
    const s = await getSettings(env);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.name, l.grade, l.kind, l.user_id, l.school, l.status, l.state, l.summary, l.created_at, l.updated_at, l.finished_at, l.seen_at, u.name AS user_name
         FROM lt_sessions l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 300`,
    ).all();
    return json({
      open: s.lt_open,
      preset: s.lt_preset,
      presets: Object.entries(LT_PRESETS).map(([k, v]) => ({ key: k, name: v.name, mods: v.mods })),
      mods: LT_MOD_ORDER.map(modInfo),
      books: booksOf(s),
      books_default: !(Array.isArray(s.lt_books) && s.lt_books.length),
      grades: LT_LEVELS.slice(1).map((L) => ({ lv: L.lv, short: L.short })),
      sessions: results.map((r) => ({ ...listRow(r), user_name: r.user_name || '' })),
    });
  }
  if (path === '/api/admin/lt' && m === 'PUT') {
    const b = await readJson(request);
    const patch = {};
    if (b.open !== undefined) patch.lt_open = b.open ? '1' : '0';
    if (b.preset !== undefined) patch.lt_preset = LT_PRESETS[b.preset] ? b.preset : cleanMods(b.preset).join(',');
    if (b.books !== undefined) patch.lt_books = b.books === null ? '' : JSON.stringify(cleanBooks(b.books));
    await setSettings(env, patch);
    return json({ ok: true });
  }
  if ((mm = path.match(/^\/api\/admin\/lt\/(\d+)(\/rescore)?$/))) {
    const id = int(mm[1]);
    const row = await env.DB.prepare('SELECT * FROM lt_sessions WHERE id = ?').bind(id).first();
    if (!row) throw new HttpError(404, '레벨테스트 기록을 찾을 수 없어요. 지웠을 수 있어요.', 'gone');
    const state = safeParse(row.state, null);
    if (mm[2]) {
      if (m !== 'POST') throw new HttpError(405, '잘못된 요청이에요.');
      const w = state && state.res && state.res.write;
      if (!state || !state.done || !w || w.tier === 'A') throw new HttpError(400, '다시 채점할 라이팅이 없어요.');
      w.scoring = null;
      await env.DB.prepare("DELETE FROM tasks WHERE kind = 'ltwrite' AND status IN ('failed','done') AND payload = ?").bind(taskKey(id)).run();
      await saveState(env, row, state, { status: 'scoring' });
      await queueWriteScoring(env, id);
      return json(await detailOut(env, { ...row, state: JSON.stringify(state), status: 'scoring' }));
    }
    if (m === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM lt_sessions WHERE id = ?').bind(id),
        env.DB.prepare("DELETE FROM tasks WHERE kind = 'ltwrite' AND payload = ?").bind(taskKey(id)),
      ]);
      return json({ ok: true });
    }
    if (m === 'PUT') {
      if (!state) throw new HttpError(500, '응시 기록을 읽지 못했어요.');
      const b = await readJson(request);
      const extra = {};
      if (b.comment !== undefined) extra.comment = str(b.comment, 2000) || null;
      if (b.user_id !== undefined) {
        const uid = int(b.user_id, 0);
        if (uid) {
          const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").bind(uid).first();
          if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
          extra.user_id = uid;
          extra.kind = 'member';
        } else extra.user_id = null;
      }
      try {
        if (b.book) setBook(state, String(b.book.skill || ''), b.book.name);
        if (b.scoring) {
          teacherScoring(state, b.scoring);
          // 선생님이 채점했으니 기다리던 AI 채점은 그만 받아요
          await env.DB.prepare("DELETE FROM tasks WHERE kind = 'ltwrite' AND status = 'queued' AND payload = ?").bind(taskKey(id)).run();
          if (state.done) extra.status = 'done';
        }
      } catch (e) {
        ltErr(e);
      }
      if (state.done && (b.book || b.scoring)) {
        const s = await getSettings(env);
        extra.summary = JSON.stringify(summaryOf(analyze(row, state, booksOf(s))));
      }
      await saveState(env, row, state, extra);
      const fresh = await env.DB.prepare('SELECT * FROM lt_sessions WHERE id = ?').bind(id).first();
      return json(await detailOut(env, fresh));
    }
    if (m === 'GET') {
      if (!row.seen_at && row.finished_at) await env.DB.prepare('UPDATE lt_sessions SET seen_at = ? WHERE id = ?').bind(now(), id).run();
      return json(await detailOut(env, row));
    }
  }
  return null;
}

// 오늘 화면: 아직 안 본 결과 수
export async function ltNewCount(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM lt_sessions WHERE finished_at IS NOT NULL AND seen_at IS NULL').first();
  return r ? r.n : 0;
}

// ==================================================================== 엔진 (라이팅 채점)
export async function ltTaskPayload(env, t) {
  const p = safeParse(t.payload, {}) || {};
  const row = await env.DB.prepare('SELECT * FROM lt_sessions WHERE id = ?').bind(int(p.sid, 0)).first();
  const state = row ? safeParse(row.state, null) : null;
  if (!state || !state.done || !needsAiScoring(state)) return null;
  return { id: t.id, kind: 'ltwrite', lecture_id: null, title: `${row.name} 학생`, lt: writePayload(state) };
}

// 엔진이 라이팅을 채점하지 못했어요 (API 키, 인터넷 등): 선생님이 직접 채점하거나 다시 채점을 눌러요
export async function ltTaskFailed(env, t) {
  const p = safeParse(t.payload, {}) || {};
  await env.DB.prepare("UPDATE lt_sessions SET status = 'review', updated_at = ? WHERE id = ? AND status = 'scoring'").bind(now(), int(p.sid, 0)).run();
}

export async function ltTaskDone(env, t, body) {
  const p = safeParse(t.payload, {}) || {};
  const row = await env.DB.prepare('SELECT * FROM lt_sessions WHERE id = ?').bind(int(p.sid, 0)).first();
  const state = row ? safeParse(row.state, null) : null;
  const w = state && state.res && state.res.write;
  // 그사이 선생님이 직접 채점했으면 덮어쓰지 않아요
  if (w && w.tier !== 'A' && !w.scoring) {
    if (!body || !body.lt || typeof body.lt !== 'object') throw new HttpError(400, '채점 결과가 없어요.');
    w.scoring = { ...cleanScoring(state, body.lt), model: str(body.model, 60) };
    const s = await getSettings(env);
    await saveState(env, row, state, { status: 'done', summary: JSON.stringify(summaryOf(analyze(row, state, booksOf(s)))) });
  }
  await env.DB.prepare("UPDATE tasks SET status = 'done', progress = 100, progress_msg = NULL, error = NULL, updated_at = ? WHERE id = ?").bind(now(), t.id).run();
}
