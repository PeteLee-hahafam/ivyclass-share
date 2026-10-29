// 레벨테스트 진행: 응시 상태(state)를 한 단계씩 넘기고, 학생 화면에는 정답을 뺀 문항만 보내요.
// state = { v, student, date, mods, mi, res, ctx, cur, done, skipped }
//   res: { voc|gram|read|listen: { start, steps }, write: { tier, answers, times, scoring } }  (core.js ltAnalyzeAll 이 읽는 모양)
//   cur: 지금 풀 블록 { mod, key } 또는 { mod: 'write', tier }. 다 풀면 null, done = true
import {
  LT_LEVELS, LT_BANK, LT_LBANK, LT_WBANK, LT_MODS, LT_MOD_ORDER, LT_MODNAME, LT_YEARS, LT_RUBRIC,
  ltBlock, ltVocStart, ltModStart, ltModNext, ltScoreBlock, ltAnalyzeVoc, ltAnalyzeLevel, ltWriteTier, ltStartLevel, ltClamp,
  ltAnalyzeAll, ltLvShort, ltLexText, ltArText, ltComment2, ltPlan2,
} from './core.js';

export const LT_PRESETS = {
  new: { name: '신규 상담', mods: ['voc', 'gram', 'read'] },
  all: { name: '다섯 영역 모두', mods: ['voc', 'gram', 'read', 'listen', 'write'] },
  read: { name: '리딩만', mods: ['read'] },
};

export class LtError extends Error {
  constructor(msg, code = 'bad') {
    super(msg);
    this.code = code;
  }
}

// 영역 목록 다듬기: 아는 영역만, 정해진 순서로
export function cleanMods(list) {
  const want = new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()));
  const out = LT_MOD_ORDER.filter((k) => want.has(k));
  return out.length ? out : LT_PRESETS.new.mods.slice();
}

export function newState(student, mods, date) {
  const st = { v: 1, student, date, mods: cleanMods(mods), mi: 0, res: {}, ctx: {}, cur: null, done: false, skipped: [] };
  beginModule(st);
  return st;
}

function beginModule(state) {
  const mod = state.mods[state.mi];
  const st = state.student;
  const ctx = state.ctx;
  if (mod === 'write') {
    // 라이팅 단계는 문법(없으면 리딩) 결과로 골라요
    const base = ctx.gram != null ? ctx.gram : ctx.read != null ? ctx.read : ltClamp(ltStartLevel(st.grade, st.years) + 1, 1, 12);
    state.cur = { mod, tier: ltWriteTier(Math.max(1, base)) };
    return;
  }
  const start = mod === 'voc' ? ltVocStart(st.grade) : ltModStart(mod, st, ctx);
  state.res[mod] = { start, steps: [] };
  state.cur = { mod, key: start };
}

function finishModule(state) {
  const mod = state.mods[state.mi];
  const R = state.res[mod];
  if (mod === 'voc' && R) state.ctx.voc = ltAnalyzeVoc(R.steps).level;
  if (mod === 'gram' && R) state.ctx.gram = ltAnalyzeLevel('gram', R.steps).level;
  if (mod === 'read' && R) state.ctx.read = ltAnalyzeLevel('read', R.steps).level;
  state.mi++;
  if (state.mi < state.mods.length) beginModule(state);
  else {
    state.cur = null;
    state.done = true;
  }
}

// 블록 하나(어휘 4문항, 나머지 3문항)를 채점하고 다음 블록이나 다음 영역으로
export function submitBlock(state, body) {
  const c = state.cur;
  if (!c || c.mod === 'write') throw new LtError('지금 풀 문제가 아니에요. 화면을 새로 고쳐 주세요.', 'stale');
  if (body.mod !== c.mod || Number(body.key) !== c.key) throw new LtError('지금 풀 문제가 아니에요. 화면을 새로 고쳐 주세요.', 'stale');
  const items = ltBlock(c.mod, c.key);
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const times = Array.isArray(body.times) ? body.times : [];
  if (answers.length !== items.length) throw new LtError('답의 개수가 맞지 않아요.');
  const A = answers.map((a, i) => {
    const n = Number(a);
    return Number.isInteger(n) && n >= -2 && n < items[i].opts.length ? n : -1;
  });
  const Tm = items.map((it, i) => Math.max(0, Math.min(it.limit * 1000, Math.round(Number(times[i]) || 0))));
  const step = ltScoreBlock(c.mod, c.key, A, Tm);
  const R = state.res[c.mod];
  R.steps.push(step);
  const n = ltModNext(c.mod, R.steps, R.start);
  if (n.done || R.steps.length >= 9) finishModule(state);
  else state.cur = { mod: c.mod, key: n.key };
  return state;
}

// 라이팅: 한 번에 내요. A 단계는 바로 채점되고, B·C 단계는 학원 PC 엔진(Claude)이 채점해요
export function submitWrite(state, body) {
  const c = state.cur;
  if (!c || c.mod !== 'write') throw new LtError('지금 풀 문제가 아니에요. 화면을 새로 고쳐 주세요.', 'stale');
  const T = LT_WBANK[c.tier];
  const answers = {};
  const times = {};
  const ba = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const bt = body.times && typeof body.times === 'object' ? body.times : {};
  for (const it of T.items) {
    answers[it.id] = String(ba[it.id] == null ? '' : ba[it.id]).replace(/\s+/g, ' ').trim().slice(0, it.kind === 'essay' ? 2400 : 400);
    times[it.id] = Math.max(0, Math.min(it.time * 1000, Math.round(Number(bt[it.id]) || 0)));
  }
  state.res.write = { tier: c.tier, answers, times, scoring: null };
  finishModule(state);
  return state;
}

// 소리가 안 나오는 기기에서는 듣기를 건너뛸 수 있어요
export function skipModule(state, mod) {
  const c = state.cur;
  if (!c || c.mod !== mod || mod !== 'listen') throw new LtError('이 영역은 건너뛸 수 없어요.');
  delete state.res.listen;
  state.skipped = [...(state.skipped || []), 'listen'];
  finishModule(state);
  return state;
}

export function needsAiScoring(state) {
  const w = state.res && state.res.write;
  return !!(w && w.tier !== 'A' && !w.scoring);
}

// ---------------------------------------------------------------- 학생 화면에 보내는 모양 (정답, 해설, 문법 이름은 빼요)
const pubOpts = (opts) => (opts || []).map((o) => (o && typeof o === 'object' ? { pic: o.pic } : String(o)));

function publicBlock(c) {
  if (!c) return null;
  if (c.mod === 'write') {
    const T = LT_WBANK[c.tier];
    return {
      mod: 'write',
      tier: c.tier,
      name: T.name,
      items: T.items.map((it) => ({
        id: it.id, kind: it.kind, q: it.q, pic: it.pic || null, tiles: it.tiles || null, ko: it.ko || null, cond: it.cond || null, words: it.words || null, limit: it.time,
      })),
    };
  }
  const items = ltBlock(c.mod, c.key);
  const base = { mod: c.mod, key: c.key };
  if (c.mod === 'voc') return { ...base, items: items.map((it) => ({ kind: 'voc', en: it.en, opts: pubOpts(it.opts), limit: it.limit })) };
  if (c.mod === 'gram') return { ...base, items: items.map((it) => ({ kind: it.kind, q: it.q, opts: pubOpts(it.opts), limit: it.limit })) };
  if (c.mod === 'read') {
    const B = LT_BANK[c.key];
    return { ...base, title: B.title || '', passage: B.passage || null, items: items.map((it) => ({ kind: 'read', q: it.q, box: it.box || null, pic: it.pic || null, opts: pubOpts(it.opts), limit: it.limit })) };
  }
  if (c.mod === 'listen') {
    const S = LT_LBANK[c.key];
    const set = S.kind === 'set';
    return {
      ...base,
      set,
      audio: set ? S.audio : null,
      plays: set ? S.plays || 1 : 2,
      rate: c.key <= 3 ? 0.85 : c.key <= 6 ? 0.9 : 1,
      items: items.map((it) => ({ kind: it.kind, q: it.q, say: set ? null : it.say, opts: pubOpts(it.opts), limit: it.limit })),
    };
  }
  return null;
}

// 학생 화면에 보낼 진행 상태
export function publicView(row, state) {
  const mods = state.mods.map((k, i) => ({
    key: k, name: LT_MODNAME[k], mins: LT_MODS[k].mins,
    state: state.skipped && state.skipped.includes(k) && i < state.mi ? 'skip' : i < state.mi ? 'done' : i === state.mi && !state.done ? 'now' : 'next',
  }));
  const cur = state.cur;
  const R = cur && state.res[cur.mod];
  return {
    status: row.status,
    done: !!state.done,
    student: { name: state.student.name, grade: state.student.grade, gradeName: LT_LEVELS[state.student.grade] ? LT_LEVELS[state.student.grade].name : '' },
    mods,
    mi: state.mi,
    block: publicBlock(cur),
    blockNo: R && R.steps ? R.steps.length + 1 : 1,
  };
}

// ---------------------------------------------------------------- 선생님 쪽: 분석, 목록 요약, 보낼 문구
export function analyze(row, state, books) {
  const a = ltAnalyzeAll({ student: state.student, date: state.date, mods: state.mods, res: state.res }, books);
  // 선생님이 영역마다 고른 교재가 있으면 그걸로 바꾸고, 의견 초안과 공부 방향을 다시 써요
  const ov = (state.bookOv && typeof state.bookOv === 'object' && state.bookOv) || {};
  let changed = false;
  for (const k of Object.keys(ov)) {
    const b = books.find((x) => x.skill === k && x.name === ov[k]);
    if (b && a.mods[k] && a.mods[k].level != null && a.books[k] !== b) {
      a.books[k] = b;
      changed = true;
    }
  }
  if (changed) {
    a.comment = ltComment2(a);
    a.plan = ltPlan2(a);
  }
  return a;
}

// 선생님이 고른 교재 (영역마다 하나, 빈 값이면 자동으로 골라요)
export function setBook(state, skill, name) {
  if (!LT_MOD_ORDER.includes(skill)) throw new LtError('모르는 영역이에요.');
  const ov = { ...((state.bookOv && typeof state.bookOv === 'object' && state.bookOv) || {}) };
  const n = String(name || '').trim().slice(0, 60);
  if (n) ov[skill] = n;
  else delete ov[skill];
  state.bookOv = ov;
  return state;
}

// 선생님이 라이팅 점수를 직접 고르거나 AI 점수를 고쳐요 (조건 영작 0~2점, 글쓰기 기준마다 1~5점, 한 줄 평)
export function teacherScoring(state, patch) {
  const w = state.res && state.res.write;
  if (!w || w.tier === 'A') throw new LtError('직접 채점할 라이팅이 없어요.');
  const T = LT_WBANK[w.tier];
  const cur = w.scoring || { items: [], essay: {}, by: 'teacher' };
  const pi = patch && Array.isArray(patch.items) ? patch.items : [];
  const items = T.items.filter((it) => it.kind === 'cond').map((it) => {
    const old = (cur.items || []).find((x) => x && x.id === it.id) || { id: it.id, points: null, corrected: '', note: '' };
    const p = pi.find((x) => x && x.id === it.id);
    if (!p || p.points === undefined) return old;
    const v = p.points === null || p.points === '' ? null : ltClamp(Math.round(Number(p.points) || 0), 0, 2);
    return { ...old, points: v };
  });
  const essay = { ...(cur.essay || {}) };
  const pe = (patch && patch.essay) || {};
  if (T.items.some((it) => it.kind === 'essay')) {
    for (const k of LT_RUBRIC) {
      if (pe[k.key] === undefined) continue;
      const v = Math.round(Number(pe[k.key]));
      if (v >= 1 && v <= 5) essay[k.key] = v;
      else delete essay[k.key];
    }
    if (pe.summary !== undefined) essay.summary = String(pe.summary || '').slice(0, 400);
    if (!Array.isArray(essay.errors)) essay.errors = [];
  }
  const by = cur.by === 'ai' || cur.by === 'ai+teacher' ? 'ai+teacher' : 'teacher';
  w.scoring = { items, essay, by, ...(cur.model ? { model: cur.model } : {}) };
  return state;
}

export function summaryOf(a) {
  const mods = {};
  for (const k of a.order) mods[k] = a.mods[k] ? a.mods[k].level : null;
  return { overall: a.overall ? { level: a.overall.level, cefr: a.overall.cefr } : null, mods };
}

// 어머니께 보낼 문구 (카카오톡에 붙여 넣어요)
export function messageText(a, academy, phone) {
  const ov = a.overall;
  const st = a.student;
  const lines = [`[${academy}] ${st.name} 학생 영어 레벨테스트 결과를 보내 드려요.`, ''];
  if (ov) lines.push(`종합: ${ov.level > 0 ? LT_LEVELS[ov.level].name : '기초'} 수준 (CEFR ${ov.cefr})`);
  lines.push(a.order.map((k) => `${LT_MODNAME[k]} ${a.mods[k].level == null ? '채점 전' : ltLvShort(a.mods[k].level)}`).join(', '));
  if (a.mods.read || ov) {
    const lv = a.mods.read ? a.mods.read.level : ov.level;
    lines.push(`책 고를 때 참고: 렉사일 ${ltLexText(lv)}, AR ${ltArText(lv)}`);
  }
  const low = (a.plan || []).slice(0, 2).filter((p) => p.book).map((p) => `${p.name} '${p.book}'`);
  if (low.length) lines.push(`추천 교재: ${low.join(', ')}`);
  lines.push('', '자세한 결과는 함께 보내 드리는 리포트(PDF)에서 보실 수 있어요.', '', phone ? `궁금하신 점은 ${phone}으로 편하게 연락 주세요.` : '궁금하신 점은 편하게 연락 주세요.');
  return lines.join('\n');
}

// 엔진(Claude)에게 줄 라이팅 채점 자료
export function writePayload(state) {
  const w = state.res.write;
  const T = LT_WBANK[w.tier];
  return {
    grade: LT_LEVELS[state.student.grade] ? LT_LEVELS[state.student.grade].name : '',
    tier: w.tier,
    tier_name: T.name,
    tier_range: `${ltLvShort(T.from)}~${ltLvShort(T.to)}`,
    items: T.items.filter((it) => it.kind === 'cond' || it.kind === 'essay').map((it) => ({
      id: it.id, kind: it.kind, q: it.q, ko: it.ko || '', cond: it.cond || [], model: it.model || '', words: it.words || null, answer: w.answers[it.id] || '',
    })),
    rubric: LT_RUBRIC.map((k) => ({ key: k.key, name: k.name, d5: k.d5, d3: k.d3, d1: k.d1 })),
  };
}

// 엔진이 보낸 채점을 다듬어요 (조건 영작 0~2점, 글쓰기 기준마다 1~5점)
export function cleanScoring(state, raw) {
  const w = state.res.write;
  const T = LT_WBANK[w.tier];
  const ids = T.items.filter((it) => it.kind === 'cond').map((it) => it.id);
  const sc = { items: [], essay: {}, by: 'ai' };
  for (const x of (raw && Array.isArray(raw.items) ? raw.items : [])) {
    if (!x || !ids.includes(x.id) || sc.items.some((y) => y.id === x.id)) continue;
    sc.items.push({ id: x.id, points: ltClamp(Math.round(Number(x.points) || 0), 0, 2), corrected: String(x.corrected || '').slice(0, 400), note: String(x.note || '').slice(0, 300) });
  }
  // 빈 답은 0점 (엔진이 빠뜨렸을 때)
  for (const id of ids) if (!sc.items.some((y) => y.id === id)) sc.items.push({ id, points: 0, corrected: '', note: w.answers[id] ? '' : '답을 쓰지 않았어요.' });
  const hasEssay = T.items.some((it) => it.kind === 'essay');
  if (hasEssay) {
    const e = (raw && raw.essay) || {};
    for (const k of LT_RUBRIC) {
      const v = Math.round(Number(e[k.key]));
      sc.essay[k.key] = v >= 1 && v <= 5 ? v : 1;
    }
    sc.essay.errors = (Array.isArray(e.errors) ? e.errors : []).slice(0, 4).map((x) => ({ wrong: String((x && x.wrong) || '').slice(0, 200), right: String((x && x.right) || '').slice(0, 200), why: String((x && x.why) || '').slice(0, 200) }));
    sc.essay.summary = String(e.summary || '').slice(0, 400);
  }
  return sc;
}

export { LT_YEARS, LT_MODS, LT_MOD_ORDER, LT_MODNAME, LT_LEVELS };
