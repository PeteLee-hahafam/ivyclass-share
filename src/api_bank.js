// 문제 은행과 그것으로 내는 것들(숙제, 출력용 숙제지, 모의고사), 그리고 선생님이 올린 자료(교과서 사진, 문제 자료)
import { HttpError, json, readJson, str, int, now, safeParse, getSettings, logoUrl } from './util.js';
import { readQuiz, publicQuiz, reviewQuiz, gradeAll, attemptOut, autoGrade, isOk } from './quiz.js';
import { bankRows, rowItem, usage, reserved, seenBy, drawHomework, drawPrint, drawMock, queueBank, homeworkOf, sortSet, ensureHomework, BANK_WANT, HW_PLAN, PRINT_PLAN, MOCK_N } from './bank.js';
import { canSeeLecture } from './api_student.js';
import { serveObject } from './media.js';

const FILE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};
const MAX_FILE = 20 * 1024 * 1024;
const ORPHAN_DAYS = 3;

function materialOut(r) {
  return { id: r.id, lecture_id: r.lecture_id, purpose: r.purpose, name: r.name, mime: r.mime, size: r.size, has_file: !!r.key, text: r.key ? undefined : r.text, created_at: r.created_at };
}

// 강의를 만들지 않고 남은 교과서 사진은 며칠 뒤 지워요
async function dropOrphans(env) {
  const { results } = await env.DB.prepare("SELECT id, key FROM materials WHERE lecture_id IS NULL AND purpose = 'passage' AND created_at < ?").bind(now() - ORPHAN_DAYS * 86400).all();
  for (const r of results) {
    if (r.key) await env.BUCKET.delete(r.key);
    await env.DB.prepare('DELETE FROM materials WHERE id = ?').bind(r.id).run();
  }
}

export async function deleteMaterial(env, r) {
  if (r.key) await env.BUCKET.delete(r.key);
  await env.DB.prepare('DELETE FROM materials WHERE id = ?').bind(r.id).run();
}

// 강의를 지울 때 함께 지울 것들
export async function deleteLectureBank(env, lectureId) {
  const { results } = await env.DB.prepare('SELECT id, key FROM materials WHERE lecture_id = ?').bind(lectureId).all();
  for (const r of results) if (r.key) await env.BUCKET.delete(r.key);
  return [
    env.DB.prepare('DELETE FROM materials WHERE lecture_id = ?').bind(lectureId),
    env.DB.prepare('DELETE FROM bank_items WHERE lecture_id = ?').bind(lectureId),
    env.DB.prepare('DELETE FROM hw_attempts WHERE lecture_id = ?').bind(lectureId),
    env.DB.prepare('DELETE FROM mock_attempts WHERE lecture_id = ?').bind(lectureId),
    env.DB.prepare('DELETE FROM print_sets WHERE lecture_id = ?').bind(lectureId),
  ];
}

async function lectureOr404(env, id, cols = 'id, title, source, status') {
  const l = await env.DB.prepare(`SELECT ${cols} FROM lectures WHERE id = ?`).bind(id).first();
  if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
  return l;
}

async function lastBankTask(env, lectureId) {
  return env.DB.prepare("SELECT id, status, progress, progress_msg, error, created_at FROM tasks WHERE lecture_id = ? AND kind = 'bank' ORDER BY id DESC LIMIT 1").bind(lectureId).first();
}

// ---------------------------------------------------------------- 예전 강의에 확인 문제와 숙제 한 번에 만들기
// 확인 문제와 문제 은행은 강의가 완성될 때 저절로 만들어지는데, 그 기능이 생기기 전에 만든 강의는 비어 있어요.
// 엔진 작업에는 backfill 표시를 붙여서 새 강의, 사진 읽기, 레벨테스트 채점보다 뒤에 받게 해요 (api_engine.js claimTask)
const BACKFILL_MARK = '%"backfill":true%';

async function backfillNeeds(env) {
  const quiz = (
    await env.DB.prepare(
      `SELECT l.id FROM lectures l WHERE l.status = 'done' AND l.quiz IS NULL AND (l.script IS NOT NULL OR l.transcript IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lecture_id = l.id AND t.kind = 'quiz' AND t.status IN ('queued','running'))`,
    ).all()
  ).results.map((r) => r.id);
  const bank = (
    await env.DB.prepare(
      `SELECT l.id FROM lectures l WHERE l.status = 'done' AND (l.script IS NOT NULL OR l.transcript IS NOT NULL OR l.passage IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM bank_items b WHERE b.lecture_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lecture_id = l.id AND t.kind = 'bank' AND t.status IN ('queued','running'))`,
    ).all()
  ).results.map((r) => r.id);
  // 은행은 있는데 사이트 숙제가 없는 강의 (엔진 없이 바로 뽑아요)
  const hw = (
    await env.DB.prepare(
      `SELECT l.id FROM lectures l WHERE l.status = 'done' AND l.homework IS NULL AND EXISTS (SELECT 1 FROM bank_items b WHERE b.lecture_id = l.id AND b.type = 'mc')`,
    ).all()
  ).results.map((r) => r.id);
  const w = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running') AND payload LIKE ?").bind(BACKFILL_MARK).first();
  return { quiz, bank, hw, working: (w && w.n) || 0 };
}

// ==================================================================== 선생님
export async function handleBankAdmin(request, env, path, user) {
  const m = request.method;
  const url = new URL(request.url);
  let mm;

  if (path === '/api/admin/backfill' && m === 'GET') {
    const n = await backfillNeeds(env);
    return json({ quiz: n.quiz.length, bank: n.bank.length, hw: n.hw.length, lectures: new Set([...n.quiz, ...n.bank, ...n.hw]).size, working: n.working });
  }
  if (path === '/api/admin/backfill' && m === 'POST') {
    const n = await backfillNeeds(env);
    let hwMade = 0;
    for (const id of n.hw.slice(0, 100)) if (await ensureHomework(env, id)) hwMade++;
    const stmts = [];
    const t0 = now();
    n.quiz.forEach((id, i) => {
      stmts.push(env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('quiz', ?, 'queued', ?, ?, ?)").bind(id, JSON.stringify({ backfill: true }), t0 + i * 2, t0));
    });
    n.bank.forEach((id, i) => {
      stmts.push(env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('bank', ?, 'queued', ?, ?, ?)").bind(id, JSON.stringify({ want: BANK_WANT, backfill: true }), t0 + i * 2 + 1, t0));
    });
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    return json({ ok: true, quiz: n.quiz.length, bank: n.bank.length, hw: hwMade, lectures: new Set([...n.quiz, ...n.bank, ...n.hw]).size });
  }

  // ---------------------------------------------------------------- 문제 은행
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/bank$/))) {
    const id = int(mm[1]);
    const l = await lectureOr404(env, id, 'id, title, status, script, transcript, passage');
    if (m === 'POST') {
      if (!l.script && !l.transcript && !l.passage) throw new HttpError(400, '문제를 만들 지문이나 자막이 없어요.');
      const b = await readJson(request);
      const r = await queueBank(env, id, { want: { mc: Math.min(40, Math.max(6, int(b.mc, BANK_WANT.mc))), sa: Math.min(12, Math.max(0, int(b.sa, BANK_WANT.sa))) } });
      if (!r) throw new HttpError(409, '이 강의에는 문제가 충분히 쌓여 있어요.');
      return json({ ok: true, ...r });
    }
    if (m === 'GET') {
      const rows = await bankRows(env, id, true);
      const use = await usage(env, id);
      const items = rows.map((r) => ({ ...rowItem(r), score: r.score, hidden: !!r.hidden, source: r.source, used: [use.hwIds.has(r.id) && 'hw', use.printIds.has(r.id) && 'print', use.examIds.has(r.id) && 'exam', use.mockIds.has(r.id) && 'mock'].filter(Boolean) }));
      const live = items.filter((x) => !x.hidden);
      const seeds = (await env.DB.prepare("SELECT COUNT(*) AS n FROM materials WHERE lecture_id = ? AND purpose = 'seed'").bind(id).first()).n;
      return json({
        counts: { mc: live.filter((x) => x.type === 'mc').length, sa: live.filter((x) => x.type === 'sa').length, hidden: items.length - live.length, seeds },
        task: await lastBankTask(env, id),
        items,
      });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/bank\/(\d+)$/)) && m === 'PUT') {
    const b = await readJson(request);
    await env.DB.prepare('UPDATE bank_items SET hidden = ? WHERE id = ?').bind(b.hidden ? 1 : 0, int(mm[1])).run();
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- 사이트 숙제 (객관식 10 + 서술형 5)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/homework$/))) {
    const id = int(mm[1]);
    const l = await lectureOr404(env, id, 'id, homework');
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE lectures SET homework = NULL, updated_at = ? WHERE id = ?').bind(now(), id).run();
      return json({ ok: true });
    }
    if (m === 'POST') {
      // 은행에서 새로 뽑기 (새 숙제가 되면 학생들은 새 문제를 풀어요)
      const rows = await bankRows(env, id);
      const use = await usage(env, id);
      if (l.homework) for (const x of safeParse(l.homework, {}).bank_ids || []) use.hwIds.delete(x);
      const items = drawHomework(rows, use);
      if (items.filter((x) => x.type === 'mc').length < 5) {
        const q = await queueBank(env, id);
        throw new HttpError(409, q ? '문제 은행에 문제가 모자라서 새 문제를 만들고 있어요. 다 만들어지면 다시 눌러 주세요.' : '문제 은행에 문제가 모자라요.', 'bank_more');
      }
      await env.DB.prepare('UPDATE lectures SET homework = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(homeworkOf(items)), now(), id).run();
      return json({ ok: true, n: items.length });
    }
    if (m === 'GET') {
      const hw = readQuiz(l.homework);
      const task = await lastBankTask(env, id);
      if (!hw) return json({ homework: null, task });
      const rows = (
        await env.DB.prepare(
          `SELECT ha.*, u.name, u.login_id, c.name AS class_name FROM hw_attempts ha JOIN users u ON u.id = ha.user_id LEFT JOIN classes c ON c.id = u.class_id
            WHERE ha.lecture_id = ? AND ha.hw_ver = ? ORDER BY c.name, u.name`,
        )
          .bind(id, hw.ver)
          .all()
      ).results;
      const attempts = rows.map((r) => ({ ...attemptOut(r), user_id: r.user_id, name: r.name, login_id: r.login_id, class_name: r.class_name }));
      const pending = (
        await env.DB.prepare(
          `SELECT u.id, u.name, c.name AS class_name FROM assignments a JOIN users u ON u.class_id = a.class_id AND u.role = 'student' AND u.active = 1
             JOIN classes c ON c.id = a.class_id
            WHERE a.lecture_id = ? AND c.archived = 0 AND NOT EXISTS (SELECT 1 FROM hw_attempts ha WHERE ha.user_id = u.id AND ha.lecture_id = a.lecture_id AND ha.hw_ver = ?)
            ORDER BY c.name, u.name`,
        )
          .bind(id, hw.ver)
          .all()
      ).results;
      const right = hw.items.map((_, i) => attempts.filter((a) => isOk(a.results[i])).length);
      return json({ homework: reviewQuiz(hw), task, attempts, pending, right });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/hw-attempts\/(\d+)$/))) {
    const aid = int(mm[1]);
    const r = await env.DB.prepare(
      `SELECT ha.*, l.homework, u.name, c.name AS class_name FROM hw_attempts ha JOIN lectures l ON l.id = ha.lecture_id
         JOIN users u ON u.id = ha.user_id LEFT JOIN classes c ON c.id = u.class_id WHERE ha.id = ?`,
    )
      .bind(aid)
      .first();
    if (!r) throw new HttpError(404, '푼 기록을 찾을 수 없어요.');
    if (m === 'GET') {
      // 반 성적표에서 한 학생 답안을 열 때
      const hw = readQuiz(r.homework);
      if (!hw || hw.ver !== r.hw_ver) throw new HttpError(409, '숙제가 새로 바뀌어서 이 답안은 볼 수 없어요.');
      return json({ quiz: reviewQuiz(hw), attempt: { ...attemptOut(r), name: r.name, class_name: r.class_name } });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM hw_attempts WHERE id = ?').bind(aid).run();
      return json({ ok: true });
    }
    if (m === 'PUT') {
      const hw = readQuiz(r.homework);
      if (!hw || hw.ver !== r.hw_ver) throw new HttpError(409, '숙제가 바뀌어서 이 기록은 고칠 수 없어요.');
      const b = await readJson(request);
      const i = int(b.i, -1);
      if (i < 0 || i >= hw.items.length) throw new HttpError(400, '문항 번호가 올바르지 않아요.');
      const results = safeParse(r.results, []) || [];
      const answers = safeParse(r.answers, []) || [];
      results[i] = b.ok === true ? 2 : b.ok === false ? 3 : autoGrade(hw.items[i], answers[i] ?? null);
      const score = hw.items.filter((_, k) => isOk(results[k])).length;
      await env.DB.prepare('UPDATE hw_attempts SET results = ?, score = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(results), score, now(), aid).run();
      return json({ ok: true, results, score });
    }
  }

  // ---------------------------------------------------------------- 출력용 숙제지 (뽑을 때마다 다른 문제)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/prints$/))) {
    const id = int(mm[1]);
    await lectureOr404(env, id);
    if (m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, items, created_at FROM print_sets WHERE lecture_id = ? ORDER BY id DESC LIMIT 30').bind(id).all();
      return json({ prints: results.map((r) => ({ id: r.id, n: (safeParse(r.items, []) || []).length, created_at: r.created_at })) });
    }
    if (m === 'POST') {
      const rows = await bankRows(env, id);
      const items = drawPrint(rows, await usage(env, id));
      if (!items) {
        const q = await queueBank(env, id, { want: { mc: 28, sa: 8 } });
        throw new HttpError(409, q ? '숙제지로 뽑을 새 문제가 모자라서 지금 더 만들고 있어요. 2~3분 뒤 다시 눌러 주세요.' : '숙제지로 뽑을 새 문제가 모자라요.', 'bank_more');
      }
      const r = await env.DB.prepare('INSERT INTO print_sets (lecture_id, items, bank_ids, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, JSON.stringify(items.map((it, i) => ({ no: i + 1, ...it }))), JSON.stringify(items.map((x) => x.bank_id)), now())
        .run();
      // 다음 숙제지를 뽑을 문제가 모자라면 미리 채워 둬요
      const left = drawPrint(await bankRows(env, id), await usage(env, id));
      if (!left) await queueBank(env, id, { want: { mc: 28, sa: 8 } });
      return json({ ok: true, id: r.meta.last_row_id, n: items.length });
    }
  }
  if ((mm = path.match(/^\/api\/admin\/prints\/(\d+)$/))) {
    const pid = int(mm[1]);
    const p = await env.DB.prepare('SELECT * FROM print_sets WHERE id = ?').bind(pid).first();
    if (!p) throw new HttpError(404, '숙제지를 찾을 수 없어요.');
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM print_sets WHERE id = ?').bind(pid).run();
      return json({ ok: true });
    }
    if (m === 'GET') {
      const l = await env.DB.prepare('SELECT id, title, source FROM lectures WHERE id = ?').bind(p.lecture_id).first();
      const s = await getSettings(env);
      const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM print_sets WHERE lecture_id = ? AND id <= ?').bind(p.lecture_id, pid).first()).n;
      const items = safeParse(p.items, []) || [];
      const title = l ? l.title : '숙제';
      return json({
        print: { id: p.id, no: n, created_at: p.created_at, items },
        lecture: l ? { id: l.id, title: l.title, source: l.source } : null,
        academy: { name: s.academy_name, phone: s.academy_phone, logo: logoUrl(s), header: s.header_text },
        // 인쇄 화면이 쓰는 문서 (확인 문제, 시험과 같은 모양)
        doc: { kind: 'print', title, label: `숙제지 ${n}`, what: '숙제지', kicker: (l && l.source) || s.academy_name, date: p.created_at, items, file: `${title}_숙제지${n}` },
      });
    }
  }

  // ---------------------------------------------------------------- 모의고사 (학생이 푼 기록)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/mock$/)) && m === 'GET') {
    const id = int(mm[1]);
    await lectureOr404(env, id);
    const { results } = await env.DB.prepare(
      `SELECT ma.id, ma.user_id, ma.score, ma.total, ma.submitted_at, u.name, c.name AS class_name FROM mock_attempts ma JOIN users u ON u.id = ma.user_id
         LEFT JOIN classes c ON c.id = u.class_id WHERE ma.lecture_id = ? AND ma.submitted_at IS NOT NULL ORDER BY ma.submitted_at DESC LIMIT 400`,
    )
      .bind(id)
      .all();
    const by = new Map();
    for (const r of results) {
      const s = by.get(r.user_id) || { user_id: r.user_id, name: r.name, class_name: r.class_name, n: 0, best: 0, last: null, last_at: 0 };
      s.n++;
      s.best = Math.max(s.best, r.total ? r.score / r.total : 0);
      if (r.submitted_at > s.last_at) {
        s.last_at = r.submitted_at;
        s.last = `${r.score}/${r.total}`;
      }
      by.set(r.user_id, s);
    }
    const n = results.length;
    const avg = n ? results.reduce((t, r) => t + (r.total ? r.score / r.total : 0), 0) / n : 0;
    // 모의고사에 나오는 문제: 객관식 중 출력한 숙제지와 시험에 쓰지 않은 것
    const use = await usage(env, id);
    const pool = (await bankRows(env, id)).filter((r) => r.type === 'mc' && !reserved(use, r.id)).length;
    return json({ attempts: n, avg, pool, students: [...by.values()].sort((a, b) => b.last_at - a.last_at) });
  }

  // ---------------------------------------------------------------- 올린 자료 (교과서 사진·PDF, 문제 자료)
  if (path === '/api/admin/materials' && m === 'GET') {
    await dropOrphans(env);
    const lid = int(url.searchParams.get('lecture_id'));
    const purpose = url.searchParams.get('purpose');
    const where = [];
    const binds = [];
    if (lid) where.push('lecture_id = ?'), binds.push(lid);
    if (purpose) where.push('purpose = ?'), binds.push(purpose);
    const { results } = await env.DB.prepare(`SELECT * FROM materials ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).bind(...binds).all();
    return json({ materials: results.map(materialOut) });
  }
  if (path === '/api/admin/materials' && m === 'POST') {
    // 붙여 넣은 글 자료 (문제 자료)
    const b = await readJson(request);
    const text = str(b.text, 60000);
    if (text.length < 20) throw new HttpError(400, '자료 글을 붙여 넣어 주세요.');
    const lid = int(b.lecture_id);
    if (lid) await lectureOr404(env, lid);
    const r = await env.DB.prepare("INSERT INTO materials (lecture_id, purpose, name, mime, size, text, created_at, updated_at) VALUES (?, ?, ?, 'text/plain', ?, ?, ?, ?)")
      .bind(lid || null, b.purpose === 'passage' ? 'passage' : 'seed', str(b.name, 120) || '붙여 넣은 자료', text.length, text, now(), now())
      .run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (path === '/api/admin/materials' && m === 'PUT') {
    // 파일 자료: 사진(JPG, PNG, WebP), PDF. 몸통에 파일을 그대로 보내요
    const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!FILE_TYPES[mime]) throw new HttpError(400, '사진(JPG, PNG)이나 PDF 파일만 올릴 수 있어요. 한글(HWP) 파일은 PDF로 저장해서 올려 주세요.');
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) throw new HttpError(400, '빈 파일이에요.');
    if (buf.byteLength > MAX_FILE) throw new HttpError(400, '파일이 너무 커요 (20MB까지).');
    const lid = int(url.searchParams.get('lecture_id'));
    if (lid) await lectureOr404(env, lid);
    const purpose = url.searchParams.get('purpose') === 'seed' ? 'seed' : 'passage';
    const key = `materials/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${FILE_TYPES[mime]}`;
    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: mime } });
    const r = await env.DB.prepare('INSERT INTO materials (lecture_id, purpose, name, mime, size, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(lid || null, purpose, str(url.searchParams.get('name'), 120) || '자료', mime, buf.byteLength, key, now(), now())
      .run();
    await dropOrphans(env);
    return json({ ok: true, material: materialOut(await env.DB.prepare('SELECT * FROM materials WHERE id = ?').bind(r.meta.last_row_id).first()) });
  }
  if (path === '/api/admin/materials/read' && m === 'POST') {
    // 교과서 사진·PDF에서 지문 글자 읽기 (학원 PC 엔진이 해요)
    const b = await readJson(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 12);
    if (!ids.length) throw new HttpError(400, '읽을 사진이나 PDF를 골라 주세요.');
    const { results } = await env.DB.prepare(`SELECT id FROM materials WHERE key IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    if (results.length !== ids.length) throw new HttpError(404, '자료 파일을 찾을 수 없어요. 다시 올려 주세요.');
    const r = await env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('read', NULL, 'queued', ?, ?, ?)")
      .bind(JSON.stringify({ ids }), now() - 60, now()) // 사진 읽기는 선생님이 기다리고 있어서 먼저 해요
      .run();
    return json({ ok: true, task_id: r.meta.last_row_id });
  }
  if (path === '/api/admin/materials/attach' && m === 'POST') {
    // 사진으로 만든 강의에 그 사진들을 붙여 둬요 (강의 화면에서 보고 지울 수 있게)
    const b = await readJson(request);
    const lid = int(b.lecture_id);
    await lectureOr404(env, lid);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 20);
    for (const mid of ids) await env.DB.prepare('UPDATE materials SET lecture_id = ?, updated_at = ? WHERE id = ? AND lecture_id IS NULL').bind(lid, now(), mid).run();
    return json({ ok: true });
  }
  if ((mm = path.match(/^\/api\/admin\/materials\/(\d+)(\/file)?$/))) {
    const r = await env.DB.prepare('SELECT * FROM materials WHERE id = ?').bind(int(mm[1])).first();
    if (!r) throw new HttpError(404, '자료를 찾을 수 없어요.');
    if (mm[2] && (m === 'GET' || m === 'HEAD')) {
      if (!r.key) throw new HttpError(404, '파일이 없는 자료예요.');
      return serveObject(request, env, r.key, { type: r.mime, filename: r.name || 'material', cache: 'private, max-age=300' });
    }
    if (!mm[2] && m === 'DELETE') {
      await deleteMaterial(env, r);
      return json({ ok: true });
    }
    if (!mm[2] && m === 'GET') return json({ material: { ...materialOut(r), text: r.text } });
  }
  if ((mm = path.match(/^\/api\/admin\/tasks\/(\d+)$/)) && m === 'GET') {
    const t = await env.DB.prepare('SELECT id, kind, lecture_id, status, progress, progress_msg, error, result FROM tasks WHERE id = ?').bind(int(mm[1])).first();
    if (!t) throw new HttpError(404, '작업을 찾을 수 없어요.');
    return json({ task: { ...t, result: safeParse(t.result, null) } });
  }
  return null;
}

// ==================================================================== 학생
async function target(env, user, url) {
  if (user.role !== 'admin') return user;
  const uid = int(url.searchParams.get('as'));
  if (!uid) throw new HttpError(400, '미리 볼 학생을 골라 주세요.');
  const u = await env.DB.prepare("SELECT id, name, call_name, class_id, role FROM users WHERE id = ? AND role = 'student'").bind(uid).first();
  if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
  return u;
}

// 강의 화면에 보여 줄 숙제·모의고사 요약
export async function studentExtras(env, lectureId, userId) {
  const l = await env.DB.prepare('SELECT homework FROM lectures WHERE id = ?').bind(lectureId).first();
  const hw = readQuiz(l && l.homework);
  const ha = hw ? await env.DB.prepare('SELECT score, total, created_at FROM hw_attempts WHERE user_id = ? AND lecture_id = ? AND hw_ver = ?').bind(userId, lectureId, hw.ver).first() : null;
  const pool = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bank_items WHERE lecture_id = ? AND hidden = 0 AND type = 'mc'").bind(lectureId).first()).n;
  const { results } = await env.DB.prepare('SELECT score, total, submitted_at FROM mock_attempts WHERE user_id = ? AND lecture_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 50').bind(userId, lectureId).all();
  return {
    homework: hw ? { ver: hw.ver, n: hw.items.length, mc: hw.items.filter((x) => x.type === 'mc').length, sa: hw.items.filter((x) => x.type === 'sa').length } : null,
    homework_result: ha || null,
    mock: pool >= MOCK_N ? { n: MOCK_N, times: results.length, last: results[0] || null, best: results.reduce((b, r) => Math.max(b, r.score), 0) } : null,
  };
}

export async function handleBankStudent(request, env, path, user) {
  const m = request.method;
  const url = new URL(request.url);
  let mm;
  // ---------------------------------------------------------------- 사이트 숙제 (한 번 내요)
  if ((mm = path.match(/^\/api\/student\/lectures\/(\d+)\/homework$/)) && (m === 'GET' || m === 'POST')) {
    const id = int(mm[1]);
    const t = await target(env, user, url);
    if (!(await canSeeLecture(env, t, id))) throw new HttpError(404, '이 강의는 볼 수 없어요.');
    const l = await env.DB.prepare('SELECT id, title, homework FROM lectures WHERE id = ?').bind(id).first();
    const hw = readQuiz(l && l.homework);
    if (!hw) throw new HttpError(404, '이 강의에는 아직 숙제가 없어요.');
    const getAttempt = () => env.DB.prepare('SELECT * FROM hw_attempts WHERE user_id = ? AND lecture_id = ? AND hw_ver = ?').bind(t.id, id, hw.ver).first();
    if (m === 'GET') {
      const a = await getAttempt();
      return json({ title: l.title, quiz: a ? reviewQuiz(hw) : publicQuiz(hw), attempt: attemptOut(a) });
    }
    const b = await readJson(request);
    if (Number(b.ver) !== hw.ver) throw new HttpError(409, '선생님이 숙제를 새로 바꿨어요. 화면을 새로 고쳐서 다시 풀어 주세요.', 'quiz_changed');
    const g = gradeAll(hw, b.answers);
    if (user.role === 'admin') return json({ quiz: reviewQuiz(hw), attempt: { id: 0, score: g.score, total: g.total, created_at: now(), answers: g.answers, results: g.results }, preview: true });
    const old = await getAttempt();
    if (old) return json({ quiz: reviewQuiz(hw), attempt: attemptOut(old), already: true });
    await env.DB.prepare(
      `INSERT INTO hw_attempts (user_id, lecture_id, hw_ver, answers, results, score, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, lecture_id, hw_ver) DO NOTHING`,
    )
      .bind(user.id, id, hw.ver, JSON.stringify(g.answers), JSON.stringify(g.results), g.score, g.total, now(), now())
      .run();
    return json({ quiz: reviewQuiz(hw), attempt: attemptOut(await getAttempt()) });
  }

  // ---------------------------------------------------------------- 모의고사 (풀 때마다 새로 뽑아요)
  if ((mm = path.match(/^\/api\/student\/lectures\/(\d+)\/mock$/)) && (m === 'GET' || m === 'POST')) {
    const id = int(mm[1]);
    const t = await target(env, user, url);
    if (!(await canSeeLecture(env, t, id))) throw new HttpError(404, '이 강의는 볼 수 없어요.');
    const l = await env.DB.prepare('SELECT id, title FROM lectures WHERE id = ?').bind(id).first();
    const history = (
      await env.DB.prepare('SELECT id, score, total, submitted_at FROM mock_attempts WHERE user_id = ? AND lecture_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 20').bind(t.id, id).all()
    ).results;
    const rows = await bankRows(env, id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const open = user.role === 'admin' ? null : await env.DB.prepare('SELECT * FROM mock_attempts WHERE user_id = ? AND lecture_id = ? AND submitted_at IS NULL ORDER BY id DESC LIMIT 1').bind(t.id, id).first();
    const shown = (ids) => ids.map((x) => byId.get(x)).filter(Boolean).map(rowItem);
    // 전에 본 문제가 섞였을 때 학생에게 까닭을 알려 줘요: 새 문제를 만드는 중인지
    const making = async () => {
      const bt = await lastBankTask(env, id);
      return !!(bt && (bt.status === 'queued' || bt.status === 'running'));
    };
    if (m === 'GET') {
      // 풀던 모의고사가 있으면 그대로 이어서 풀어요
      if (open) {
        const items = shown(safeParse(open.items, []) || []);
        if (items.length) {
          const seen = seenBy(await usage(env, id, t.id, open.id));
          const ids = items.map((x) => x.bank_id);
          const repeat = ids.filter(seen).length;
          return json({ title: l.title, history, attempt: { id: open.id, ids, repeat, making: repeat > 0 && (await making()), quiz: publicQuiz({ ver: open.id, items: items.map((x, i) => ({ no: i + 1, ...x })) }) } });
        }
      }
      return json({ title: l.title, history, attempt: null, pool: rows.filter((r) => r.type === 'mc').length });
    }
    // 새 모의고사 뽑기
    const use = await usage(env, id, t.id);
    const { items, unseenLeft, repeat } = drawMock(rows, use);
    if (items.length < 5) throw new HttpError(409, '모의고사 문제를 아직 만들고 있어요. 조금 뒤 다시 해 주세요.', 'bank_more');
    const ids = items.map((x) => x.bank_id);
    let aid = 0;
    if (user.role !== 'admin') {
      if (open) await env.DB.prepare('DELETE FROM mock_attempts WHERE id = ?').bind(open.id).run();
      const r = await env.DB.prepare('INSERT INTO mock_attempts (user_id, lecture_id, items, total, created_at) VALUES (?, ?, ?, ?, ?)').bind(t.id, id, JSON.stringify(ids), ids.length, now()).run();
      aid = r.meta.last_row_id;
      // 이 학생이 안 본 문제가 다음 한 번보다 적으면 엔진이 새 문제를 더 만들어 둬요
      if (unseenLeft < MOCK_N) await queueBank(env, id, { auto: true });
    }
    return json({ title: l.title, history, attempt: { id: aid, ids, repeat, making: repeat > 0 && (await making()), quiz: publicQuiz({ ver: aid, items: items.map((x, i) => ({ no: i + 1, ...x })) }) } });
  }
  if ((mm = path.match(/^\/api\/student\/mock\/(\d+)$/)) && m === 'POST') {
    const aid = int(mm[1]);
    const b = await readJson(request);
    let ids;
    let lectureId;
    if (aid === 0) {
      // 선생님 미리보기: 채점만 해요
      if (user.role !== 'admin') throw new HttpError(404, '모의고사를 찾을 수 없어요.');
      ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 20);
      lectureId = int(b.lecture_id);
    } else {
      const a = await env.DB.prepare('SELECT * FROM mock_attempts WHERE id = ? AND user_id = ?').bind(aid, user.id).first();
      if (!a) throw new HttpError(404, '모의고사를 찾을 수 없어요.');
      if (a.submitted_at) throw new HttpError(409, '이미 낸 모의고사예요.', 'already');
      ids = safeParse(a.items, []) || [];
      lectureId = a.lecture_id;
    }
    const rows = ids.length ? (await env.DB.prepare(`SELECT * FROM bank_items WHERE lecture_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(lectureId, ...ids).all()).results : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = ids.map((x) => byId.get(x)).filter(Boolean).map((r, i) => ({ no: i + 1, ...rowItem(r) }));
    if (!items.length) throw new HttpError(404, '모의고사 문제를 찾을 수 없어요.');
    const q = { ver: aid, items };
    const g = gradeAll(q, b.answers);
    if (aid) {
      await env.DB.prepare('UPDATE mock_attempts SET answers = ?, results = ?, score = ?, total = ?, submitted_at = ? WHERE id = ?')
        .bind(JSON.stringify(g.answers), JSON.stringify(g.results), g.score, g.total, now(), aid)
        .run();
    }
    return json({ quiz: reviewQuiz(q), attempt: { id: aid, score: g.score, total: g.total, created_at: now(), answers: g.answers, results: g.results }, preview: !aid });
  }
  return null;
}

export { sortSet, HW_PLAN, PRINT_PLAN };
