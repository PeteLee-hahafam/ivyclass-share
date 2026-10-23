import { HttpError, json, readJson, str, int, now, getSettings, setSettings, sha256Hex, safeEqual, safeParse, cleanStyle, callText } from './util.js';
import { serveObject } from './media.js';

export async function engineAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return false;
  const s = await getSettings(env);
  if (!s.engine_token_hash) return false;
  return safeEqual(await sha256Hex(token), s.engine_token_hash);
}

const STALE = 3 * 3600; // 엔진이 멈춘 작업은 3시간 뒤 다시 줄을 세워요
const TASK_KINDS = ['transcribe', 'summarize'];
const round2 = (x) => Math.round(Number(x) * 100) / 100;

// 강의를 만든 목소리 정보 (이름 목소리를 같은 목소리로 만들 때 써요). 비밀 키는 들어 있지 않아요.
export function voiceOf(raw) {
  const v = safeParse(raw, null);
  if (!v || typeof v !== 'object' || !/^[0-9a-f]{8,40}$/.test(String(v.k || ''))) return null;
  return v;
}

function cleanVoice(v) {
  if (!v || typeof v !== 'object') return null;
  const k = str(v.k, 40);
  if (!/^[0-9a-f]{8,40}$/.test(k)) return null;
  const out = { k, provider: str(v.provider, 20), voice: str(v.voice, 80), model: str(v.model, 60), speed: Number(v.speed) || 1, tone: v.tone === 'jondaet' ? 'jondaet' : 'banmal', label: str(v.label, 80) };
  if (v.style) out.style = str(v.style, 300);
  return out;
}

function cleanSlots(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 60)
    .map((x) => ({ t: round2(x && x.t), d: round2(x && x.d) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= 0 && x.d > 0 && x.d < 5);
}

// AI 강의의 목차 (단계 시작 시간). 선생님이 고친 목차가 있으면 건드리지 않아요.
function cleanChapters(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list.slice(0, 60)) {
    const t = round2(x && x.t);
    const title = str(x && x.title, 60);
    if (!Number.isFinite(t) || t < 0 || !title) continue;
    if (out.length && out[out.length - 1].t >= t) continue;
    out.push({ t, title });
  }
  return out;
}

async function claimLecture(env) {
  return env.DB.prepare(
    `UPDATE lectures SET status = CASE status WHEN 'queued' THEN 'scripting' ELSE 'rendering' END,
            engine_claimed_at = ?, progress = 0, progress_msg = '작업을 시작했어요', updated_at = ?
      WHERE id = (SELECT id FROM lectures WHERE status IN ('queued','render_queued') ORDER BY updated_at LIMIT 1)
      RETURNING *`,
  )
    .bind(now(), now())
    .first();
}

async function claimTask(env) {
  for (let i = 0; i < 5; i++) {
    const t = await env.DB.prepare(
      `UPDATE tasks SET status = 'running', claimed_at = ?, progress = 0, progress_msg = '작업을 시작했어요', updated_at = ?
        WHERE id = (SELECT id FROM tasks WHERE status = 'queued' ORDER BY created_at LIMIT 1)
        RETURNING *`,
    )
      .bind(now(), now())
      .first();
    if (!t) return null;
    const l = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?').bind(t.lecture_id).first();
    if (l) return { t, l };
    await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(t.id).run();
  }
  return null;
}

export async function handleEngine(request, env, path) {
  const m = request.method;
  let mm;
  if (path === '/api/engine/hello' && m === 'POST') {
    const b = await readJson(request);
    await setSettings(env, { engine_last_seen: now(), engine_info: JSON.stringify({ version: str(b.version, 40), status: str(b.status, 200), voice: str(b.voice, 80), host: str(b.host, 80) }) });
    const s = await getSettings(env);
    return json({
      academy_name: s.academy_name,
      header_text: s.header_text,
      has_logo: !!s.logo_key,
      default_minutes: s.default_minutes,
      default_tone: s.default_tone,
      board_style: cleanStyle(s.board_style),
    });
  }
  if (path === '/api/engine/logo' && m === 'GET') {
    const s = await getSettings(env);
    if (!s.logo_key) throw new HttpError(404, '로고가 없어요.');
    return serveObject(request, env, s.logo_key, { cache: 'no-store' });
  }

  // ---------------------------------------------------------------- 다음 일 받기 (강의 먼저, 그다음 자막·요약)
  if (path === '/api/engine/next' && m === 'POST') {
    await setSettings(env, { engine_last_seen: now() });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE lectures SET status = CASE status WHEN 'scripting' THEN 'queued' ELSE 'render_queued' END, updated_at = ?
          WHERE status IN ('scripting','rendering') AND engine_claimed_at < ?`,
      ).bind(now(), now() - STALE),
      env.DB.prepare("UPDATE tasks SET status = 'queued', updated_at = ? WHERE status = 'running' AND claimed_at < ?").bind(now(), now() - STALE),
    ]);
    const row = await claimLecture(env);
    if (row) {
      return json({
        job: {
          lecture_id: row.id,
          stage: row.status === 'scripting' ? 'script' : 'render',
          title: row.title,
          source: row.source,
          tool: row.tool,
          passage: row.passage,
          translation: row.translation,
          options: safeParse(row.options, {}),
          script: safeParse(row.script, null),
        },
      });
    }
    const got = await claimTask(env);
    if (!got) return json({ job: null });
    const { t, l } = got;
    return json({
      job: null,
      task: {
        id: t.id,
        kind: t.kind,
        lecture_id: l.id,
        title: l.title,
        source: l.source,
        tool: l.tool,
        duration: l.duration,
        has_video: !!l.video_key,
        passage: l.passage,
        options: safeParse(l.options, {}),
        script: safeParse(l.script, null),
        transcript: safeParse(l.transcript, null),
        edit: safeParse(l.edit, {}),
      },
    });
  }

  // ---------------------------------------------------------------- 강의 만들기 진행
  if ((mm = path.match(/^\/api\/engine\/lectures\/(\d+)\/(progress|script|done|fail)$/)) && m === 'POST') {
    const id = int(mm[1]);
    const b = await readJson(request);
    const l = await env.DB.prepare('SELECT status, options FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의가 없어요. 선생님이 지웠을 수 있어요.', 'gone');
    const act = mm[2];
    if (act === 'progress') {
      await env.DB.prepare('UPDATE lectures SET progress = ?, progress_msg = ?, engine_claimed_at = ?, updated_at = ? WHERE id = ?')
        .bind(Math.max(0, Math.min(100, int(b.progress, 0))), str(b.msg, 200), now(), now(), id)
        .run();
      await setSettings(env, { engine_last_seen: now() });
      return json({ ok: true, status: l.status });
    }
    if (act === 'script') {
      const opts = safeParse(l.options, {});
      const next = opts.auto_approve ? 'render_queued' : 'review';
      const script = typeof b.script === 'string' ? b.script : JSON.stringify(b.script);
      const title = opts.auto_title ? str(b.title, 120) : '';
      await env.DB.prepare(
        `UPDATE lectures SET script = ?, status = ?, progress = 100, progress_msg = NULL, error = NULL, updated_at = ?${title ? ', title = ?' : ''} WHERE id = ?`,
      )
        .bind(...(title ? [script, next, now(), title, id] : [script, next, now(), id]))
        .run();
      return json({ ok: true, status: next });
    }
    if (act === 'done') {
      const voice = cleanVoice(b.voice);
      const slots = cleanSlots(b.name_slots);
      const chapters = cleanChapters(b.chapters);
      const stmts = [
        env.DB.prepare(
          `UPDATE lectures SET status = 'done', progress = 100, progress_msg = NULL, error = NULL, duration = COALESCE(?, duration),
                  voice = ?, name_slots = ?, done_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(b.duration ? Number(b.duration) : null, voice ? JSON.stringify(voice) : null, slots.length ? JSON.stringify(slots) : null, now(), now(), id),
      ];
      if (chapters.length) {
        const cur = await env.DB.prepare('SELECT edit FROM lectures WHERE id = ?').bind(id).first();
        const edit = safeParse(cur && cur.edit, {}) || {};
        if (!Array.isArray(edit.chapters) || !edit.chapters.length || edit.auto_chapters) {
          edit.chapters = chapters;
          edit.auto_chapters = true;
          stmts.push(env.DB.prepare('UPDATE lectures SET edit = ? WHERE id = ?').bind(JSON.stringify(edit), id));
        }
      }
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
    if (act === 'fail') {
      await env.DB.prepare("UPDATE lectures SET status = 'failed', error = ?, progress_msg = NULL, updated_at = ? WHERE id = ?").bind(str(b.error, 1000), now(), id).run();
      return json({ ok: true });
    }
  }

  // 자막을 만들려고 선생님이 올린 영상을 받아 가요
  if ((mm = path.match(/^\/api\/engine\/lectures\/(\d+)\/video$/)) && (m === 'GET' || m === 'HEAD')) {
    const l = await env.DB.prepare('SELECT video_key FROM lectures WHERE id = ?').bind(int(mm[1])).first();
    if (!l) throw new HttpError(404, '강의가 없어요.', 'gone');
    if (!l.video_key) throw new HttpError(404, '영상이 아직 없어요.');
    return serveObject(request, env, l.video_key, { type: 'video/mp4', cache: 'no-store' });
  }

  // ---------------------------------------------------------------- 자막·요약 작업
  if ((mm = path.match(/^\/api\/engine\/tasks\/(\d+)\/(progress|done|fail)$/)) && m === 'POST') {
    const id = int(mm[1]);
    const b = await readJson(request);
    const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!t) throw new HttpError(404, '작업이 없어요. 선생님이 취소했을 수 있어요.', 'gone');
    const act = mm[2];
    if (act === 'progress') {
      await env.DB.prepare('UPDATE tasks SET progress = ?, progress_msg = ?, claimed_at = ?, updated_at = ? WHERE id = ?')
        .bind(Math.max(0, Math.min(100, int(b.progress, 0))), str(b.msg, 200), now(), now(), id)
        .run();
      await setSettings(env, { engine_last_seen: now() });
      return json({ ok: true });
    }
    if (act === 'fail') {
      await env.DB.prepare("UPDATE tasks SET status = 'failed', error = ?, progress_msg = NULL, updated_at = ? WHERE id = ?").bind(str(b.error, 1000), now(), id).run();
      return json({ ok: true });
    }
    // done
    const l = await env.DB.prepare('SELECT id, edit, options FROM lectures WHERE id = ?').bind(t.lecture_id).first();
    if (!l) throw new HttpError(404, '강의가 없어요.', 'gone');
    const stmts = [env.DB.prepare("UPDATE tasks SET status = 'done', progress = 100, progress_msg = NULL, error = NULL, updated_at = ? WHERE id = ?").bind(now(), id)];
    if (t.kind === 'transcribe' && Array.isArray(b.transcript)) {
      const segs = b.transcript
        .slice(0, 6000)
        .map((x) => ({ s: round2(x.s), e: round2(x.e), text: str(x.text, 400) }))
        .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.text);
      stmts.push(env.DB.prepare('UPDATE lectures SET transcript = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(segs), now(), l.id));
      const opts = safeParse(l.options, {}) || {};
      if (opts.auto_summary && segs.length) {
        const busy = await env.DB.prepare("SELECT id FROM tasks WHERE lecture_id = ? AND kind = 'summarize' AND status IN ('queued','running')").bind(l.id).first();
        if (!busy) stmts.push(env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, created_at, updated_at) VALUES ('summarize', ?, 'queued', ?, ?)").bind(l.id, now() + 1, now()));
      }
    }
    if (t.kind === 'summarize' && b.summary && typeof b.summary === 'object') {
      const sm = cleanSummary(b.summary);
      stmts.push(env.DB.prepare('UPDATE lectures SET summary = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(sm), now(), l.id));
      const edit = safeParse(l.edit, {}) || {};
      if ((!Array.isArray(edit.chapters) || !edit.chapters.length) && sm.chapters.length) {
        edit.chapters = sm.chapters;
        stmts.push(env.DB.prepare('UPDATE lectures SET edit = ? WHERE id = ?').bind(JSON.stringify(edit), l.id));
      }
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- 학생 이름 목소리
  if (path === '/api/engine/names/missing' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT u.id, u.name, u.call_name, l.voice
         FROM users u JOIN assignments a ON a.class_id = u.class_id JOIN lectures l ON l.id = a.lecture_id
        WHERE u.role = 'student' AND u.active = 1 AND l.status = 'done' AND l.voice IS NOT NULL AND l.name_slots IS NOT NULL`,
    ).all();
    const have = new Map();
    for (const r of (await env.DB.prepare('SELECT user_id, voice, text FROM name_clips').all()).results) have.set(`${r.user_id}|${r.voice}`, r.text);
    const out = [];
    const seen = new Set();
    for (const r of results) {
      const v = voiceOf(r.voice);
      if (!v) continue;
      const key = `${r.id}|${v.k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = callText(r, v.tone);
      if (!text || have.get(key) === text) continue;
      out.push({ user_id: r.id, text, voice: v });
      if (out.length >= 40) break;
    }
    return json({ names: out });
  }
  if ((mm = path.match(/^\/api\/engine\/names\/(\d+)$/)) && m === 'PUT') {
    const uid = int(mm[1]);
    const url = new URL(request.url);
    const k = str(url.searchParams.get('k'), 40);
    const text = str(url.searchParams.get('text'), 40);
    if (!/^[0-9a-f]{8,40}$/.test(k) || !text) throw new HttpError(400, '이름 목소리 정보가 올바르지 않아요.');
    const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").bind(uid).first();
    if (!u) throw new HttpError(404, '학생이 없어요.', 'gone');
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 400 * 1024) throw new HttpError(400, '이름 목소리 파일 크기가 올바르지 않아요.');
    const ct = (request.headers.get('Content-Type') || 'audio/mp4').split(';')[0];
    const ext = ct === 'audio/wav' ? 'wav' : ct === 'audio/mpeg' ? 'mp3' : 'm4a';
    const key = `names/${uid}-${k}-${Date.now()}.${ext}`;
    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: ct } });
    const old = await env.DB.prepare('SELECT key FROM name_clips WHERE user_id = ? AND voice = ?').bind(uid, k).first();
    await env.DB.prepare(
      `INSERT INTO name_clips (user_id, voice, key, text, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, voice) DO UPDATE SET key = excluded.key, text = excluded.text, created_at = excluded.created_at`,
    )
      .bind(uid, k, key, text, now())
      .run();
    if (old && old.key && old.key !== key) await env.BUCKET.delete(old.key);
    return json({ ok: true });
  }
  return null;
}

// AI 요약: 한 줄 요약, 핵심 정리, 목차, 단어, 확인 문제
export function cleanSummary(x) {
  const o = x && typeof x === 'object' ? x : {};
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    one_line: str(o.one_line, 200),
    points: arr(o.points, 12).map((p) => str(p, 300)).filter(Boolean),
    chapters: arr(o.chapters, 40)
      .map((c) => ({ t: Math.max(0, round2(c && c.t)), title: str(c && c.title, 60) }))
      .filter((c) => Number.isFinite(c.t) && c.title)
      .sort((a, b) => a.t - b.t),
    vocab: arr(o.vocab, 30)
      .map((v) => ({ en: str(v && v.en, 60), ko: str(v && v.ko, 80) }))
      .filter((v) => v.en),
    quiz: arr(o.quiz, 15)
      .map((q) => ({
        q: str(q && q.q, 300),
        choices: arr(q && q.choices, 5).map((c) => str(c, 160)).filter(Boolean),
        answer: Math.max(0, int(q && q.answer, 0)),
        why: str(q && q.why, 300),
      }))
      .filter((q) => q.q && q.choices.length >= 2),
  };
}

export { TASK_KINDS };
