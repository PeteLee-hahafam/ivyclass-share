// 인쇄 화면 (/print.html#번호): 시험지(A4 2단), 답안지, 정답과 해설을 종이 모양으로 늘어놓고 인쇄해요.
// #12 출력용 숙제지 12번, #q12 강의 12번의 확인 문제, #e12 시험 12번
// 문항이 단 끝에 걸리면 다음 단으로 넘기고, 단을 채우게 문항 사이를 고르게 벌려요.
const CIRC = ['①', '②', '③', '④', '⑤'];
const AREA = {
  vocab: '어휘', grammar: '어법', translate: '해석', content: '내용', variant: '변형', topic: '주제', title: '제목', gist: '요지', detail: '내용 일치',
  refer: '지칭', blank: '빈칸', order: '순서', insert: '문장 위치', irrelevant: '무관한 문장', summary: '요약문',
};
// 빠른 정답 표의 좁은 칸에 쓰는 짧은 이름
const AREA_SHORT = { detail: '일치', insert: '위치', irrelevant: '무관', summary: '요약', translate: '해석', content: '내용', variant: '변형' };
const SA_KIND = { word: '단어 쓰기', fix: '어법 고치기', form: '형태 바꾸기', blank: '빈칸 채우기', refer: '가리키는 말' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const markOnly = (c) => /^[①-⑤ⓐ-ⓔ]$/.test(String(c || '').trim());
const hangul = (s) => /[가-힣]/.test(String(s || ''));

// 문제 속 표기: __밑줄__, ①__번호 밑줄__, _____ 빈칸, (A) 표시, 줄바꿈
function mark(s) {
  let t = esc(s);
  t = t.replace(/_{5,}/g, '<span class="blank"></span>');
  t = t.replace(/([①-⑤ⓐ-ⓔ])__(.+?)__/g, '<span class="nu"><span class="mk">$1</span><u>$2</u></span>');
  t = t.replace(/__(.+?)__/g, '<u>$1</u>');
  t = t.replace(/\(([A-C])\)/g, '<b class="lab">($1)</b>');
  return t.replace(/\n/g, '<br>');
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ------------------------------------------------------------ 문항 블록
function stemHtml(q) {
  return `<div class="stem">${esc(q).replace(/(틀린|않는|없는|다른|적절하지 않은)(?= 것)/g, '<b>$1</b>')}</div>`;
}

function choicesHtml(it) {
  const ch = it.choices || [];
  if (!ch.length || ch.every(markOnly)) return '';
  const pairs = ch.every((c) => / – /.test(c));
  if (pairs) {
    const head = /\(A\)/.test(it.text || '') && /\(B\)/.test(it.text || '') ? '<tr><th></th><th>(A)</th><th></th><th>(B)</th></tr>' : '';
    return `<table class="pairs">${head}${ch.map((c, k) => { const [a, b] = c.split(' – '); return `<tr><td class="cn">${CIRC[k]}</td><td>${esc(a)}</td><td class="dots">……</td><td>${esc(b)}</td></tr>`; }).join('')}</table>`;
  }
  return `<ol class="ch" data-auto>${ch.map((c, k) => `<li><span class="cn">${CIRC[k]}</span><span class="ct">${esc(c)}</span></li>`).join('')}</ol>`;
}

function itemBlock(it, no) {
  const b = el('div', 'blk q');
  b.dataset.id = `q${no}`;
  const box = it.text ? `<div class="box">${mark(it.text)}</div>` : '';
  const cond = it.type === 'sa' && it.hint ? `<div class="cond"><b>〈조건〉</b>${esc(it.hint)}</div>` : '';
  b.innerHTML = `<span class="no">${no}.</span>${stemHtml(it.q)}${box}${it.type === 'mc' ? choicesHtml(it) : cond}`;
  return b;
}

function rightText(it) {
  if (it.type === 'sa') return it.kind === 'fix' ? `${it.mark} ${it.answer}` : it.answer;
  const c = it.choices[it.answer] || '';
  if (markOnly(c) || c.length > 18) return CIRC[it.answer];
  return `${CIRC[it.answer]} ${c}`;
}

function keyBlock(it, no) {
  const b = el('div', 'blk kq');
  b.dataset.id = `k${no}`;
  const acc = it.type === 'sa' && (it.accept || []).length ? ` (${it.accept.join(', ')}도 정답)` : '';
  const tag = it.type === 'sa' ? `서술형, ${SA_KIND[it.kind] || ''}` : AREA[it.area] || '객관식';
  b.innerHTML = `<span class="no">${no}</span><div class="kq-h"><span class="ka">${esc(rightText(it))}${esc(acc)}</span><span class="area">${esc(tag)}</span></div>
    <p>${esc(it.why || '')}</p>${it.ref ? `<p class="kr"><b>다시 볼 곳</b><span>${esc(it.ref)}</span></p>` : ''}`;
  return b;
}

// ------------------------------------------------------------ 쪽 나누기
function layoutChoices(root) {
  for (const ch of root.querySelectorAll('.ch[data-auto]')) {
    for (const k of ['c5', 'c3', 'c2', 'c1']) {
      ch.classList.remove('c5', 'c3', 'c2', 'c1');
      ch.classList.add(k);
      if (k === 'c1') break;
      if (![...ch.querySelectorAll('.ct')].some((t) => t.scrollWidth > t.clientWidth + 0.5)) break;
    }
  }
}

function fits(c) {
  const last = c.lastElementChild;
  return !last || last.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom + 0.5;
}

function flow(book, group, blocks, { first, running, footer, wm, maxGap = 34 }) {
  const pages = [];
  let cols = [];
  let ci = 0;
  const newPage = (one = false) => {
    const p = el('section', `page ${group}`);
    p.innerHTML = (pages.length ? running : first) + `<div class="cols${one ? ' one' : ''}"><div class="col"></div>${one ? '' : '<div class="col"></div>'}</div>` + footer + wm;
    book.appendChild(p);
    pages.push(p);
    cols = [...p.querySelectorAll('.col')];
    ci = 0;
  };
  const col = () => cols[ci];
  const next = () => {
    if (ci < cols.length - 1) ci++;
    else newPage();
  };
  const takeKeep = () => {
    const carry = [];
    while (col().lastElementChild && col().lastElementChild.classList.contains('keep')) carry.unshift(col().removeChild(col().lastElementChild));
    return carry;
  };
  newPage();
  for (const b of blocks) {
    const wasEmpty = !col().children.length;
    col().appendChild(b);
    layoutChoices(b);
    if (fits(col())) continue;
    if (!wasEmpty) {
      // 다음 단으로 (바로 앞의 영역 머리도 같이)
      col().removeChild(b);
      const carry = takeKeep();
      if (col().children.length) next();
      for (const c of carry) col().appendChild(c);
      col().appendChild(b);
      layoutChoices(b);
      if (fits(col())) continue;
    }
    // 빈 단에도 안 들어가면 글자를 조금 줄이고, 그래도 넘치면 그 문제만 한 쪽 전체 너비로
    b.classList.add('tight');
    layoutChoices(b);
    if (fits(col())) continue;
    col().removeChild(b);
    const carry = takeKeep();
    newPage(true);
    for (const c of carry) col().appendChild(c);
    col().appendChild(b);
    layoutChoices(b);
    newPage();
  }
  // 단을 채우게 문항 사이를 고르게 벌려요 (마지막 단은 그대로)
  const all = pages.flatMap((p) => [...p.querySelectorAll('.col')]);
  const used = all.filter((c) => c.children.length);
  const last = used[used.length - 1];
  for (const c of all) {
    if (c === last || c.children.length < 2) continue;
    const kids = [...c.children];
    const free = c.getBoundingClientRect().bottom - kids[kids.length - 1].getBoundingClientRect().bottom;
    const gaps = kids.slice(0, -1).filter((k) => !k.classList.contains('keep'));
    if (free <= 1 || !gaps.length) continue;
    const add = Math.min(free / gaps.length, maxGap);
    for (const k of gaps) k.style.marginBottom = `${(parseFloat(getComputedStyle(k).marginBottom) || 0) + add}px`;
  }
  // 빈 쪽은 지워요 (한 쪽 전체 너비 문제 뒤에 남은 쪽)
  for (const p of pages.slice()) {
    if (![...p.querySelectorAll('.col')].some((c) => c.children.length) && pages.length > 1) {
      p.remove();
      pages.splice(pages.indexOf(p), 1);
    }
  }
  pages.forEach((p, i) => (p.querySelector('.pg').textContent = `${i + 1} / ${pages.length}`));
  return pages;
}

// ------------------------------------------------------------ 화면 만들기
function docUrl(hash) {
  const m = /^(e|q)?(\d+)$/.exec(hash);
  if (!m) return null;
  if (m[1] === 'e') return `/api/admin/exams/${m[2]}/print`;
  if (m[1] === 'q') return `/api/admin/lectures/${m[2]}/quiz/print`;
  return `/api/admin/prints/${m[2]}`;
}

async function main() {
  const from = docUrl(location.hash.slice(1));
  if (!from) return say('인쇄할 시험지 번호가 없어요. 강의 화면에서 다시 열어 주세요.');
  let d;
  try {
    const res = await fetch(from, { credentials: 'same-origin' });
    d = await res.json();
    if (!res.ok) return say(res.status === 401 ? '선생님으로 로그인한 다음 다시 열어 주세요.' : d.error || '시험지를 열 수 없어요.');
  } catch {
    return say('인터넷 연결을 확인해 주세요.');
  }
  // 문서: 제목(강의나 시험 이름), 이름표(숙제지 3, 확인 문제, 시험지), 저작권 줄에 쓸 이름(숙제지, 시험지)
  const doc = d.doc || { title: (d.lecture && d.lecture.title) || '숙제', label: `숙제지 ${d.print.no}`, what: '숙제지', kicker: (d.lecture && d.lecture.source) || '', date: d.print.created_at, items: d.print.items };
  const items = doc.items || [];
  const lec = { title: doc.title };
  const tag = esc(doc.label);
  const ac = d.academy || {};
  const date = new Date((doc.date || Date.now() / 1000) * 1000);
  const ymd = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  document.title = doc.file || `${doc.title} ${doc.label}`;
  $('bar-title').textContent = `${doc.title}, ${doc.label}`;

  const logo = ac.logo ? `<img class="hd-logo" src="${esc(ac.logo)}" alt="">` : '';
  const wm = ac.logo ? `<img class="wm" src="${esc(ac.logo)}" alt="">` : '';
  const acad = `<div class="hd-acad"><b>${esc(ac.name || '')}</b>${ac.phone ? `문의 ${esc(ac.phone)}` : ''}</div>`;
  const kicker = esc(d.doc && doc.kind === 'exam' ? doc.kicker || '' : doc.kicker || ac.name || '');
  const who = `<table class="who"><colgroup><col style="width:14mm"><col style="width:22mm"><col style="width:14mm"><col style="width:22mm"><col style="width:14mm"><col></colgroup>
    <tr><th>반</th><td></td><th>번호</th><td></td><th>이름</th><td></td></tr></table>`;
  const mc = items.filter((x) => x.type === 'mc');
  const sa = items.filter((x) => x.type === 'sa');
  const footer = (what) => `<footer class="foot"><span class="l">이 ${what}의 저작권은 ${esc(ac.name || '학원')}에 있으며, 무단 복제와 배포를 금합니다.</span><span class="pg"></span><span class="r">${esc(ac.name || '')}${ac.phone ? ` &nbsp;${esc(ac.phone)}` : ''}</span></footer>`;
  const book = $('book');
  const label = (t, g) => {
    const x = el('div', `group-label ${g}`, t);
    book.appendChild(x);
  };

  // 1) 시험지
  label('시험지 (학생에게 나눠 줄 것)', 'g-exam');
  const first = `<header class="hd"><div class="hd-row">${logo}<div class="hd-main"><div class="hd-kicker">${kicker}</div>
      <div class="hd-title">${esc(lec.title)}</div><div class="hd-sub">${tag} &nbsp;|&nbsp; ${ymd}</div></div>${acad}</div>${who}
    <div class="notice"><b>유의 사항</b><ol>
      <li>모두 ${items.length}문항(객관식 ${mc.length}${sa.length ? `, 서술형 ${sa.length}` : ''})입니다. 답은 마지막 쪽 <b>답안지</b>에 씁니다.</li>
      <li>객관식은 가장 알맞은 답을 하나만 골라 번호를 쓰고, 서술형은 영어로 씁니다. 철자가 틀리면 정답으로 인정하지 않습니다.</li>
    </ol></div></header>`;
  const running = `<header class="rh"><span>${esc(lec.title)} &nbsp;|&nbsp; ${tag}</span><span class="nm">이름<i></i></span></header>`;
  const blocks = [];
  if (mc.length) blocks.push(el('div', 'blk sec keep', `<span class="st">객관식</span><span class="sr">1~${mc.length}번</span>`));
  items.forEach((it, i) => {
    if (it.type === 'sa' && i === mc.length) {
      blocks.push(el('div', 'blk sec keep', `<span class="st">서술형</span><span class="sr">${mc.length + 1}~${items.length}번</span>`));
      blocks.push(el('div', 'blk sec-note keep', '영작 문제는 없습니다. 답은 본문에 나온 영어 단어나 짧은 말로 답안지에 씁니다.'));
    }
    blocks.push(itemBlock(it, i + 1));
  });
  blocks.push(el('div', 'blk endnote', '<b>※ 확인 사항</b>문제는 여기까지입니다. 답안지에 답을 빠짐없이 옮겨 적었는지, 서술형 답의 철자가 맞는지 다시 확인하시오.'));
  const keyRunning = `<header class="rh"><span>${esc(lec.title)} &nbsp;|&nbsp; ${tag} 정답과 해설</span><span></span></header>`;
  const kblocks = [];
  if (mc.length) kblocks.push(el('div', 'blk sec keep', '<span class="st">객관식 해설</span>'));
  items.forEach((it, i) => {
    if (it.type === 'sa' && i === mc.length) kblocks.push(el('div', 'blk sec keep', '<span class="st">서술형 해설</span>'));
    kblocks.push(keyBlock(it, i + 1));
  });
  const nums = mc.map((_, i) => `<th>${i + 1}</th>`).join('');
  const anss = mc.map((it) => `<td>${CIRC[it.answer]}</td>`).join('');
  const ars = mc.map((it) => `<td class="ar">${esc(AREA_SHORT[it.area] || AREA[it.area] || '')}</td>`).join('');
  const saTable = sa.length
    ? `<table class="qk sa"><tr><th>번호</th>${sa.map((_, j) => `<th>${mc.length + j + 1}</th>`).join('')}</tr><tr><th>정답</th>${sa.map((it) => `<td>${esc(rightText(it))}</td>`).join('')}</tr></table>`
    : '';
  const keyFirst = `<header class="hd"><div class="hd-row">${logo}<div class="hd-main"><div class="hd-kicker">${kicker}</div><div class="hd-title">정답과 해설</div>
      <div class="hd-sub">${esc(lec.title)} &nbsp;|&nbsp; ${tag} &nbsp;|&nbsp; ${ymd}</div></div>${acad}</div>
    <div class="qk-wrap"><div class="qk-t">빠른 정답</div>
      ${mc.length ? `<table class="qk"><tr><th>번호</th>${nums}</tr><tr><th>정답</th>${anss}</tr><tr><th>유형</th>${ars}</tr></table>` : ''}${saTable}
      <div class="qk-t" style="font-weight:600;font-size:8.2pt;color:var(--mid)">서술형은 철자가 정확해야 정답이고, 대문자와 소문자는 따지지 않습니다. 어법 고치기는 기호와 고친 말이 둘 다 맞아야 정답입니다.</div></div></header>`;
  const src = $('src');
  blocks.concat(kblocks).forEach((b) => src.appendChild(b));
  // 글꼴은 글자 묶음마다 따로 받아요. 쓰인 글자를 모두 미리 받아 두어야 잰 높이가 인쇄할 때와 같아요
  const heads = el('div', '', first + running + keyFirst + keyRunning + footer(doc.what || '숙제지') + footer('자료'));
  src.appendChild(heads);
  await loadFonts(`${src.textContent}답안지 객관식 서술형 채점 합계 선생님 확인 기호 고친 말 고른 답의 번호를 쓰시오 영어로 철자가 틀리면 정답으로 인정하지 않습니다 맞힌 문항 수를 적습니다 반, 번호, 이름을 썼는지 확인하고 답안지를 내시오 ~/0123456789`);
  heads.remove();
  flow(book, 'g-exam', blocks, { first, running, footer: footer(doc.what || '숙제지'), wm });

  // 2) 답안지
  label('답안지', 'g-exam');
  const rows = [];
  for (let a = 1; a <= mc.length; a += 10) {
    const nums = [];
    for (let n = a; n < a + 10; n++) nums.push(n <= mc.length ? n : '');
    rows.push(`<tr>${nums.map((n) => `<th>${n}</th>`).join('')}</tr><tr>${nums.map((n) => (n ? '<td></td>' : '<td style="background:var(--fill2)"></td>')).join('')}</tr>`);
  }
  const saRows = sa.map((it, j) => `<div class="sa-row"><span class="n">${mc.length + j + 1}</span>${it.kind === 'fix' ? '<span class="lab">기호</span><span class="w s"></span><span class="lab">고친 말</span><span class="w"></span>' : '<span class="w"></span>'}</div>`).join('');
  const sheet = el('section', 'page g-exam');
  sheet.innerHTML = `<header class="hd"><div class="hd-row">${logo}<div class="hd-main"><div class="hd-kicker">${kicker}</div><div class="hd-title">답안지</div>
      <div class="hd-sub">${esc(lec.title)} &nbsp;|&nbsp; ${tag}</div></div>${acad}</div>${who}</header>
    <div class="sheet-body">
      ${mc.length ? `<div class="sh-t"><b>객관식</b><span>1~${mc.length}번, 고른 답의 번호(①~⑤)를 쓰시오.</span></div><table class="sh-mc">${rows.join('')}</table>` : ''}
      ${sa.length ? `<div class="sh-t"><b>서술형</b><span>${mc.length + 1}~${items.length}번, 영어로 쓰시오. 철자가 틀리면 정답으로 인정하지 않습니다.</span></div><div class="sh-sa">${saRows}</div>` : ''}
      <div class="sh-t"><b>채점</b><span>맞힌 문항 수를 적습니다.</span></div>
      <table class="sh-score"><tr><th>객관식</th>${sa.length ? '<th>서술형</th>' : ''}<th>합계</th><th>선생님 확인</th></tr>
        <tr><td>/ ${mc.length}</td>${sa.length ? `<td>/ ${sa.length}</td>` : ''}<td>/ ${items.length}</td><td></td></tr></table>
      <div class="sh-end">반, 번호, 이름을 썼는지 확인하고 답안지를 내시오.</div>
    </div>${footer(doc.what || '숙제지')}${wm}`;
  sheet.querySelector('.pg').textContent = '답안지';
  book.appendChild(sheet);

  // 3) 정답과 해설
  label('정답과 해설 (선생님용)', 'g-key');
  flow(book, 'g-key', kblocks, { first: keyFirst, running: keyRunning, footer: footer('자료'), wm, maxGap: 22 });
  fitScreen();
  window.addEventListener('resize', fitScreen);

  say(`시험지와 답안지를 인쇄해 학생에게 나눠 주고, 정답과 해설은 따로 인쇄하세요. 인쇄 창에서 용지는 A4, 여백은 '없음'이나 '기본값'으로 두면 됩니다.`);
  // 인쇄할 묶음의 마지막 쪽 뒤에는 쪽을 넘기지 않아요 (빈 종이가 나오지 않게)
  const lastOf = (what) => {
    for (const p of document.querySelectorAll('.page.last')) p.classList.remove('last');
    const ps = document.querySelectorAll(what ? `.page.g-${what}` : '.page');
    if (ps.length) ps[ps.length - 1].classList.add('last');
  };
  lastOf('');
  const go = (what) => {
    document.body.dataset.print = what;
    lastOf(what);
    setTimeout(() => window.print(), 50);
  };
  $('print-exam').disabled = false;
  $('print-key').disabled = false;
  $('print-exam').onclick = () => go('exam');
  $('print-key').onclick = () => go('key');
  window.addEventListener('afterprint', () => {
    delete document.body.dataset.print;
    lastOf('');
  });
  window.__ready = true;
}

// 좁은 화면: 쪽을 다시 나누지 않고 통째로 줄여서 보여 줘요 (글자 크기를 줄이면 줄바꿈이 달라져 인쇄와 어긋나요)
function fitScreen() {
  const book = $('book');
  const page = book.querySelector('.page');
  if (!page) return;
  book.classList.remove('fit');
  book.style.cssText = '';
  const w = page.offsetWidth;
  const room = document.documentElement.clientWidth - 16;
  if (room >= w) return;
  const k = room / w;
  book.classList.add('fit');
  book.style.width = `${w}px`;
  book.style.marginLeft = '8px';
  book.style.transform = `scale(${k})`;
  book.style.marginBottom = `${-book.offsetHeight * (1 - k)}px`;
}

const FONTS = ['400 10pt "Noto Serif P"', '600 10pt "Noto Serif P"', '700 10pt "Noto Serif P"', 'italic 400 10pt "Noto Serif P"', '500 10pt "Noto Serif KR Variable"', '700 10pt "Pretendard Variable"'];
async function loadFonts(text) {
  const t = [...new Set(String(text).replace(/\s+/g, ''))].join('') + 'Aa①②③④⑤';
  await Promise.all(FONTS.map((f) => document.fonts.load(f, t))).catch(() => {});
  await document.fonts.ready;
}

function say(t) {
  $('msg').textContent = t;
}

main();
