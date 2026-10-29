// 확인 문제: 강의를 듣고 푸는 문제 (1.2.0 엔진부터 객관식 25문항, 예전에 만든 문제는 객관식 20 + 서술형 5). 학원 PC 엔진이 만들고 사이트가 채점해요.
// lectures.quiz 에는 정답까지 들어 있어요. 학생에게는 publicQuiz 로 정답을 빼고 보내고, 낸 뒤에만 정답과 해설을 보여 줘요.
import { str, int, now, safeParse } from './util.js';

export const QUIZ_AREAS = ['vocab', 'grammar', 'translate', 'content', 'variant'];
export const SA_KINDS = ['word', 'fix', 'form', 'blank', 'refer'];
export const MARKS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ'];

// 채점 결과 값: 1 맞음, 0 틀림 (자동) / 2 맞음, 3 틀림 (선생님이 바꿈)
export const isOk = (r) => r === 1 || r === 2;

export function readQuiz(raw) {
  const q = safeParse(raw, null);
  return q && Array.isArray(q.items) && q.items.length ? q : null;
}

// 엔진이 보낸 문제를 정리해요. 모양이 틀린 문항은 빼요.
export function cleanQuiz(x) {
  const o = x && typeof x === 'object' ? x : {};
  const list = Array.isArray(o.items) ? o.items.slice(0, 40) : [];
  const mc = [];
  const sa = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const base = {
      area: QUIZ_AREAS.includes(it.area) ? it.area : 'content',
      q: str(it.q, 400),
      text: str(it.text, 1500),
      why: str(it.why, 600),
      ref: str(it.ref, 60),
    };
    if (!base.q) continue;
    if (it.type === 'mc') {
      const choices = (Array.isArray(it.choices) ? it.choices : []).slice(0, 5).map((c) => str(c, 240)).filter(Boolean);
      const answer = int(it.answer, -1);
      if (choices.length < 4 || answer < 0 || answer >= choices.length) continue;
      mc.push({ type: 'mc', ...base, choices, answer });
    } else if (it.type === 'sa') {
      const answer = str(it.answer, 120);
      if (!answer) continue;
      const kind = SA_KINDS.includes(it.kind) ? it.kind : 'word';
      const item = {
        type: 'sa',
        kind,
        ...base,
        answer,
        accept: (Array.isArray(it.accept) ? it.accept : []).slice(0, 8).map((a) => str(a, 120)).filter(Boolean),
        hint: str(it.hint, 120),
      };
      if (kind === 'fix') {
        if (!MARKS.includes(it.mark)) continue; // 고칠 곳 기호가 없으면 채점할 수 없어요
        item.mark = it.mark;
      }
      sa.push(item);
    }
  }
  const items = [...mc, ...sa].map((it, i) => ({ no: i + 1, ...it }));
  return { v: 1, ver: now(), made_by: str(o.generated_by, 60), items };
}

export function quizInfo(q) {
  if (!q) return null;
  return { ver: q.ver, n: q.items.length, mc: q.items.filter((x) => x.type === 'mc').length, sa: q.items.filter((x) => x.type === 'sa').length };
}

// 학생이 풀 때 보는 문제 (정답, 허용 답, 해설 없이)
export function publicQuiz(q) {
  return {
    ver: q.ver,
    items: q.items.map((it) => {
      const o = { no: it.no, type: it.type, area: it.area, q: it.q, text: it.text };
      if (it.type === 'mc') o.choices = it.choices;
      else {
        o.kind = it.kind;
        o.hint = it.hint;
      }
      return o;
    }),
  };
}

// 서술형 답 비교: 대소문자, 앞뒤 따옴표·마침표, 띄어쓰기 차이는 봐줘요
export function normAns(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'(\[]+|["')\].,!?;:]+$/g, '')
    .trim();
}

function fixText(t) {
  // "was → were", "ⓒ were" 처럼 써도 고친 말만 봐요
  let s = String(t ?? '');
  const arrow = s.search(/→|->|=>/);
  if (arrow >= 0) s = s.slice(arrow).replace(/^(→|->|=>)/, '');
  return s.replace(/^[ⓐⓑⓒⓓⓔ]\s*/, '');
}

// 학생이 낸 답을 문항 모양에 맞게 정리해요
export function cleanAnswer(it, a) {
  if (it.type === 'mc') {
    const n = int(a, -1);
    return n >= 0 && n < it.choices.length ? n : null;
  }
  if (it.kind === 'fix') {
    const o = a && typeof a === 'object' ? a : { m: '', t: a };
    const m = MARKS.includes(o.m) ? o.m : '';
    const t = str(o.t, 120);
    return m || t ? { m, t } : null;
  }
  const t = str(a, 120);
  return t || null;
}

// 본문에서 찾아 쓰는 답(단어, 빈칸, 가리키는 말)은 앞의 관사(the, a, an) 차이도 봐줘요
const noArticle = (s) => s.replace(/^(the|a|an) /, '');

export function autoGrade(it, a) {
  if (a === null || a === undefined) return 0;
  if (it.type === 'mc') return a === it.answer ? 1 : 0;
  const ok = new Set([it.answer, ...(it.accept || [])].map(normAns).filter(Boolean));
  if (it.kind === 'fix') return a.m === it.mark && ok.has(normAns(fixText(a.t))) ? 1 : 0;
  const mine = normAns(a);
  if (ok.has(mine)) return 1;
  if (['word', 'blank', 'refer'].includes(it.kind) && [...ok].some((x) => noArticle(x) === noArticle(mine))) return 1;
  return 0;
}

export function gradeAll(q, answers) {
  const list = Array.isArray(answers) ? answers : [];
  const clean = q.items.map((it, i) => cleanAnswer(it, list[i]));
  const results = q.items.map((it, i) => autoGrade(it, clean[i]));
  return { answers: clean, results, score: results.filter(isOk).length, total: q.items.length };
}

// 낸 뒤에 보는 문제: 정답과 해설까지
export function reviewQuiz(q) {
  return { ver: q.ver, items: q.items.map(({ no, type, area, kind, q: qq, text, choices, answer, accept, mark, hint, why, ref }) => ({ no, type, area, kind, q: qq, text, choices, answer, accept, mark, hint, why, ref })) };
}

export function attemptOut(r) {
  if (!r) return null;
  return {
    id: r.id,
    score: r.score,
    total: r.total,
    created_at: r.created_at,
    answers: safeParse(r.answers, []),
    results: safeParse(r.results, []),
  };
}
