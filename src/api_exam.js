// 시험: 선생님이 확인 문제와 문제 은행에서 골라 만든 문제 묶음이에요.
// - 인쇄: print.html 이 쓰는 문서(시험지, 답안지, 정답과 해설). 확인 문제 그대로 인쇄하기도 여기서 만들어요
// - 반에 내기: 그 반 학생 앱에 나타나고, 학생이 풀면 바로 채점해요 (정답과 해설은 reveal 이 켜져 있을 때만)
// - 종이 답안 넣기: 종이로 본 시험은 선생님이 학생 답을 넣으면 같은 방법으로 채점해요
// - 반 성적표: 반 학생들의 확인 문제, 숙제, 시험 점수를 한 표로 모아요
import { HttpError, json, readJson, str, int, now, safeParse, getSettings, logoUrl } from './util.js';
import { readQuiz, publicQuiz, reviewQuiz, gradeAll, attemptOut, autoGrade, isOk } from './quiz.js';
import { bankRows, rowItem, usage } from './bank.js';

const MAX_ITEMS = 60;

const academyOf = (s) => ({ name: s.academy_name, phone: s.academy_phone, logo: logoUrl(s), header: s.header_text });
const inList = (n) => Array.from({ length: n }, () => '?').join(',');
const levelOf = (l) => {
  const o = safeParse(l && l.options, {}) || {};
  return typeof o.level === 'string' ? o.level : '';
};

// 인쇄 화면에 보낼 문항 (어디서 왔는지는 빼요)
const printItems = (items) => items.map(({ src, ...it }, i) => ({ ...it, no: i + 1 })); // eslint-disable-line no-unused-vars

// ---------------------------------------------------------------- 고른 문제를 문항으로
// picks: [{k:'quiz', l, n, v}] 확인 문제 n번(v 는 그때 확인 문제 버전), [{k:'bank', l, id}] 문제 은행, [{k:'exam', e, n}] 다른 시험의 문항 그대로(고치거나 복사할 때)
// 서버가 지금 문제에서 정답과 해설까지 다시 꺼내요. 없어졌거나 바뀐 문제는 빼고 dropped 로 세요
async function resolvePicks(env, picks) {
  const list = (Array.isArray(picks) ? picks : []).filter((p) => p && typeof p === 'object').slice(0, MAX_ITEMS * 2);
  const lids = [...new Set(list.filter((p) => p.k === 'quiz' || p.k === 'bank').map((p) => int(p.l)).filter(Boolean))].slice(0, 40);
  const lecs = new Map();
  if (lids.length) {
    const { results } = await env.DB.prepare(`SELECT id, title, quiz FROM lectures WHERE id IN (${inList(lids.length)})`).bind(...lids).all();
    for (const l of results) lecs.set(l.id, { id: l.id, title: l.title, quiz: readQuiz(l.quiz) });
  }
  const bankIds = [...new Set(list.filter((p) => p.k === 'bank').map((p) => int(p.id)).filter(Boolean))];
  const bank = new Map();
  for (let i = 0; i < bankIds.length; i += 90) {
    const chunk = bankIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT * FROM bank_items WHERE id IN (${inList(chunk.length)})`).bind(...chunk).all();
    for (const r of results) bank.set(r.id, r);
  }
  const examIds = [...new Set(list.filter((p) => p.k === 'exam').map((p) => int(p.e)).filter(Boolean))].slice(0, 20);
  const exams = new Map();
  if (examIds.length) {
    const { results } = await env.DB.prepare(`SELECT id, items FROM exams WHERE id IN (${inList(examIds.length)})`).bind(...examIds).all();
    for (const e of results) exams.set(e.id, readQuiz(e.items));
  }
  const seen = new Set();
  const items = [];
  let dropped = 0;
  for (const p of list) {
    let it = null;
    if (p.k === 'quiz') {
      const l = lecs.get(int(p.l));
      const n = int(p.n);
      const q = l && l.quiz;
      if (q && (!p.v || int(p.v) === q.ver)) {
        const found = q.items.find((x) => x.no === n);
        if (found) {
          const { no, ...rest } = found; // eslint-disable-line no-unused-vars
          it = { ...rest, src: { k: 'quiz', l: l.id, n, v: q.ver, t: l.title } };
        }
      }
    } else if (p.k === 'bank') {
      const r = bank.get(int(p.id));
      const x = r && rowItem(r);
      if (x) {
        const { bank_id, ...rest } = x; // eslint-disable-line no-unused-vars
        const l = lecs.get(r.lecture_id);
        it = { ...rest, src: { k: 'bank', l: r.lecture_id, id: r.id, t: l ? l.title : '' } };
      }
    } else if (p.k === 'exam') {
      const q = exams.get(int(p.e));
      const found = q && q.items.find((x) => x.no === int(p.n));
      if (found) {
        const { no, ...rest } = found; // eslint-disable-line no-unused-vars
        it = rest;
      }
    }
    if (!it) {
      dropped++;
      continue;
    }
    const s = it.src || {};
    const key = s.k === 'bank' ? `b${s.id}` : s.k === 'quiz' ? `q${s.l}:${s.v}:${s.n}` : `x${items.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
    if (items.length >= MAX_ITEMS) break;
  }
  // 객관식 먼저, 그다음 서술형 (고른 차례는 그대로 둬요)
  const ordered = [...items.filter((x) => x.type === 'mc'), ...items.filter((x) => x.type === 'sa')];
  return {
    items: ordered.map((x, i) => ({ no: i + 1, ...x })),
    lectureIds: [...new Set(ordered.map((x) => x.src && x.src.l).filter(Boolean))],
    bankIds: ordered.filter((x) => x.src && x.src.k === 'bank').map((x) => x.src.id),
    dropped,
  };
}

async function examOr404(env, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?').bind(id).first();
  if (!e) throw new HttpError(404, '시험을 찾을 수 없어요.');
  const q = readQuiz(e.items);
  if (!q) throw new HttpError(500, '시험 문제를 읽을 수 없어요.');
  return { e, q };
}

const counts = (items) => ({ n: items.length, mc: items.filter((x) => x.type === 'mc').length, sa: items.filter((x) => x.type === 'sa').length });

// 문항마다 맞힌 학생 수
const rightOf = (q, attempts) => q.items.map((_, i) => attempts.filter((a) => isOk(a.results[i])).length);

// ==================================================================== 선생님
export async function handleExamAdmin(request, env, path) {
  const m = request.method;
  let mm;

  // ---------------------------------------------------------------- 시험 목록과 만들기
  if (path === '/api/admin/exams' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.title, e.reveal, e.created_at, e.updated_at, e.lecture_ids,
              json_array_length(e.items, '$.items') AS n,
              (SELECT COUNT(*) FROM json_each(e.items, '$.items') j WHERE json_extract(j.value, '$.type') = 'sa') AS sa,
              (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attempts,
              (SELECT AVG(CAST(a.score AS REAL) / a.total) FROM exam_attempts a WHERE a.exam_id = e.id AND a.total > 0) AS avg
         FROM exams e ORDER BY e.created_at DESC LIMIT 300`,
    ).all();
    const cls = (
      await env.DB.prepare(
        `SELECT ec.exam_id, ec.class_id, ec.due_at, ec.closed_at, c.name, c.color FROM exam_classes ec JOIN classes c ON c.id = ec.class_id
          WHERE c.archived = 0 ORDER BY c.name`,
      ).all()
    ).results;
    const lids = [...new Set(results.flatMap((e) => safeParse(e.lecture_ids, []) || []))];
    const titles = new Map();
    for (let i = 0; i < lids.length; i += 90) {
      const chunk = lids.slice(i, i + 90);
      const r = await env.DB.prepare(`SELECT id, title FROM lectures WHERE id IN (${inList(chunk.length)})`).bind(...chunk).all();
      for (const l of r.results) titles.set(l.id, l.title);
    }
    return json({
      exams: results.map((e) => ({
        id: e.id,
        title: e.title,
        reveal: !!e.reveal,
        created_at: e.created_at,
        updated_at: e.updated_at,
        n: e.n || 0,
        mc: (e.n || 0) - (e.sa || 0),
        sa: e.sa || 0,
        attempts: e.attempts,
        avg: e.avg,
        lectures: (safeParse(e.lecture_ids, []) || []).map((id) => ({ id, title: titles.get(id) || '' })),
        classes: cls.filter((c) => c.exam_id === e.id).map(({ exam_id, ...c }) => c), // eslint-disable-line no-unused-vars
      })),
    });
  }
  if (path === '/api/admin/exams' && m === 'POST') {
    const b = await readJson(request);
    const r = await resolvePicks(env, b.picks);
    if (!r.items.length) throw new HttpError(400, r.dropped ? '고른 문제를 찾을 수 없어요. 문제가 바뀌었는지 확인해 주세요.' : '문제를 하나 이상 골라 주세요.');
    const t = now();
    const ins = await env.DB.prepare('INSERT INTO exams (title, items, lecture_ids, bank_ids, reveal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(str(b.title, 80) || '시험', JSON.stringify({ v: 1, ver: t, items: r.items }), JSON.stringify(r.lectureIds), JSON.stringify(r.bankIds), b.reveal === false ? 0 : 1, t, t)
      .run();
    return json({ ok: true, id: ins.meta.last_row_id, n: r.items.length, dropped: r.dropped });
  }

  // ---------------------------------------------------------------- 시험 만들기 화면: 강의 하나의 문제 (확인 문제와 문제 은행)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/pool$/)) && m === 'GET') {
    const id = int(mm[1]);
    const l = await env.DB.prepare('SELECT id, title, source, status, options, quiz FROM lectures WHERE id = ?').bind(id).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    const quiz = readQuiz(l.quiz);
    const rows = await bankRows(env, id);
    const use = await usage(env, id);
    return json({
      lecture: { id: l.id, title: l.title, source: l.source, status: l.status, level: levelOf(l) },
      quiz: quiz ? { ver: quiz.ver, items: quiz.items } : null,
      bank: rows
        .map((r) => ({ ...rowItem(r), score: r.score, source: r.source, used: [use.hwIds.has(r.id) && 'hw', use.printIds.has(r.id) && 'print', use.examIds.has(r.id) && 'exam', use.mockIds.has(r.id) && 'mock'].filter(Boolean) }))
        .filter((x) => x.q),
    });
  }

  // ---------------------------------------------------------------- 인쇄 문서 (print.html)
  if ((mm = path.match(/^\/api\/admin\/lectures\/(\d+)\/quiz\/print$/)) && m === 'GET') {
    const l = await env.DB.prepare('SELECT id, title, source, quiz FROM lectures WHERE id = ?').bind(int(mm[1])).first();
    if (!l) throw new HttpError(404, '강의를 찾을 수 없어요.');
    const quiz = readQuiz(l.quiz);
    if (!quiz) throw new HttpError(404, '이 강의에는 아직 확인 문제가 없어요.');
    const s = await getSettings(env);
    const items = [...quiz.items.filter((x) => x.type === 'mc'), ...quiz.items.filter((x) => x.type === 'sa')];
    return json({
      doc: { kind: 'quiz', title: l.title, label: '확인 문제', what: '시험지', kicker: l.source || s.academy_name, date: now(), items: printItems(items), file: `${l.title}_확인문제` },
      academy: academyOf(s),
    });
  }
  if ((mm = path.match(/^\/api\/admin\/exams\/(\d+)\/print$/)) && m === 'GET') {
    const { e, q } = await examOr404(env, int(mm[1]));
    const s = await getSettings(env);
    // 시험지 머리 위 작은 줄: 문제를 가져온 강의의 출처 (교과서 몇 과). 오른쪽에 학원 이름이 따로 있어요
    const lids = (safeParse(e.lecture_ids, []) || []).slice(0, 40);
    let kicker = '';
    if (lids.length) {
      const { results } = await env.DB.prepare(`SELECT id, source FROM lectures WHERE id IN (${inList(lids.length)})`).bind(...lids).all();
      const srcs = [...new Set(lids.map((id) => (results.find((r) => r.id === id) || {}).source).filter(Boolean))];
      kicker = srcs.length > 3 ? `${srcs.slice(0, 3).join(', ')} 외 ${srcs.length - 3}개` : srcs.join(', ');
    }
    return json({
      doc: { kind: 'exam', title: e.title, label: '시험지', what: '시험지', kicker, date: now(), items: printItems(q.items), file: e.title },
      academy: academyOf(s),
    });
  }

  // ---------------------------------------------------------------- 시험 하나
  if ((mm = path.match(/^\/api\/admin\/exams\/(\d+)$/))) {
    const id = int(mm[1]);
    const { e, q } = await examOr404(env, id);
    if (m === 'GET') {
      const classes = (
        await env.DB.prepare(
          `SELECT ec.class_id, ec.due_at, ec.created_at, ec.closed_at, c.name, c.color,
                  (SELECT COUNT(*) FROM users u WHERE u.class_id = ec.class_id AND u.role = 'student' AND u.active = 1) AS students
             FROM exam_classes ec JOIN classes c ON c.id = ec.class_id WHERE ec.exam_id = ? AND c.archived = 0 ORDER BY c.name`,
        )
          .bind(id)
          .all()
      ).results;
      const rows = (
        await env.DB.prepare(
          `SELECT ea.*, u.name, u.login_id, u.class_id, c.name AS class_name FROM exam_attempts ea JOIN users u ON u.id = ea.user_id
             LEFT JOIN classes c ON c.id = u.class_id WHERE ea.exam_id = ? ORDER BY c.name, u.name`,
        )
          .bind(id)
          .all()
      ).results;
      const attempts = rows.map((r) => ({ ...attemptOut(r), user_id: r.user_id, name: r.name, login_id: r.login_id, class_id: r.class_id, class_name: r.class_name, paper: !!r.by_teacher }));
      const pending = (
        await env.DB.prepare(
          `SELECT u.id, u.name, u.class_id, c.name AS class_name FROM exam_classes ec
             JOIN users u ON u.class_id = ec.class_id AND u.role = 'student' AND u.active = 1 JOIN classes c ON c.id = ec.class_id
            WHERE ec.exam_id = ? AND c.archived = 0 AND NOT EXISTS (SELECT 1 FROM exam_attempts ea WHERE ea.exam_id = ec.exam_id AND ea.user_id = u.id)
            ORDER BY c.name, u.name`,
        )
          .bind(id)
          .all()
      ).results;
      for (const c of classes) {
        const mine = attempts.filter((a) => a.class_id === c.class_id);
        c.done = mine.length;
        c.avg = mine.length ? mine.reduce((t, a) => t + (a.total ? a.score / a.total : 0), 0) / mine.length : null;
      }
      return json({
        exam: { id: e.id, title: e.title, reveal: !!e.reveal, created_at: e.created_at, updated_at: e.updated_at, ver: q.ver, items: q.items, lecture_ids: safeParse(e.lecture_ids, []) || [], ...counts(q.items) },
        classes,
        attempts,
        pending,
        right: rightOf(q, attempts),
      });
    }
    if (m === 'PUT') {
      const b = await readJson(request);
      const sets = [];
      const vals = [];
      if ('title' in b) {
        sets.push('title = ?');
        vals.push(str(b.title, 80) || '시험');
      }
      if ('reveal' in b) {
        sets.push('reveal = ?');
        vals.push(b.reveal ? 1 : 0);
      }
      let dropped = 0;
      if ('picks' in b) {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM exam_attempts WHERE exam_id = ?').bind(id).first();
        if (n && n.n) throw new HttpError(409, '이미 푼 학생이 있어서 문제를 바꿀 수 없어요. 복사해서 새 시험으로 만들어 주세요.', 'has_attempts');
        const r = await resolvePicks(env, b.picks);
        if (!r.items.length) throw new HttpError(400, '문제를 하나 이상 골라 주세요.');
        dropped = r.dropped;
        sets.push('items = ?', 'lecture_ids = ?', 'bank_ids = ?');
        // 버전이 바뀌어야 풀던 학생 화면이 새 문제를 알아채요 (같은 초에 고쳐도 올라가게)
        vals.push(JSON.stringify({ v: 1, ver: Math.max(now(), q.ver + 1), items: r.items }), JSON.stringify(r.lectureIds), JSON.stringify(r.bankIds));
      }
      if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');
      sets.push('updated_at = ?');
      vals.push(now());
      await env.DB.prepare(`UPDATE exams SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      return json({ ok: true, dropped });
    }
    if (m === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM exam_attempts WHERE exam_id = ?').bind(id),
        env.DB.prepare('DELETE FROM exam_classes WHERE exam_id = ?').bind(id),
        env.DB.prepare('DELETE FROM exams WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------------- 반에 내기, 마감, 그만 풀게 하기
  if ((mm = path.match(/^\/api\/admin\/exams\/(\d+)\/classes$/)) && m === 'POST') {
    const id = int(mm[1]);
    await examOr404(env, id);
    const b = await readJson(request);
    const ids = (Array.isArray(b.class_ids) ? b.class_ids : [b.class_id]).map((x) => int(x)).filter(Boolean).slice(0, 50);
    if (!ids.length) throw new HttpError(400, '반을 골라 주세요.');
    const due = b.due_at ? int(b.due_at) : null;
    await env.DB.batch(
      ids.map((cid) =>
        env.DB.prepare(
          `INSERT INTO exam_classes (exam_id, class_id, due_at, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(exam_id, class_id) DO UPDATE SET due_at = excluded.due_at, closed_at = NULL`,
        ).bind(id, cid, due, now()),
      ),
    );
    return json({ ok: true, n: ids.length });
  }
  if ((mm = path.match(/^\/api\/admin\/exams\/(\d+)\/classes\/(\d+)$/))) {
    const id = int(mm[1]);
    const cid = int(mm[2]);
    if (m === 'PUT') {
      const b = await readJson(request);
      const sets = [];
      const vals = [];
      if ('due_at' in b) {
        sets.push('due_at = ?');
        vals.push(b.due_at ? int(b.due_at) : null);
      }
      if ('closed' in b) {
        sets.push('closed_at = ?');
        vals.push(b.closed ? now() : null);
      }
      if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');
      await env.DB.prepare(`UPDATE exam_classes SET ${sets.join(', ')} WHERE exam_id = ? AND class_id = ?`).bind(...vals, id, cid).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      // 학생 앱에서 빼요 (낸 답안과 점수는 남아요)
      await env.DB.prepare('DELETE FROM exam_classes WHERE exam_id = ? AND class_id = ?').bind(id, cid).run();
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------------- 종이 답안 넣기 (선생님이 학생 답을 넣으면 채점해요)
  if ((mm = path.match(/^\/api\/admin\/exams\/(\d+)\/attempts$/)) && m === 'POST') {
    const id = int(mm[1]);
    const { q } = await examOr404(env, id);
    const b = await readJson(request);
    const uid = int(b.user_id);
    const u = uid ? await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").bind(uid).first() : null;
    if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
    const g = gradeAll(q, b.answers);
    const t = now();
    await env.DB.prepare(
      `INSERT INTO exam_attempts (exam_id, user_id, answers, results, score, total, by_teacher, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(exam_id, user_id) DO UPDATE SET answers = excluded.answers, results = excluded.results, score = excluded.score, total = excluded.total,
         by_teacher = 1, updated_at = excluded.updated_at`,
    )
      .bind(id, uid, JSON.stringify(g.answers), JSON.stringify(g.results), g.score, g.total, t, t)
      .run();
    const a = await env.DB.prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ?').bind(id, uid).first();
    return json({ ok: true, attempt: { ...attemptOut(a), paper: true } });
  }

  // ---------------------------------------------------------------- 학생 답안 하나 (보기, 서술형 맞음 바꾸기, 다시 풀게 하기)
  if ((mm = path.match(/^\/api\/admin\/exam-attempts\/(\d+)$/))) {
    const aid = int(mm[1]);
    const r = await env.DB.prepare(
      `SELECT ea.*, e.items AS exam_items, u.name, c.name AS class_name FROM exam_attempts ea JOIN exams e ON e.id = ea.exam_id
         JOIN users u ON u.id = ea.user_id LEFT JOIN classes c ON c.id = u.class_id WHERE ea.id = ?`,
    )
      .bind(aid)
      .first();
    if (!r) throw new HttpError(404, '푼 기록을 찾을 수 없어요.');
    const q = readQuiz(r.exam_items);
    if (m === 'GET') return json({ quiz: q, attempt: { ...attemptOut(r), name: r.name, class_name: r.class_name, paper: !!r.by_teacher } });
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM exam_attempts WHERE id = ?').bind(aid).run();
      return json({ ok: true });
    }
    if (m === 'PUT') {
      const b = await readJson(request);
      const i = int(b.i, -1);
      if (!q || i < 0 || i >= q.items.length) throw new HttpError(400, '문항 번호가 올바르지 않아요.');
      const results = safeParse(r.results, []) || [];
      const answers = safeParse(r.answers, []) || [];
      results[i] = b.ok === true ? 2 : b.ok === false ? 3 : autoGrade(q.items[i], answers[i] ?? null);
      const score = q.items.filter((_, k) => isOk(results[k])).length;
      await env.DB.prepare('UPDATE exam_attempts SET results = ?, score = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(results), score, now(), aid).run();
      return json({ ok: true, results, score });
    }
  }

  // ---------------------------------------------------------------- 반 성적표: 확인 문제, 숙제, 시험
  if ((mm = path.match(/^\/api\/admin\/classes\/(\d+)\/scores(\.csv)?$/)) && m === 'GET') {
    const cid = int(mm[1]);
    const cls = await env.DB.prepare('SELECT id, name FROM classes WHERE id = ?').bind(cid).first();
    if (!cls) throw new HttpError(404, '반을 찾을 수 없어요.');
    const out = await classScores(env, cid);
    if (!mm[2]) return json(out);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const KIND = { quiz: '확인 문제', hw: '숙제', exam: '시험' };
    const lines = [['이름', '아이디', '평균', ...out.cols.map((c) => `${c.title} (${KIND[c.kind]})`)].map(esc).join(',')];
    for (const s of out.students) {
      const row = out.cells[s.id] || {};
      const got = out.cols.map((c) => row[c.key]).filter(Boolean);
      const avg = got.length ? Math.round((got.reduce((t, x) => t + (x.total ? x.score / x.total : 0), 0) / got.length) * 100) : null;
      lines.push([s.name, s.login_id, avg === null ? '' : `${avg}%`, ...out.cols.map((c) => (row[c.key] ? `${row[c.key].score}/${row[c.key].total}` : ''))].map(esc).join(','));
    }
    return new Response('﻿' + lines.join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`성적_${cls.name}.csv`)}` },
    });
  }
  return null;
}

// 반 성적표: 학생 × (시험, 강의마다 확인 문제와 숙제). 칸은 최근 것부터
export async function classScores(env, cid) {
  const students = (await env.DB.prepare("SELECT id, name, login_id FROM users WHERE role = 'student' AND active = 1 AND class_id = ? ORDER BY name").bind(cid).all()).results;
  const lectures = (
    await env.DB.prepare(
      `SELECT l.id, l.title, a.created_at AS assigned_at, a.due_at, a.closed_at,
              json_array_length(l.quiz, '$.items') AS quiz_n, json_array_length(l.homework, '$.items') AS hw_n
         FROM assignments a JOIN lectures l ON l.id = a.lecture_id WHERE a.class_id = ? AND l.status = 'done'`,
    )
      .bind(cid)
      .all()
  ).results;
  const cells = {};
  const put = (uid, key, r) => {
    cells[uid] = cells[uid] || {};
    cells[uid][key] = { id: r.id, score: r.score, total: r.total, created_at: r.created_at, ...(r.by_teacher ? { paper: true } : {}) };
  };
  const quizRows = (
    await env.DB.prepare(
      `SELECT qa.id, qa.user_id, qa.lecture_id, qa.score, qa.total, qa.created_at FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
         JOIN lectures l ON l.id = qa.lecture_id WHERE u.class_id = ? AND qa.quiz_ver = json_extract(l.quiz, '$.ver')`,
    )
      .bind(cid)
      .all()
  ).results;
  for (const r of quizRows) put(r.user_id, `q${r.lecture_id}`, r);
  const hwRows = (
    await env.DB.prepare(
      `SELECT ha.id, ha.user_id, ha.lecture_id, ha.score, ha.total, ha.created_at FROM hw_attempts ha JOIN users u ON u.id = ha.user_id
         JOIN lectures l ON l.id = ha.lecture_id WHERE u.class_id = ? AND ha.hw_ver = json_extract(l.homework, '$.ver')`,
    )
      .bind(cid)
      .all()
  ).results;
  for (const r of hwRows) put(r.user_id, `h${r.lecture_id}`, r);
  // 시험: 이 반에 낸 시험과, 이 반 학생 답안이 있는 시험 (종이 답안만 넣은 시험도 보여요)
  const exRows = (
    await env.DB.prepare(
      `SELECT ea.id, ea.exam_id, ea.user_id, ea.score, ea.total, ea.created_at, ea.by_teacher FROM exam_attempts ea JOIN users u ON u.id = ea.user_id WHERE u.class_id = ?`,
    )
      .bind(cid)
      .all()
  ).results;
  for (const r of exRows) put(r.user_id, `e${r.exam_id}`, r);
  const given = (await env.DB.prepare('SELECT exam_id, due_at, created_at, closed_at FROM exam_classes WHERE class_id = ?').bind(cid).all()).results;
  const examIds = [...new Set([...given.map((g) => g.exam_id), ...exRows.map((r) => r.exam_id)])];
  const exams = [];
  for (let i = 0; i < examIds.length; i += 90) {
    const chunk = examIds.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT id, title, created_at, json_array_length(items, '$.items') AS n FROM exams WHERE id IN (${inList(chunk.length)})`).bind(...chunk).all();
    exams.push(...r.results);
  }
  const cols = [];
  for (const e of exams) {
    const g = given.find((x) => x.exam_id === e.id);
    const firstAt = exRows.filter((r) => r.exam_id === e.id).reduce((t, r) => Math.min(t, r.created_at), Infinity);
    cols.push({ key: `e${e.id}`, kind: 'exam', id: e.id, title: e.title, total: e.n || 0, at: g ? g.created_at : Number.isFinite(firstAt) ? firstAt : e.created_at, due_at: g ? g.due_at : null, given: !!g, closed: !!(g && g.closed_at) });
  }
  for (const l of lectures) {
    if (l.quiz_n) cols.push({ key: `q${l.id}`, kind: 'quiz', id: l.id, title: l.title, total: l.quiz_n, at: l.assigned_at, due_at: l.due_at, closed: !!l.closed_at });
    if (l.hw_n) cols.push({ key: `h${l.id}`, kind: 'hw', id: l.id, title: l.title, total: l.hw_n, at: l.assigned_at - 0.5, due_at: l.due_at, closed: !!l.closed_at });
  }
  cols.sort((a, b) => b.at - a.at);
  // 학생 칸에 없는 기록은 버려요 (다른 반으로 옮긴 학생의 예전 기록 등)
  const keys = new Set(cols.map((c) => c.key));
  for (const uid of Object.keys(cells)) for (const k of Object.keys(cells[uid])) if (!keys.has(k)) delete cells[uid][k];
  return { class_id: cid, students, cols, cells };
}

// ==================================================================== 학생
async function previewTarget(env, user, url) {
  if (user.role !== 'admin') return user;
  const uid = int(url.searchParams.get('as'));
  if (!uid) throw new HttpError(400, '미리 볼 학생을 골라 주세요.');
  const u = await env.DB.prepare("SELECT id, name, class_id, role FROM users WHERE id = ? AND role = 'student'").bind(uid).first();
  if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
  return u;
}

// 학생 앱 홈에 보일 시험 (그 반에 낸 시험, 최근 것부터)
export async function studentExams(env, u) {
  if (!u.class_id) return [];
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.title, e.reveal, json_array_length(e.items, '$.items') AS n, ec.due_at, ec.closed_at, ec.created_at AS given_at,
            ea.score, ea.total, ea.created_at AS done_at
       FROM exam_classes ec JOIN exams e ON e.id = ec.exam_id
       LEFT JOIN exam_attempts ea ON ea.exam_id = e.id AND ea.user_id = ?
      WHERE ec.class_id = ? ORDER BY ec.created_at DESC LIMIT 40`,
  )
    .bind(u.id, u.class_id)
    .all();
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    n: r.n || 0,
    due_at: r.due_at,
    closed: !!r.closed_at,
    given_at: r.given_at,
    score: r.score ?? null,
    total: r.total ?? null,
    done_at: r.done_at ?? null,
  }));
}

export async function handleExamStudent(request, env, path, user) {
  const m = request.method;
  const url = new URL(request.url);
  const mm = path.match(/^\/api\/student\/exams\/(\d+)$/);
  if (!mm || (m !== 'GET' && m !== 'POST')) return null;
  const id = int(mm[1]);
  const t = await previewTarget(env, user, url);
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?').bind(id).first();
  const q = e && readQuiz(e.items);
  const ec = e && t.class_id ? await env.DB.prepare('SELECT * FROM exam_classes WHERE exam_id = ? AND class_id = ?').bind(id, t.class_id).first() : null;
  const getAttempt = () => env.DB.prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ?').bind(id, t.id).first();
  const a0 = q ? await getAttempt() : null;
  // 반에 낸 시험이거나, 선생님이 이 학생 종이 답안을 넣은 시험만 볼 수 있어요
  if (!q || (!ec && !a0)) throw new HttpError(404, '이 시험은 볼 수 없어요.');
  const reveal = !!e.reveal;
  const closed = !ec || !!ec.closed_at;
  const view = (a) => ({
    title: e.title,
    reveal,
    closed,
    due_at: ec ? ec.due_at : null,
    quiz: a ? (reveal ? reviewQuiz(q) : { ver: q.ver, items: [] }) : closed ? { ver: q.ver, items: [] } : publicQuiz(q),
    n: q.items.length,
    attempt: a ? (reveal ? { ...attemptOut(a), paper: !!a.by_teacher } : { id: a.id, score: a.score, total: a.total, created_at: a.created_at, paper: !!a.by_teacher, answers: [], results: [] }) : null,
  });
  if (m === 'GET') return json(view(a0));
  const b = await readJson(request);
  if (Number(b.ver) !== q.ver) throw new HttpError(409, '선생님이 시험 문제를 바꿨어요. 화면을 새로 고쳐서 다시 풀어 주세요.', 'quiz_changed');
  if (a0) return json({ ...view(a0), already: true });
  if (closed) throw new HttpError(409, '시험이 끝나서 더 낼 수 없어요.', 'closed');
  const g = gradeAll(q, b.answers);
  // 선생님 미리보기는 채점만 하고 남기지 않아요
  if (user.role === 'admin') {
    return json({ ...view(null), quiz: reviewQuiz(q), attempt: { id: 0, score: g.score, total: g.total, created_at: now(), answers: g.answers, results: g.results }, reveal: true, preview: true });
  }
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO exam_attempts (exam_id, user_id, answers, results, score, total, by_teacher, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(exam_id, user_id) DO NOTHING`,
  )
    .bind(id, user.id, JSON.stringify(g.answers), JSON.stringify(g.results), g.score, g.total, ts, ts)
    .run();
  return json(view(await getAttempt()));
}
