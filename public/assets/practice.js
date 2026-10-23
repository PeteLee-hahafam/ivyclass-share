// 연습지 (A4 인쇄용). 학원 PC 제작 엔진이 PDF로 만들어 올려요.
import { normalizeScript } from './board.js';

const CSS = `
.pr { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif; color: #1c2333; font-size: 13.5px; line-height: 1.6; width: 100%; }
.pr * { box-sizing: border-box; }
.pr .top { display: flex; align-items: flex-end; gap: 16px; border-bottom: 2px solid #1f2d5c; padding-bottom: 10px; margin-bottom: 18px; }
.pr .top .ac { font-size: 11.5px; font-weight: 700; color: #1f2d5c; letter-spacing: .2px; }
.pr .top h1 { margin: 2px 0 0; font-size: 21px; font-weight: 800; letter-spacing: -.4px; }
.pr .top .src { font-size: 11.5px; color: #6b7385; margin-top: 2px; }
.pr .top .who { margin-left: auto; display: grid; grid-template-columns: auto 120px; gap: 6px 8px; font-size: 12px; color: #4b5263; align-items: end; }
.pr .top .who span:nth-child(even) { border-bottom: 1px solid #9aa2b3; height: 18px; }
.pr h2 { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; margin: 22px 0 10px; color: #1f2d5c; break-after: avoid; }
.pr h2 b { width: 22px; height: 22px; border-radius: 6px; background: #1f2d5c; color: #fff; font-size: 12px; display: grid; place-items: center; }
.pr .hint { font-size: 11.5px; color: #7a8294; font-weight: 500; margin-left: 4px; }
.pr .voc { display: grid; grid-template-columns: 1fr 1fr; column-gap: 26px; }
.pr .voc div { display: grid; grid-template-columns: 22px 1fr 1.1fr; gap: 8px; align-items: end; padding: 7px 0; border-bottom: 1px dashed #d5d9e2; break-inside: avoid; }
.pr .voc .n { color: #8b93a5; font-size: 11.5px; }
.pr .voc .w { font-family: 'Noto Serif', Georgia, serif; font-size: 14px; }
.pr .voc .b { border-bottom: 1px solid #b5bccb; height: 20px; }
.pr ol.q { margin: 0; padding: 0; list-style: none; counter-reset: q; }
.pr ol.q > li { counter-increment: q; position: relative; padding: 9px 0 11px 30px; border-bottom: 1px solid #eef0f4; break-inside: avoid; }
.pr ol.q > li::before { content: counter(q); position: absolute; left: 0; top: 10px; width: 21px; height: 21px; border-radius: 50%; border: 1.5px solid #1f2d5c; color: #1f2d5c; font-size: 11px; font-weight: 800; display: grid; place-items: center; }
.pr .en { font-family: 'Noto Serif', Georgia, serif; font-size: 14.5px; line-height: 1.75; }
.pr .en .ch { font-weight: 600; color: #1f2d5c; white-space: nowrap; }
.pr .ans { display: inline-block; min-width: 110px; border-bottom: 1px solid #9aa2b3; margin-left: 8px; height: 18px; vertical-align: -3px; }
.pr .from { font-size: 11px; color: #8b93a5; margin-left: 6px; font-family: 'Pretendard Variable', sans-serif; }
.pr .lines { margin-top: 6px; }
.pr .lines i { display: block; height: 26px; border-bottom: 1px solid #c9ced9; }
.pr .key { break-before: page; }
.pr .key h2 { color: #b23b2f; }
.pr .key h2 b { background: #b23b2f; }
.pr .key table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pr .key td { padding: 6px 8px; border-bottom: 1px solid #eceef3; vertical-align: top; }
.pr .key td.k { width: 34px; color: #8b93a5; font-weight: 700; }
.pr .key .a { font-weight: 800; color: #b23b2f; }
.pr .key .why { color: #4b5263; }
.pr .key .ko { color: #3b4252; }
.pr .one { border: 1.5px solid #1f2d5c; border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 700; color: #1f2d5c; background: #f6f8fd; }
.pr ul.pt { margin: 0; padding: 0; list-style: none; }
.pr ul.pt li { position: relative; padding: 7px 0 7px 22px; border-bottom: 1px dashed #dfe2ea; break-inside: avoid; }
.pr ul.pt li::before { content: ''; position: absolute; left: 4px; top: 15px; width: 8px; height: 8px; border-radius: 50%; border: 2px solid #e5372b; }
.pr .toc { display: grid; grid-template-columns: 1fr 1fr; column-gap: 26px; }
.pr .toc div { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid #eef0f4; }
.pr .toc .t { font-variant-numeric: tabular-nums; color: #8b93a5; min-width: 44px; }
.pr .ch4 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; margin-top: 5px; font-size: 13px; }
`;

function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// "(caught / catching)" 같은 선택지를 굵게
function choiceLine(text) {
  const wrap = h('div', { class: 'en' });
  const re = /\(([^()]+\/[^()]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    wrap.appendChild(document.createTextNode(text.slice(last, m.index)));
    wrap.appendChild(h('span', { class: 'ch', text: `( ${m[1].split('/').map((x) => x.trim()).join(' / ')} )` }));
    last = m.index + m[0].length;
  }
  wrap.appendChild(document.createTextNode(text.slice(last)));
  return wrap;
}

export function renderPractice(host, input, opts = {}) {
  const s = normalizeScript(input);
  const pr = s.practice || {};
  const grammar = (pr.grammar || []).filter((x) => x && x.q);
  const blanks = (pr.blanks || []).filter((x) => x && x.q);
  if (!document.getElementById('pr-css')) document.head.appendChild(h('style', { id: 'pr-css', text: CSS }));
  const root = h('div', { class: 'pr' });
  root.appendChild(
    h('div', { class: 'top' }, [
      h('div', {}, [h('div', { class: 'ac', text: opts.academy || '' }), h('h1', { text: `${s.title || '지문'} · 연습지` }), h('div', { class: 'src', text: opts.header || s.source || '' })]),
      h('div', { class: 'who' }, [h('span', { text: '이름' }), h('span'), h('span', { text: '날짜' }), h('span')]),
    ]),
  );
  let no = 0;
  const sec = (title, hint) => h('h2', {}, [h('b', { text: String(++no) }), title, hint ? h('span', { class: 'hint', text: hint }) : null]);

  if (s.vocab.length) {
    root.appendChild(sec('어휘 확인', '우리말 뜻을 쓰세요'));
    root.appendChild(h('div', { class: 'voc' }, s.vocab.map((v, i) => h('div', {}, [h('span', { class: 'n', text: String(i + 1) }), h('span', { class: 'w', text: v.en }), h('span', { class: 'b' })]))));
  }
  if (grammar.length) {
    root.appendChild(sec('어법 선택', '괄호 안에서 알맞은 것을 고르세요'));
    root.appendChild(h('ol', { class: 'q' }, grammar.map((g) => h('li', {}, [choiceLine(g.q), h('div', { style: 'margin-top:4px;font-size:12px;color:#6b7385' }, ['답', h('span', { class: 'ans' }), g.n ? h('span', { class: 'from', text: `(${g.n}번 문장)` }) : null])]))));
  }
  if (blanks.length) {
    root.appendChild(sec('빈칸 채우기', '지문에 나온 표현으로 채우세요'));
    root.appendChild(h('ol', { class: 'q' }, blanks.map((b) => h('li', {}, [h('div', { class: 'en', text: b.q }), b.n ? h('span', { class: 'from', text: `(${b.n}번 문장)` }) : null]))));
  }
  if (s.sentences.length) {
    root.appendChild(sec('해석 쓰기', '문장 구조를 생각하며 우리말로 옮기세요'));
    root.appendChild(h('ol', { class: 'q' }, s.sentences.map((x) => h('li', {}, [h('div', { class: 'en', text: x.en }), h('div', { class: 'lines' }, [h('i'), h('i')])]))));
  }

  // 정답
  const key = h('div', { class: 'key' });
  no = 0;
  key.appendChild(h('div', { class: 'top' }, [h('div', {}, [h('div', { class: 'ac', text: opts.academy || '' }), h('h1', { text: '정답과 해설' }), h('div', { class: 'src', text: s.title || '' })])]));
  if (s.vocab.length) {
    key.appendChild(sec('어휘 확인'));
    key.appendChild(h('table', {}, s.vocab.map((v, i) => h('tr', {}, [h('td', { class: 'k', text: String(i + 1) }), h('td', { style: "font-family:'Noto Serif',Georgia,serif", text: v.en }), h('td', { class: 'a', text: v.ko })]))));
  }
  if (grammar.length) {
    key.appendChild(sec('어법 선택'));
    key.appendChild(h('table', {}, grammar.map((g, i) => h('tr', {}, [h('td', { class: 'k', text: String(i + 1) }), h('td', {}, [h('span', { class: 'a', text: g.a || '' }), g.why ? h('div', { class: 'why', text: g.why }) : null])]))));
  }
  if (blanks.length) {
    key.appendChild(sec('빈칸 채우기'));
    key.appendChild(h('table', {}, blanks.map((b, i) => h('tr', {}, [h('td', { class: 'k', text: String(i + 1) }), h('td', { class: 'a', text: b.a || '' })]))));
  }
  if (s.sentences.length) {
    key.appendChild(sec('해석'));
    key.appendChild(h('table', {}, s.sentences.map((x) => h('tr', {}, [h('td', { class: 'k', text: String(x.n) }), h('td', { class: 'ko', text: x.ko })]))));
  }
  root.appendChild(key);
  host.appendChild(root);
  return (async () => {
    if (document.fonts) {
      const all = root.textContent;
      await Promise.race([
        Promise.all([document.fonts.load('500 14px "Pretendard Variable"', all), document.fonts.load('400 14px "Noto Serif"', 'Aa'), document.fonts.load('600 14px "Noto Serif"', 'Aa')].map((p) => p.catch(() => null))),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    }
    return root;
  })();
}

// 복습 노트 (선생님이 올린 강의를 AI가 요약한 것)
const CIRC = ['①', '②', '③', '④', '⑤'];
function mmss(x) {
  const t = Math.max(0, Math.floor(Number(x) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
export function renderStudy(host, data, opts = {}) {
  const sm = (data && data.summary) || {};
  const points = (sm.points || []).filter(Boolean);
  const chapters = (sm.chapters || []).filter((c) => c && c.title);
  const vocab = (sm.vocab || []).filter((v) => v && v.en);
  const quiz = (sm.quiz || []).filter((q) => q && q.q && (q.choices || []).length >= 2);
  if (!document.getElementById('pr-css')) document.head.appendChild(h('style', { id: 'pr-css', text: CSS }));
  const root = h('div', { class: 'pr' });
  root.appendChild(
    h('div', { class: 'top' }, [
      h('div', {}, [h('div', { class: 'ac', text: opts.academy || '' }), h('h1', { text: `${data.title || '강의'} · 복습 노트` }), h('div', { class: 'src', text: opts.header || data.source || '' })]),
      h('div', { class: 'who' }, [h('span', { text: '이름' }), h('span'), h('span', { text: '날짜' }), h('span')]),
    ]),
  );
  let no = 0;
  const sec = (title, hint) => h('h2', {}, [h('b', { text: String(++no) }), title, hint ? h('span', { class: 'hint', text: hint }) : null]);
  if (sm.one_line) {
    root.appendChild(sec('한 줄 요약'));
    root.appendChild(h('div', { class: 'one', text: sm.one_line }));
  }
  if (points.length) {
    root.appendChild(sec('핵심 정리'));
    root.appendChild(h('ul', { class: 'pt' }, points.map((x) => h('li', { text: x }))));
  }
  if (chapters.length) {
    root.appendChild(sec('강의 목차', '영상에서 다시 보고 싶은 곳을 찾아보세요'));
    root.appendChild(h('div', { class: 'toc' }, chapters.map((c) => h('div', {}, [h('span', { class: 't', text: mmss(c.t) }), h('span', { text: c.title })]))));
  }
  if (vocab.length) {
    root.appendChild(sec('어휘 확인', '우리말 뜻을 쓰세요'));
    root.appendChild(h('div', { class: 'voc' }, vocab.map((v, i) => h('div', {}, [h('span', { class: 'n', text: String(i + 1) }), h('span', { class: 'w', text: v.en }), h('span', { class: 'b' })]))));
  }
  if (quiz.length) {
    root.appendChild(sec('확인 문제'));
    root.appendChild(
      h('ol', { class: 'q' }, quiz.map((q) => h('li', {}, [h('div', { text: q.q }), h('div', { class: 'ch4' }, q.choices.map((c, i) => h('span', { text: `${CIRC[i] || i + 1} ${c}` })))]))),
    );
  }
  const key = h('div', { class: 'key' });
  no = 0;
  key.appendChild(h('div', { class: 'top' }, [h('div', {}, [h('div', { class: 'ac', text: opts.academy || '' }), h('h1', { text: '정답과 해설' }), h('div', { class: 'src', text: data.title || '' })])]));
  if (vocab.length) {
    key.appendChild(sec('어휘 확인'));
    key.appendChild(h('table', {}, vocab.map((v, i) => h('tr', {}, [h('td', { class: 'k', text: String(i + 1) }), h('td', { style: "font-family:'Noto Serif',Georgia,serif", text: v.en }), h('td', { class: 'a', text: v.ko || '' })]))));
  }
  if (quiz.length) {
    key.appendChild(sec('확인 문제'));
    key.appendChild(
      h('table', {}, quiz.map((q, i) => h('tr', {}, [h('td', { class: 'k', text: String(i + 1) }), h('td', {}, [h('span', { class: 'a', text: `${CIRC[q.answer] || Number(q.answer) + 1} ${q.choices[q.answer] || ''}` }), q.why ? h('div', { class: 'why', text: q.why }) : null])]))),
    );
  }
  if (vocab.length || quiz.length) root.appendChild(key);
  host.appendChild(root);
  return (async () => {
    if (document.fonts) {
      await Promise.race([
        Promise.all([document.fonts.load('500 14px "Pretendard Variable"', root.textContent), document.fonts.load('400 14px "Noto Serif"', 'Aa')].map((x) => x.catch(() => null))),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    }
    return root;
  })();
}
