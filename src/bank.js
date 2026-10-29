// 문제 은행: 강의(지문)마다 학원 PC 엔진이 만든 변형 문제를 쌓아 두고, 숙제·모의고사·출력용 숙제지로 나눠 써요.
// - 숙제(사이트): 객관식 10 + 서술형 5, 강의마다 한 묶음 (lectures.homework, 문항을 그대로 담아 둬요)
// - 출력용 숙제지: 객관식 20 + 서술형 5, 뽑을 때마다 새 묶음 (print_sets). 사이트 숙제나 모의고사에 나온 문제는 되도록 빼요
// - 모의고사: 학생이 풀 때마다 객관식 10문항을 새로 뽑아요 (mock_attempts). 안 본 문제부터, 유형이 고루 섞이게
import { str, int, now, safeParse } from './util.js';
import { MARKS, SA_KINDS } from './quiz.js';

// 변형 문제 유형 (문항의 area). 화면 이름은 quizview.js AREA 와 같아요
export const BANK_AREAS = ['topic', 'title', 'gist', 'detail', 'translate', 'vocab', 'grammar', 'refer', 'blank', 'order', 'insert', 'irrelevant', 'summary', 'content'];
const SA_AREAS = ['vocab', 'grammar', 'content'];
const ORDER = Object.fromEntries(BANK_AREAS.map((a, i) => [a, i]));

export const HW_PLAN = { mc: 10, sa: 5 };
export const PRINT_PLAN = { mc: 20, sa: 5 };
export const MOCK_N = 10;
export const BANK_WANT = { mc: 24, sa: 8 }; // 엔진에 한 번에 부탁하는 수 (검사에서 조금 빠져요)
export const BANK_MAX = 400; // 강의 하나에 쌓는 문항 수 한도 (엔진 요금을 아껴요)
const AUTO_GAP = 30 * 60; // 모의고사 때문에 저절로 더 만들 때는 30분에 한 번까지

// 엔진이 보낸 문항 하나를 정리해요. 모양이 틀리면 null
export function cleanBankItem(it) {
  if (!it || typeof it !== 'object') return null;
  const base = { q: str(it.q, 400), text: str(it.text, 4000), why: str(it.why, 800), ref: str(it.ref, 60) };
  if (!base.q) return null;
  if (it.type === 'mc') {
    const choices = (Array.isArray(it.choices) ? it.choices : []).slice(0, 5).map((c) => str(c, 300)).filter(Boolean);
    const answer = int(it.answer, -1);
    if (choices.length !== 5 || answer < 0 || answer > 4) return null;
    return { type: 'mc', area: BANK_AREAS.includes(it.area) ? it.area : 'content', ...base, choices, answer };
  }
  if (it.type === 'sa') {
    const answer = str(it.answer, 120);
    if (!answer) return null;
    const kind = SA_KINDS.includes(it.kind) ? it.kind : 'word';
    const item = {
      type: 'sa',
      kind,
      area: SA_AREAS.includes(it.area) ? it.area : kind === 'fix' || kind === 'form' ? 'grammar' : kind === 'word' ? 'vocab' : 'content',
      ...base,
      answer,
      accept: (Array.isArray(it.accept) ? it.accept : []).slice(0, 8).map((a) => str(a, 120)).filter(Boolean),
      hint: str(it.hint, 160),
    };
    if (kind === 'fix') {
      if (!MARKS.includes(it.mark)) return null;
      item.mark = it.mark;
    }
    return item;
  }
  return null;
}

// 은행 문항 줄 → 문항 (bank_id 를 붙여요)
export function rowItem(r) {
  const it = safeParse(r.data, null);
  return it ? { ...it, bank_id: r.id } : null;
}

export async function bankRows(env, lectureId, withHidden = false) {
  const { results } = await env.DB.prepare(`SELECT * FROM bank_items WHERE lecture_id = ?${withHidden ? '' : ' AND hidden = 0'} ORDER BY id`).bind(lectureId).all();
  return results;
}

// 어디에 쓰인 문항인지: 사이트 숙제, 출력한 숙제지, 선생님이 만든 시험, 모의고사(학생별: 문항 → 그 학생이 마지막으로 본 모의고사 번호)
// 숙제지와 시험에 쓴 문제는 선생님이 따로 쓰는 문제라서 숙제, 모의고사, 다른 숙제지에 다시 나오지 않아요 (reserved)
export async function usage(env, lectureId, userId = null, skipAttempt = 0) {
  const l = await env.DB.prepare('SELECT homework FROM lectures WHERE id = ?').bind(lectureId).first();
  const hw = safeParse(l && l.homework, null);
  const hwIds = new Set(hw && Array.isArray(hw.bank_ids) ? hw.bank_ids : []);
  const printIds = new Set();
  for (const r of (await env.DB.prepare('SELECT bank_ids FROM print_sets WHERE lecture_id = ?').bind(lectureId).all()).results) {
    for (const id of safeParse(r.bank_ids, []) || []) printIds.add(id);
  }
  const examIds = new Set();
  const ex = await env.DB.prepare('SELECT e.bank_ids FROM exams e WHERE EXISTS (SELECT 1 FROM json_each(e.lecture_ids) j WHERE j.value = ?)').bind(lectureId).all();
  for (const r of ex.results) for (const id of safeParse(r.bank_ids, []) || []) examIds.add(id);
  const mockIds = new Set();
  const mineIds = new Map();
  for (const r of (await env.DB.prepare('SELECT id, user_id, items FROM mock_attempts WHERE lecture_id = ? ORDER BY id').bind(lectureId).all()).results) {
    for (const id of safeParse(r.items, []) || []) {
      mockIds.add(id);
      if (userId && r.user_id === userId && r.id !== skipAttempt) mineIds.set(id, r.id);
    }
  }
  return { hwIds, printIds, examIds, mockIds, mineIds };
}

// 숙제지나 시험에 쓴 문제 (선생님이 따로 쓰는 문제)
export const reserved = (use, id) => use.printIds.has(id) || (use.examIds ? use.examIds.has(id) : false);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 유형(객관식) 또는 종류(서술형)마다 줄을 세워 돌아가며 하나씩 뽑아요. 줄 안에서는 점수 높은 것부터, 같으면 무작위
function roundRobin(list, n) {
  const lanes = new Map();
  for (const it of list) {
    const k = it.type === 'sa' ? `sa:${it.kind}` : it.area;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(it);
  }
  for (const l of lanes.values()) l.sort((a, b) => (b._score - a._score) || (a._r - b._r));
  const keys = shuffle([...lanes.keys()]);
  const out = [];
  while (out.length < n) {
    let took = false;
    for (const k of keys) {
      const l = lanes.get(k);
      if (out.length >= n || !l.length) continue;
      out.push(l.shift());
      took = true;
    }
    if (!took) break;
  }
  return out;
}

// 먼저 고를 것(first)에서 유형이 고루 섞이게 뽑고, 모자라면 나머지(rest)에서 채워요
function pick(first, rest, n) {
  const tag = (x) => ({ ...x, _score: Number(x.score) || 3, _r: Math.random() });
  const a = roundRobin(first.map(tag), n);
  if (a.length >= n) return a;
  return a.concat(roundRobin(rest.map(tag), n - a.length));
}

export function sortSet(items) {
  return items
    .slice()
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'mc' ? -1 : 1) || (ORDER[a.area] ?? 99) - (ORDER[b.area] ?? 99) || a.bank_id - b.bank_id);
}

const strip = ({ _score, _r, ...x }) => x; // eslint-disable-line no-unused-vars

// 사이트 숙제: 출력한 숙제지와 시험에 나온 문제는 빼고, 점수 높은 것부터 유형을 섞어 객관식 10 + 서술형 5
export function drawHomework(rows, use) {
  const items = rows.map((r) => ({ ...rowItem(r), score: r.score })).filter((x) => x.q && !reserved(use, x.bank_id));
  const mc = pick(items.filter((x) => x.type === 'mc'), [], HW_PLAN.mc);
  const sa = pick(items.filter((x) => x.type === 'sa'), [], HW_PLAN.sa);
  return sortSet([...mc, ...sa].map(strip));
}

// 출력용 숙제지: 사이트 숙제, 이미 출력한 문제, 시험에 쓴 문제는 빼고, 모의고사에 안 나온 문제부터 객관식 20 + 서술형 5. 모자라면 null
export function drawPrint(rows, use) {
  const items = rows.map((r) => ({ ...rowItem(r), score: r.score })).filter((x) => x.q && !use.hwIds.has(x.bank_id) && !reserved(use, x.bank_id));
  const fresh = (x) => !use.mockIds.has(x.bank_id);
  const mcAll = items.filter((x) => x.type === 'mc');
  const saAll = items.filter((x) => x.type === 'sa');
  if (mcAll.length < PRINT_PLAN.mc || saAll.length < Math.min(PRINT_PLAN.sa, 3)) return null;
  const mc = pick(mcAll.filter(fresh), mcAll.filter((x) => !fresh(x)), PRINT_PLAN.mc);
  const sa = pick(saAll.filter(fresh), saAll.filter((x) => !fresh(x)), PRINT_PLAN.sa);
  return sortSet([...mc, ...sa].map(strip));
}

// 이 학생이 이미 본 문제인지 (사이트 숙제 문제는 모두 본 것으로 쳐요)
export const seenBy = (use) => (id) => use.mineIds.has(id) || use.hwIds.has(id);

// 모의고사: 출력한 숙제지와 시험 문제는 빼고, 이 학생이 안 본 문제부터 객관식 10문항 (유형이 고루 섞이게).
// 안 본 문제가 모자라면 가장 오래전에 본 문제로 채워요 (같은 문제만 되풀이하지 않게). repeat: 전에 본 문제 수
export function drawMock(rows, use) {
  const items = rows.map((r) => ({ ...rowItem(r), score: r.score })).filter((x) => x.q && x.type === 'mc' && !reserved(use, x.bank_id));
  const seen = seenBy(use);
  const fresh = items.filter((x) => !seen(x.bank_id));
  let out = pick(fresh, [], MOCK_N);
  if (out.length < MOCK_N) {
    const old = items.filter((x) => seen(x.bank_id)).map((x) => ({ ...x, _score: -(use.mineIds.get(x.bank_id) || 0), _r: Math.random() }));
    out = out.concat(roundRobin(old, MOCK_N - out.length));
  }
  const repeat = out.filter((x) => seen(x.bank_id)).length;
  return { items: sortSet(out.map(strip)), unseenLeft: fresh.length - (out.length - repeat), repeat };
}

// 은행을 채우는 엔진 작업을 줄 세워요. auto 면 30분에 한 번까지만
export async function queueBank(env, lectureId, { auto = false, want = BANK_WANT } = {}) {
  const busy = await env.DB.prepare("SELECT id FROM tasks WHERE lecture_id = ? AND kind = 'bank' AND status IN ('queued','running')").bind(lectureId).first();
  if (busy) return { id: busy.id, already: true };
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM bank_items WHERE lecture_id = ?').bind(lectureId).first();
  if ((n && n.n) >= BANK_MAX) return null;
  if (auto) {
    const last = await env.DB.prepare("SELECT created_at FROM tasks WHERE lecture_id = ? AND kind = 'bank' ORDER BY id DESC LIMIT 1").bind(lectureId).first();
    if (last && last.created_at > now() - AUTO_GAP) return null;
  }
  const r = await env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('bank', ?, 'queued', ?, ?, ?)")
    .bind(lectureId, JSON.stringify({ want }), now() + 3, now())
    .run();
  return { id: r.meta.last_row_id };
}

// 강의가 완성되면 처음 은행을 채우는 작업 (이미 문제가 있거나 작업이 있으면 그대로)
export async function queueFirstBank(env, lectureId) {
  const has = await env.DB.prepare('SELECT 1 FROM bank_items WHERE lecture_id = ? LIMIT 1').bind(lectureId).first();
  if (has) return null;
  const busy = await env.DB.prepare("SELECT 1 FROM tasks WHERE lecture_id = ? AND kind = 'bank'").bind(lectureId).first();
  if (busy) return null;
  return env.DB.prepare("INSERT INTO tasks (kind, lecture_id, status, payload, created_at, updated_at) VALUES ('bank', ?, 'queued', ?, ?, ?)")
    .bind(lectureId, JSON.stringify({ want: BANK_WANT }), now() + 4, now());
}

// 숙제 묶음 (확인 문제와 같은 모양: quiz.js 의 채점 함수를 그대로 써요)
export function homeworkOf(items) {
  return { v: 1, ver: now(), items: items.map((it, i) => ({ no: i + 1, ...it })), bank_ids: items.map((x) => x.bank_id) };
}

// 사이트 숙제가 아직 없으면 은행에서 뽑아 만들어요 (은행이 처음 채워졌을 때)
export async function ensureHomework(env, lectureId) {
  const l = await env.DB.prepare('SELECT homework FROM lectures WHERE id = ?').bind(lectureId).first();
  if (!l || l.homework) return false;
  const rows = await bankRows(env, lectureId);
  const use = await usage(env, lectureId);
  const items = drawHomework(rows, use);
  if (items.filter((x) => x.type === 'mc').length < 5) return false;
  await env.DB.prepare('UPDATE lectures SET homework = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(homeworkOf(items)), now(), lectureId).run();
  return true;
}
