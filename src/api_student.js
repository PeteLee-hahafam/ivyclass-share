import { HttpError, json, readJson, int, now, getSettings, bitsDecode, bitsEncode, safeParse, callText } from './util.js';
import { lectureLinks } from './media.js';
import { voiceOf } from './api_engine.js';
import { readQuiz, quizInfo, publicQuiz, reviewQuiz, gradeAll, attemptOut } from './quiz.js';
import { studentExtras } from './api_bank.js';
import { studentExams } from './api_exam.js';

// 잘라낸 구간은 빼고 셉니다: [본 초, 봐야 할 초]
function watchedSeconds(bits, duration, cuts) {
  const skip = new Uint8Array(duration);
  for (const c of cuts || []) {
    const a = Math.max(0, Math.ceil(Number(c[0]) || 0));
    const b = Math.min(duration, Math.floor(Number(c[1]) || 0));
    for (let i = a; i < b; i++) skip[i] = 1;
  }
  let seen = 0;
  let need = 0;
  for (let i = 0; i < duration; i++) {
    if (skip[i]) continue;
    need++;
    if (bits[i >> 3] & (1 << (i & 7))) seen++;
  }
  return [seen, Math.max(1, need)];
}

export async function studentLectures(env, u) {
  if (!u.class_id) return [];
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.title, l.source, l.duration, l.thumb_key, l.note_key, l.practice_key,
            a.due_at, a.note, a.created_at AS assigned_at,
            p.percent, p.completed_at, p.updated_at, p.last_pos, p.views,
            json_array_length(l.quiz, '$.items') AS quiz_n, qa.score AS quiz_score, qa.total AS quiz_total,
            json_array_length(l.homework, '$.items') AS hw_n, ha.score AS hw_score, ha.total AS hw_total
       FROM assignments a JOIN lectures l ON l.id = a.lecture_id
       LEFT JOIN progress p ON p.lecture_id = l.id AND p.user_id = ?
       LEFT JOIN quiz_attempts qa ON qa.lecture_id = l.id AND qa.user_id = ? AND qa.quiz_ver = json_extract(l.quiz, '$.ver')
       LEFT JOIN hw_attempts ha ON ha.lecture_id = l.id AND ha.user_id = ? AND ha.hw_ver = json_extract(l.homework, '$.ver')
      WHERE a.class_id = ? AND l.status = 'done'
      ORDER BY (p.completed_at IS NOT NULL), (a.due_at IS NULL), a.due_at, a.created_at DESC`,
  )
    .bind(u.id, u.id, u.id, u.class_id)
    .all();
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source,
    duration: r.duration,
    has_thumb: !!r.thumb_key,
    has_note: !!r.note_key,
    has_practice: !!r.practice_key,
    due_at: r.due_at,
    note: r.note,
    assigned_at: r.assigned_at,
    percent: r.percent || 0,
    completed_at: r.completed_at,
    updated_at: r.updated_at,
    last_pos: r.last_pos || 0,
    views: r.views || 0,
    quiz_n: r.quiz_n || 0,
    quiz_score: r.quiz_score ?? null,
    quiz_total: r.quiz_total ?? null,
    hw_n: r.hw_n || 0,
    hw_score: r.hw_score ?? null,
    hw_total: r.hw_total ?? null,
  }));
}

export async function canSeeLecture(env, user, lectureId) {
  if (user.role === 'admin') return true;
  const r = await env.DB.prepare(
    `SELECT 1 FROM assignments a JOIN lectures l ON l.id = a.lecture_id WHERE a.lecture_id = ? AND a.class_id = ? AND l.status = 'done'`,
  )
    .bind(lectureId, user.class_id || -1)
    .first();
  return !!r;
}

async function previewTarget(env, user, url) {
  // 선생님이 학생 화면을 볼 때는 고른 학생의 기록을 읽기만 해요
  if (user.role !== 'admin') return user;
  const uid = int(url.searchParams.get('as'));
  if (!uid) throw new HttpError(400, '미리 볼 학생을 골라 주세요.');
  const u = await env.DB.prepare("SELECT id, name, call_name, class_id, role FROM users WHERE id = ? AND role = 'student'").bind(uid).first();
  if (!u) throw new HttpError(404, '학생을 찾을 수 없어요.');
  return u;
}

// 강의 중 이름을 부를 자리와 그 학생의 이름 목소리
async function nameInfo(env, l, target, preview) {
  const slots = safeParse(l.name_slots, []) || [];
  const opts = safeParse(l.options, {}) || {};
  if (!Array.isArray(slots) || !slots.length) return null;
  const voice = voiceOf(l.voice);
  const u = target.call_name !== undefined ? target : await env.DB.prepare('SELECT id, name, call_name FROM users WHERE id = ?').bind(target.id).first();
  const text = callText(u || target, (voice && voice.tone) || opts.tone);
  if (!text) return null;
  let clip = null;
  if (voice) {
    const c = await env.DB.prepare('SELECT text, created_at FROM name_clips WHERE user_id = ? AND voice = ?').bind(target.id, voice.k).first();
    if (c && c.text === text) clip = `/media/name/${l.id}?v=${c.created_at}${preview ? `&as=${target.id}` : ''}`;
  }
  return { slots, text, clip };
}

export async function handleStudent(request, env, path, user) {
  const url = new URL(request.url);
  let mm;
  if (path === '/api/student/lectures' && request.method === 'GET') {
    const target = await previewTarget(env, user, url);
    const s = await getSettings(env);
    const cls = target.class_id ? await env.DB.prepare('SELECT name FROM classes WHERE id = ?').bind(target.class_id).first() : null;
    return json({
      lectures: await studentLectures(env, target),
      exams: await studentExams(env, target),
      student: { name: target.name, class_name: cls ? cls.name : null },
      complete_threshold: s.complete_threshold,
    });
  }
  if ((mm = path.match(/^\/api\/student\/lectures\/(\d+)$/)) && request.method === 'GET') {
    const id = int(mm[1]);
    const target = await previewTarget(env, user, url);
    if (!(await canSeeLecture(env, target, id))) throw new HttpError(404, '이 강의는 볼 수 없어요.');
    const l = await env.DB.prepare(
      'SELECT id, title, source, duration, video_key, note_key, practice_key, thumb_key, subtitle_key, edit, summary, name_slots, voice, options, quiz FROM lectures WHERE id = ?',
    )
      .bind(id)
      .first();
    const a = await env.DB.prepare('SELECT due_at, note FROM assignments WHERE lecture_id = ? AND class_id = ?').bind(id, target.class_id || -1).first();
    const p = await env.DB.prepare('SELECT * FROM progress WHERE user_id = ? AND lecture_id = ?').bind(target.id, id).first();
    const s = await getSettings(env);
    const edit = safeParse(l.edit, null) || {};
    const quiz = readQuiz(l.quiz);
    const qa = quiz ? await env.DB.prepare('SELECT * FROM quiz_attempts WHERE user_id = ? AND lecture_id = ? AND quiz_ver = ?').bind(target.id, id, quiz.ver).first() : null;
    return json({
      quiz: quizInfo(quiz),
      quiz_result: qa ? { score: qa.score, total: qa.total, created_at: qa.created_at } : null,
      ...(await studentExtras(env, id, target.id)),
      lecture: {
        id: l.id,
        title: l.title,
        source: l.source,
        duration: l.duration,
        has_note: !!l.note_key,
        has_practice: !!l.practice_key,
        has_thumb: !!l.thumb_key,
        due_at: a ? a.due_at : null,
        note: a ? a.note : null,
        cuts: Array.isArray(edit.cuts) ? edit.cuts : [],
        chapters: Array.isArray(edit.chapters) ? edit.chapters : [],
        strokes: Array.isArray(edit.strokes) ? edit.strokes : [],
        summary: safeParse(l.summary, null),
      },
      name: await nameInfo(env, l, target, user.role === 'admin'),
      progress: p
        ? { bits: p.bits, percent: p.percent, last_pos: p.last_pos, max_pos: p.max_pos, completed_at: p.completed_at, views: p.views }
        : { bits: null, percent: 0, last_pos: 0, max_pos: 0, completed_at: null, views: 0 },
      files: await lectureLinks(env, l, ['note', 'practice', 'subtitle']),
      rules: { prevent_skip: s.prevent_skip, complete_threshold: s.complete_threshold },
      preview: user.role === 'admin',
    });
  }
  // ---------------------------------------------------------------- 확인 문제
  if ((mm = path.match(/^\/api\/student\/lectures\/(\d+)\/quiz$/)) && (request.method === 'GET' || request.method === 'POST')) {
    const id = int(mm[1]);
    const target = await previewTarget(env, user, url);
    if (!(await canSeeLecture(env, target, id))) throw new HttpError(404, '이 강의는 볼 수 없어요.');
    const l = await env.DB.prepare('SELECT id, title, quiz FROM lectures WHERE id = ?').bind(id).first();
    const quiz = readQuiz(l && l.quiz);
    if (!quiz) throw new HttpError(404, '이 강의에는 아직 확인 문제가 없어요.');
    const getAttempt = () => env.DB.prepare('SELECT * FROM quiz_attempts WHERE user_id = ? AND lecture_id = ? AND quiz_ver = ?').bind(target.id, id, quiz.ver).first();
    if (request.method === 'GET') {
      const a = await getAttempt();
      return json({ title: l.title, quiz: a ? reviewQuiz(quiz) : publicQuiz(quiz), attempt: attemptOut(a) });
    }
    const b = await readJson(request);
    if (Number(b.ver) !== quiz.ver) throw new HttpError(409, '선생님이 문제를 새로 바꿨어요. 화면을 새로 고쳐서 다시 풀어 주세요.', 'quiz_changed');
    const g = gradeAll(quiz, b.answers);
    // 선생님 미리보기는 채점만 하고 남기지 않아요
    if (user.role === 'admin') return json({ quiz: reviewQuiz(quiz), attempt: { id: 0, score: g.score, total: g.total, created_at: now(), answers: g.answers, results: g.results }, preview: true });
    const old = await getAttempt();
    if (old) return json({ quiz: reviewQuiz(quiz), attempt: attemptOut(old), already: true });
    const t = now();
    await env.DB.prepare(
      `INSERT INTO quiz_attempts (user_id, lecture_id, quiz_ver, answers, results, score, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, lecture_id, quiz_ver) DO NOTHING`,
    )
      .bind(user.id, id, quiz.ver, JSON.stringify(g.answers), JSON.stringify(g.results), g.score, g.total, t, t)
      .run();
    return json({ quiz: reviewQuiz(quiz), attempt: attemptOut(await getAttempt()) });
  }
  if (path === '/api/student/progress' && request.method === 'POST') {
    const b = await readJson(request);
    const id = int(b.lecture_id);
    if (user.role === 'admin') return json({ ok: true, preview: true });
    if (!(await canSeeLecture(env, user, id))) throw new HttpError(404, '이 강의는 볼 수 없어요.');
    const l = await env.DB.prepare('SELECT duration, edit FROM lectures WHERE id = ?').bind(id).first();
    const duration = Math.max(1, Math.ceil(l.duration || Number(b.duration) || 0));
    if (!duration || duration > 6 * 3600) throw new HttpError(400, '영상 길이를 알 수 없어요.');
    const s = await getSettings(env);
    const cur = await env.DB.prepare('SELECT * FROM progress WHERE user_id = ? AND lecture_id = ?').bind(user.id, id).first();
    const mine = bitsDecode(cur ? cur.bits : null, duration);
    const inc = bitsDecode(b.bits, duration);
    for (let i = 0; i < mine.length; i++) mine[i] |= inc[i];
    const edit = safeParse(l.edit, null) || {};
    const [watched, need] = watchedSeconds(mine, duration, edit.cuts);
    const percent = Math.min(100, Math.round((watched / need) * 100));
    const pos = Math.max(0, Math.min(duration, Number(b.pos) || 0));
    const t = now();
    const completed = cur && cur.completed_at ? cur.completed_at : percent >= s.complete_threshold ? t : null;
    const views = (cur ? cur.views : 0) + (b.started ? 1 : 0);
    await env.DB.prepare(
      `INSERT INTO progress (user_id, lecture_id, bits, watched, duration, percent, last_pos, max_pos, views, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, lecture_id) DO UPDATE SET bits = excluded.bits, watched = excluded.watched, duration = excluded.duration,
         percent = excluded.percent, last_pos = excluded.last_pos, max_pos = MAX(progress.max_pos, excluded.max_pos),
         views = excluded.views, updated_at = excluded.updated_at, completed_at = excluded.completed_at`,
    )
      .bind(user.id, id, bitsEncode(mine), watched, duration, percent, pos, pos, views, cur ? cur.started_at : t, t, completed)
      .run();
    return json({ ok: true, percent, completed: !!completed, bits: bitsEncode(mine) });
  }
  return null;
}
