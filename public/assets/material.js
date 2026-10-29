// 새 강의 자료 다듬기: 교과서·부교재·시험지에서 붙여 넣은 글을 판서 강의용 지문으로 정리하고, 길면 나눠 만들 계획을 세워요.
// 엔진(engine/ivy_engine/textutil.py)과 같은 약속이에요: '## '로 시작하는 줄은 소제목, 쪽 번호·어휘 풀이·한글 줄은 빼요.

const SMALL_W = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'nor', 'with', 'by', 'from', 'as', 'vs', 'into', 'about', 'than', 'via']);
// 줄이 이 말로 끝나면 문장이 이어지는 중이라 소제목이 아니에요
const END_W = new Set([
  ...SMALL_W, 'that', 'which', 'who', 'whom', 'whose', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'will', 'would', 'can', 'could', 'shall', 'should',
  'may', 'might', 'must', 'has', 'have', 'had', 'do', 'does', 'did', 'not', 'very', 'so', 'its', 'their', 'his', 'her', 'our', 'your', 'my', 'this', 'these',
  'those', 'such', 'if', 'when', 'while', 'because', 'although', 'though', 'where', 'how', 'what', 'why', 'it', 'they', 'we', 'he', 'she', 'i', 'you', 'more', 'most',
]);
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'u.s', 'u.k', 'no', 'fig', 'ca', 'approx', 'dept', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mt', 'ft', 'vol', 'p', 'pp', 'a.m', 'p.m', 'cf', 'al']);
const STARTS = /^["“‘([]?[A-Z0-9]/;
const ENDS_SENT = /[.!?]["”’)\]]*$/;

// 영어 문장 나누기 (엔진 textutil.split_sentences 와 같은 규칙)
export function splitSentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  let start = 0;
  const re = /[.!?]+["”’)\]]*\s+(?=["“‘([]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(start, m.index + 1);
    if (t[m.index] === '.') {
      const w = /([A-Za-z][A-Za-z.]*)\.$/.exec(before);
      if (w && ABBR.has(w[1].toLowerCase().replace(/\.+$/, ''))) continue;
      if (/(?:^|\s)[A-Z]\.$/.test(before)) continue;
    }
    out.push(t.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// 소제목처럼 생긴 줄: 제목처럼 대문자로 쓴 짧은 줄 (The Power of Habit, Why Do We Dream?)
export function titleLike(line) {
  const t = String(line || '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 12 || !/[A-Za-z]/.test(t) || /[.,;]$/.test(t) || !STARTS.test(t)) return false;
  const content = words.map((w) => w.replace(/[^A-Za-z]/g, '')).filter((w) => w && !SMALL_W.has(w.toLowerCase()));
  if (!content.length) return false;
  const caps = content.filter((w) => /^[A-Z]/.test(w)).length;
  return /[?!]$/.test(t) ? content.length >= 2 && caps === content.length : caps / content.length >= 0.7;
}
// 문장꼴 짧은 소제목 (A new way to learn): 7단어 이하, 문장부호로 안 끝나고, 이어지는 말(the, of, that …)로 안 끝나요
function shortHead(line) {
  const t = String(line || '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 7 || /[.,;:?!]$/.test(t) || !STARTS.test(t)) return false;
  const last = words[words.length - 1].replace(/[^A-Za-z']/g, '').toLowerCase();
  return !!last && !END_W.has(last);
}

// 지문이 아닌 줄: 쪽·줄 번호만 있는 줄, * 로 시작하는 어휘 풀이, Q1. 같은 문제, 한글이 많은 줄
export function noiseLine(line) {
  const s = String(line || '').trim();
  if (!s) return '';
  if (/^[-–—([]?\s*(?:p\.?|pp\.?|page)?\s*\d{1,4}\s*[-–—)\]]?$/i.test(s)) return '쪽·줄 번호';
  if (/^[*※]/.test(s)) return '어휘 풀이';
  if (/^(?:Q|Question)\s*\d+\s*[.):]/i.test(s)) return '문제';
  const han = (s.match(/[가-힣]/g) || []).length;
  if (han && han >= (s.match(/[A-Za-z]/g) || []).length * 0.5) return '한글';
  return '';
}

// 붙여 넣은 자료 정리: 지문이 아닌 줄은 빼고, 소제목은 '## 소제목' 줄로 떼고, PDF처럼 끊긴 줄은 문단으로 이어요
export function prepareMaterial(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  const dropped = [];
  const kept = [];
  for (const line of lines) {
    const why = line && !line.startsWith('#') ? noiseLine(line) : '';
    if (why) dropped.push({ text: line, why });
    else kept.push(line);
  }
  const items = []; // { kind: 'head'|'text'|'gap', text }
  let prevKind = 'gap';
  let prevText = '';
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i];
    if (!line) {
      items.push({ kind: 'gap' });
      prevKind = 'gap';
      continue;
    }
    if (line.startsWith('#')) {
      const h = line.replace(/^#+\s*/, '');
      if (h) {
        items.push({ kind: 'head', text: h });
        prevKind = 'head';
      }
      continue;
    }
    const next = kept.slice(i + 1).find((x) => x) || '';
    const ended = prevKind !== 'text' || ENDS_SENT.test(prevText);
    if (next && ended && STARTS.test(next) && !next.startsWith('#') && (titleLike(line) || shortHead(line))) {
      items.push({ kind: 'head', text: line });
      prevKind = 'head';
      continue;
    }
    items.push({ kind: 'text', text: line });
    prevKind = 'text';
    prevText = line;
  }
  // 문단: 빈 줄이나 소제목에서 끊고, 끊긴 줄은 띄어쓰기로 이어요 (하이픈으로 끊긴 말은 하이픈을 두고 붙여요)
  const blocks = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) blocks.push({ kind: 'para', text: cur.trim() });
    cur = '';
  };
  for (const x of items) {
    if (x.kind === 'gap') flush();
    else if (x.kind === 'head') {
      flush();
      blocks.push({ kind: 'head', text: x.text });
    } else cur = !cur ? x.text : /[A-Za-z]-$/.test(cur) ? cur + x.text : `${cur} ${x.text}`;
  }
  flush();
  const text = blocks.map((b) => (b.kind === 'head' ? `## ${b.text}` : b.text)).join('\n\n');
  // 붙어 있는 소제목 줄(Lesson 3 / A World Full of Plastic)은 하나로 세요 (판서에서 한 줄로 써요)
  return { text, dropped, headings: blocks.filter((b, i) => b.kind === 'head' && !(blocks[i - 1] && blocks[i - 1].kind === 'head')).length };
}

// 지문 구성: 소제목(## 줄)마다 묶고, 빈 줄로 문단을 나눠 문장 수를 세요
export function outline(text) {
  const sections = [];
  let sec = { heading: '', paras: [] };
  let para = [];
  const endPara = () => {
    const t = para.join(' ').replace(/\s+/g, ' ').trim();
    if (t) sec.paras.push({ text: t, sents: splitSentences(t) });
    para = [];
  };
  const endSec = () => {
    endPara();
    if (sec.heading || sec.paras.length) sections.push(sec);
  };
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const h = line.replace(/^#+\s*/, '');
      if (!h) continue;
      if (!para.length && !sec.paras.length && sec.heading) sec.heading = `${sec.heading} · ${h}`;
      else {
        endSec();
        sec = { heading: h, paras: [] };
      }
    } else if (!line || noiseLine(line)) {
      if (!line) endPara();
    } else para.push(line);
  }
  endSec();
  for (const s of sections) s.n = s.paras.reduce((a, p) => a + p.sents.length, 0);
  return { sections, total: sections.reduce((a, s) => a + s.n, 0), headings: sections.filter((s) => s.heading).length };
}

// 긴 지문 나누기: 소제목(없으면 문단)마다 묶어 강의 하나에 8~20문장쯤 되게 나눠요. 너무 긴 덩어리는 문장으로 잘라요
export const PART_MIN = 8;
export const PART_MAX = 20;
export function planParts(ol) {
  const units = [];
  const many = ol.sections.length >= 2;
  for (const sec of ol.sections) {
    const pieces = many && sec.n <= PART_MAX ? [{ heading: sec.heading, paras: sec.paras, n: sec.n }] : [];
    if (!pieces.length) {
      // 한 덩어리가 너무 길거나 소제목이 하나뿐이면 문단으로, 문단도 길면 문장으로 잘라요
      sec.paras.forEach((p, k) => {
        if (p.sents.length <= PART_MAX) pieces.push({ heading: k === 0 ? sec.heading : '', paras: [p], n: p.sents.length });
        else {
          const chunks = Math.ceil(p.sents.length / 15);
          const size = Math.ceil(p.sents.length / chunks);
          for (let c = 0; c < chunks; c++) {
            const ss = p.sents.slice(c * size, (c + 1) * size);
            pieces.push({ heading: k === 0 && c === 0 ? sec.heading : '', paras: [{ text: ss.join(' '), sents: ss }], n: ss.length });
          }
        }
      });
    }
    units.push(...pieces);
  }
  const parts = [];
  let cur = null;
  for (const u of units) {
    if (cur && cur.n + u.n > PART_MAX && cur.n >= PART_MIN) {
      parts.push(cur);
      cur = null;
    }
    if (!cur) cur = { units: [], n: 0 };
    cur.units.push(u);
    cur.n += u.n;
  }
  if (cur) parts.push(cur);
  // 마지막 조각이 너무 작으면 앞 조각에 붙여요
  if (parts.length >= 2 && parts[parts.length - 1].n < PART_MIN && parts[parts.length - 2].n + parts[parts.length - 1].n <= PART_MAX + 6) {
    const last = parts.pop();
    parts[parts.length - 1].units.push(...last.units);
    parts[parts.length - 1].n += last.n;
  }
  return parts.map((p) => ({
    n: p.n,
    headings: p.units.map((u) => u.heading).filter(Boolean),
    first: (p.units[0] && p.units[0].paras[0] && p.units[0].paras[0].sents[0]) || '',
    text: p.units.map((u) => `${u.heading ? `## ${u.heading}\n\n` : ''}${u.paras.map((x) => x.text).join('\n\n')}`).join('\n\n'),
  }));
}

// 선생님이 준 해석을 나눈 강의마다 나눠요. 문장 수가 지문과 같을 때만 나누고, 다르면 null (엔진이 참고로만 써요)
export function splitTranslation(tr, parts, total) {
  const ko = String(tr || '').replace(/\s+/g, ' ').trim();
  if (!ko) return null;
  const sents = ko.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sents.length !== total) return null;
  const out = [];
  let at = 0;
  for (const p of parts) {
    out.push(sents.slice(at, at + p.n).join(' '));
    at += p.n;
  }
  return out;
}
