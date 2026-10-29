// 영어 레벨테스트 학생 화면 (/lt)
// 서버가 한 블록(어휘 4낱말, 나머지 3문항)씩 문제를 주고, 답을 받아 채점한 뒤 다음 블록을 정해요.
// 정답은 이 화면에 오지 않아요. 블록 안에서 푼 데까지는 이 기기에 적어 두어서, 새로 고쳐도 이어서 풀어요.
import { LT_PICS } from './pics.js';

const MARK = ['①', '②', '③', '④', '⑤'];
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const brand = $('#brand');
const TOKEN = 'ivy.lt.token';
const PART = 'ivy.lt.part';

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 저장이 막힌 기기에서는 이 창을 닫으면 처음부터 봐요 */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 무시 */
    }
  },
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isEn = (t) => typeof t === 'string' && /[A-Za-z]/.test(t) && !/[가-힣]/.test(t);
const words = (s) => String(s || '').split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
function given(name) {
  const n = String(name || '').trim();
  return n.length === 3 && /^[가-힣]+$/.test(n) ? n.slice(1) : n;
}
function richText(t) {
  return esc(t)
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\{A\}/g, '<span class="blank">(A)</span>')
    .replace(/\{_\}/g, '<span class="blank long"></span>')
    .replace(/\(\s*([①②③④⑤])\s*\)/g, '<span class="ins">( $1 )</span>')
    .replace(/\n/g, '<br>');
}
function gramText(t) {
  return esc(t)
    .replace(/\{([1-5]):([^}]+)\}/g, (m, n, w) => `<span class="gm"><sup>${MARK[n - 1]}</sup><u>${w}</u></span>`)
    .replace(/___/g, '<span class="blank"></span>');
}

const S = {
  phase: 'loading', // loading, fatal, closed, form, resume, intro, audio-ready, audio, item, sending, send-fail, done
  info: null,
  view: null,
  token: store.get(TOKEN),
  form: { name: '', grade: 0, school: '', years: '1to2', phone: '', consent: false },
  bad: {},
  busy: false,
  err: '',
  cur: null,
  sel: null,
  built: [],
  text: '',
  t0: 0,
  locked: false,
  skipAsk: false,
  audioTok: 0,
  audioPlay: 1,
};

// ---------------------------------------------------------------- 서버
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Ivy': '1' };
  if (S.token) headers['X-LT-Token'] = S.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error('인터넷 연결을 확인해 주세요.'), { code: 'net' });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || '잠시 뒤에 다시 해 주세요.'), { code: (data && data.code) || 'http', status: res.status });
  return data;
}

function toast(t) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// ---------------------------------------------------------------- 블록 진행
const block = () => S.view && S.view.block;
const curMod = () => (S.view && S.view.mods[S.view.mi] ? S.view.mods[S.view.mi] : null);

function savePart() {
  const c = S.cur;
  if (!c) return;
  store.set(PART, JSON.stringify({ mod: c.mod, key: c.key, tier: c.tier, no: c.no, i: c.i, answers: c.answers, times: c.times, wans: c.wans, wtimes: c.wtimes }));
}
function readPart() {
  try {
    return JSON.parse(store.get(PART) || 'null');
  } catch {
    return null;
  }
}

function loadBlock() {
  const b = block();
  const no = S.view.blockNo;
  const p = readPart();
  const same = p && p.mod === b.mod && p.key === (b.key == null ? null : b.key) && p.tier === (b.tier == null ? null : b.tier) && p.no === no && p.i < b.items.length;
  S.cur = {
    mod: b.mod,
    key: b.key == null ? null : b.key,
    tier: b.tier == null ? null : b.tier,
    no,
    items: b.items,
    set: !!b.set,
    i: same ? p.i : 0,
    answers: same ? p.answers || [] : [],
    times: same ? p.times || [] : [],
    wans: same ? p.wans || {} : {},
    wtimes: same ? p.wtimes || {} : {},
    heard: false,
  };
  beginItem();
}

function beginItem() {
  const c = S.cur;
  const it = c.items[c.i];
  S.sel = null;
  S.locked = false;
  S.built = [];
  S.text = c.mod === 'write' ? c.wans[it.id] || '' : '';
  S.skipAsk = false;
  // 듣기: 문항마다(묶음 듣기는 처음 한 번) 학생이 '듣기 시작'을 눌러 들어요
  if (c.mod === 'listen' && (!c.set || c.i === 0 || !c.heard)) {
    S.phase = 'audio-ready';
    return;
  }
  S.phase = 'item';
  S.t0 = performance.now();
}

function itemValue(c, it) {
  if (it.kind === 'spell') return S.built.join('');
  if (it.kind === 'order') return S.built.join(' ');
  return S.text;
}

function submitItem(timedOut) {
  const c = S.cur;
  if (!c || S.phase !== 'item') return;
  const it = c.items[c.i];
  const ms = Math.min(it.limit * 1000, Math.round(performance.now() - S.t0));
  if (c.mod === 'write') {
    c.wans[it.id] = itemValue(c, it);
    c.wtimes[it.id] = ms;
  } else {
    c.answers.push(S.sel != null ? S.sel : timedOut ? -2 : -1);
    c.times.push(ms);
  }
  c.i++;
  savePart();
  if (c.i < c.items.length) {
    beginItem();
    render();
    const z = $('#qzone') || $('.listen');
    if (z && z.getBoundingClientRect().top < 0) z.scrollIntoView({ block: 'start' });
  } else sendBlock();
}

async function sendBlock() {
  const c = S.cur;
  S.phase = 'sending';
  render();
  try {
    const r = c.mod === 'write'
      ? await api('/api/lt/write', { method: 'POST', body: { answers: c.wans, times: c.wtimes } })
      : await api('/api/lt/block', { method: 'POST', body: { mod: c.mod, key: c.key, answers: c.answers, times: c.times } });
    store.del(PART);
    afterView(r.view, c.mod);
  } catch (e) {
    if (e.code === 'lt_stale' || e.code === 'lt_bad') {
      // 화면과 서버가 어긋났어요: 서버에 있는 데부터 다시
      store.del(PART);
      try {
        const r = await api('/api/lt/me');
        afterView(r.view, null);
      } catch (e2) {
        failSend(e2);
      }
    } else if (e.code === 'lt_gone') {
      store.del(TOKEN);
      store.del(PART);
      S.token = null;
      S.phase = 'fatal';
      S.err = e.message;
    } else failSend(e);
  }
  render();
  window.scrollTo({ top: 0 });
}
function failSend(e) {
  S.phase = 'send-fail';
  S.err = e.message;
}
function afterView(view, prevMod) {
  S.view = view;
  if (view.done) {
    S.phase = 'done';
    store.del(PART);
  } else if (!prevMod || view.block.mod !== prevMod) S.phase = 'intro';
  else loadBlock();
}

function timeout() {
  if (S.locked || S.phase !== 'item') return;
  S.locked = true;
  const z = $('#qzone');
  if (z) z.classList.add('locked');
  const tu = $('#timeup');
  if (tu) tu.hidden = false;
  const c = S.cur;
  setTimeout(() => {
    if (S.cur === c && S.locked && S.phase === 'item') submitItem(true);
  }, 900);
}

// ---------------------------------------------------------------- 듣기 소리 (기기에 있는 영어 목소리로 읽어요)
function pickVoices() {
  const syn = window.speechSynthesis;
  const vs = syn ? syn.getVoices().filter((v) => /^en[-_]/i.test(v.lang)) : [];
  const us = vs.filter((v) => /en[-_]US/i.test(v.lang));
  const pool = us.length >= 2 ? us : vs;
  const male = pool.find((v) => /male|david|alex|daniel|fred|guy|mark|james|tom|aaron|arthur|ryan|eric|davis|andrew|brian|christopher/i.test(v.name) && !/female/i.test(v.name));
  const female = pool.find((v) => /female|zira|samantha|karen|victoria|susan|jenny|aria|serena|moira|tessa|sonia|libby|ava|allison|emma|michelle|google us english/i.test(v.name));
  return { male: male || pool[0], female: female || pool[1] || pool[0], any: vs.length };
}
const canSpeak = () => !!(window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');

function playAudio(lines, plays, rate, onPlay, done) {
  const syn = window.speechSynthesis;
  let finished = false;
  const count = lines.reduce((a, l) => a + String(l[1]).split(/\s+/).length, 0);
  const est = (count / (2.3 * rate) + lines.length * 0.5) * 1000 * plays + 2000 * plays;
  const end = () => {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    setTimeout(done, 400);
  };
  const guard = setTimeout(() => {
    try {
      syn.cancel();
    } catch {
      /* 무시 */
    }
    end();
  }, est + 8000);
  const go = () => {
    const V = pickVoices();
    let p = 1;
    let i = 0;
    try {
      syn.cancel();
    } catch {
      /* 무시 */
    }
    const next = () => {
      if (finished) return;
      if (i >= lines.length) {
        if (p < plays) {
          p++;
          i = 0;
          onPlay(p);
          setTimeout(next, 1200);
          return;
        }
        end();
        return;
      }
      const [who, text] = lines[i++];
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      const v = who === 'M' ? V.male : V.female;
      if (v) u.voice = v;
      if (!v || V.male === V.female) u.pitch = who === 'M' ? 0.75 : who === 'W' ? 1.25 : 1;
      u.onend = () => setTimeout(next, 300);
      u.onerror = () => setTimeout(next, 100);
      syn.speak(u);
    };
    next();
  };
  if (syn.getVoices().length) go();
  else {
    let started = false;
    const once = () => {
      if (!started) {
        started = true;
        go();
      }
    };
    syn.addEventListener('voiceschanged', once, { once: true });
    setTimeout(once, 800);
  }
}
function stopAudio() {
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch {
    /* 무시 */
  }
}

function startAudio() {
  const c = S.cur;
  const b = block();
  const it = c.items[c.i];
  const lines = c.set ? b.audio : it.say;
  if (!lines || !lines.length || !canSpeak()) {
    S.skipAsk = true;
    render();
    return;
  }
  S.phase = 'audio';
  S.audioPlay = 1;
  const tok = ++S.audioTok;
  render();
  playAudio(lines, c.set ? b.plays || 1 : b.plays || 2, b.rate || 1, (n) => {
    if (S.audioTok !== tok) return;
    S.audioPlay = n;
    const el = $('#aplay');
    if (el) el.textContent = `${n}번째 듣는 중`;
  }, () => {
    if (S.audioTok !== tok || S.phase !== 'audio') return;
    c.heard = true;
    S.phase = 'item';
    S.t0 = performance.now();
    render();
  });
}

async function skipListen() {
  stopAudio();
  S.audioTok++;
  S.phase = 'sending';
  render();
  try {
    const r = await api('/api/lt/skip', { method: 'POST', body: { mod: 'listen' } });
    store.del(PART);
    afterView(r.view, 'listen');
  } catch (e) {
    failSend(e);
  }
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- 화면
function renderBrand() {
  const i = S.info || {};
  const tel = i.phone ? `<a class="brand-tel" href="tel:${esc(i.phone.replace(/[^0-9]/g, ''))}"><span class="lbl">문의 </span><b>${esc(i.phone)}</b></a>` : '';
  brand.innerHTML = `${i.logo ? `<img class="brand-logo" src="${esc(i.logo)}" alt="${esc(i.academy || '')} 로고">` : ''}<div class="brand-t"><small>${esc(i.academy || '')}</small><b>영어 레벨테스트</b></div>${tel}`;
  document.title = i.academy ? `영어 레벨테스트, ${i.academy}` : '영어 레벨테스트';
}

function telLine(cls) {
  const p = S.info && S.info.phone;
  return p ? `<p class="${cls}">궁금한 점은 학원(<a href="tel:${esc(p.replace(/[^0-9]/g, ''))}">${esc(p)}</a>)으로 물어봐 주세요.</p>` : '';
}

function viewFatal() {
  return `<div class="card finish"><h2>화면을 열지 못했어요</h2><p class="muted">${esc(S.err || '잠시 뒤에 다시 열어 주세요.')}</p><button type="button" class="btn primary" data-act="reload">다시 열기</button>${telLine('fin-tel')}</div>`;
}

function viewClosed() {
  return `<div class="card finish"><h2>지금은 레벨테스트를 받지 않아요</h2><p class="muted">시험을 보고 싶으시면 학원에 물어봐 주세요.</p>${telLine('fin-tel')}</div>`;
}

function estMins(mods) {
  return [mods.reduce((a, m) => a + m.mins[0], 0), mods.reduce((a, m) => a + m.mins[1], 0)];
}

function viewForm() {
  const i = S.info;
  const f = S.form;
  const [m1, m2] = estMins(i.mods);
  const bad = (k) => (S.bad[k] ? ' bad' : '');
  const hasVoc = i.mods.some((m) => m.key === 'voc');
  const steps = [
    hasVoc ? '<li><b>어휘부터 짧게</b><span>낱말 뜻 고르기로 아는 낱말 수를 짐작하고, 그 결과로 다른 영역의 첫 단계를 맞춰요.</span></li>' : '',
    '<li><b>영역마다 계단식</b><span>한 단계에 3문항이에요. 2개 이상 맞히면 위 단계로, 못 하면 아래 단계로 가고, 막히는 곳에서 그 영역이 끝나요.</span></li>',
    "<li><b>문항마다 제한 시간</b><span>시간이 끝나면 다음 문항으로 넘어가요. 모르는 문제는 '잘 모르겠어요'를 눌러도 돼요.</span></li>",
    '<li><b>결과는 리포트로</b><span>선생님이 결과를 확인한 뒤 학부모님께 리포트(PDF)로 보내 드려요.</span></li>',
  ].join('');
  return `${i.teacher ? '<div class="banner"><span><b>선생님 계정</b>으로 열었어요. 학생 화면을 미리 볼 수 있고, 본 기록은 레벨테스트 결과 목록에 남아요.</span></div>' : ''}
  ${S.err ? `<div class="banner err" role="alert">${esc(S.err)}</div>` : ''}
  <div class="info-grid">
    <form class="card form" id="f-info" novalidate>
      <h2>시험을 볼 학생을 알려 주세요</h2>
      <p class="lead">${i.me ? '강의실에 로그인한 정보로 채웠어요. 다르면 고쳐 주세요.' : '학부모님이 함께 적어 주세요.'}</p>
      <div class="fields">
        <div class="field${bad('name')}"><label for="f-name">학생 이름</label><input id="f-name" data-f="name" value="${esc(f.name)}" autocomplete="off" maxlength="20"></div>
        <div class="field${bad('grade')}"><label for="f-grade">학년</label><select id="f-grade" data-f="grade"><option value="0">고르세요</option>${i.grades.map((g) => `<option value="${g.lv}" ${f.grade === g.lv ? 'selected' : ''}>${esc(g.short)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-school">학교 <small>안 써도 돼요</small></label><input id="f-school" data-f="school" value="${esc(f.school)}" placeholder="예: 일산중학교" autocomplete="off" maxlength="40"></div>
        <div class="field"><label for="f-years">영어를 배운 기간</label><select id="f-years" data-f="years">${i.years.map((y) => `<option value="${y.key}" ${f.years === y.key ? 'selected' : ''}>${esc(y.label)}</option>`).join('')}</select></div>
        <div class="field full"><label for="f-phone">학부모님 휴대폰 <small>안 써도 돼요</small></label><input id="f-phone" data-f="phone" value="${esc(f.phone)}" inputmode="tel" autocomplete="off" maxlength="20" placeholder="010-0000-0000"><small>결과 리포트를 받을 번호예요.</small></div>
      </div>
      <div class="consent${bad('consent')}">
        <label class="ck"><input type="checkbox" id="f-consent" data-f="consent" ${f.consent ? 'checked' : ''}><span>학부모입니다. 아래 내용으로 개인정보 수집과 이용에 동의해요.</span></label>
        <details><summary>무엇을 왜 받는지 보기</summary>
          <dl><dt>받는 정보</dt><dd>학생 이름, 학년, 학교, 영어를 배운 기간, 학부모님 휴대폰 번호, 시험 답과 글쓰기</dd>
          <dt>쓰는 곳</dt><dd>레벨테스트 결과 안내와 상담</dd>
          <dt>보관</dt><dd>${esc(i.academy)} 강의실에만 보관하고, 학원에 등록하지 않으면 6개월 뒤 지워요</dd>
          <dt>만 14세 미만</dt><dd>학부모님이 직접 동의해 주셔야 해요</dd></dl>
        </details>
      </div>
      <div class="modline"><span class="lb">볼 영역</span>
        <div class="mods">${i.mods.map((m) => `<span class="mod"><b>${esc(m.name)}</b><small>${m.mins[0]}~${m.mins[1]}분</small></span>`).join('')}</div>
        <p class="est">모두 <b>약 ${m1}~${m2}분</b> 걸려요. 조용한 곳에서 혼자 풀어 주세요.</p>
      </div>
      <button class="btn primary block" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? '시작하는 중…' : '시험 시작하기'}</button>
    </form>
    <div class="how">
      <h2>이렇게 진행돼요</h2>
      <ol>${steps}</ol>
      <p class="tip">중간에 창을 닫아도 같은 기기에서 이 링크를 다시 열면 이어서 볼 수 있어요. 사전이나 번역기는 쓰지 않아요.</p>
      ${telLine('how-tel')}
    </div>
  </div>`;
}

function viewResume() {
  const v = S.view;
  const m = curMod();
  return `<div class="card intro">
    <h2>보던 시험이 있어요</h2>
    <p class="muted" style="margin:0">${esc(v.student.name)} 학생이 보던 시험이에요. ${m ? `${esc(m.name)} 영역부터 이어서 볼 수 있어요.` : ''}</p>
    <div class="actions"><button type="button" class="btn primary" data-act="resume">이어서 보기</button><button type="button" class="link" data-act="new">다른 학생이 새로 보기</button></div>
  </div>`;
}

function secBar() {
  const v = S.view;
  const c = S.cur;
  const m = curMod();
  const chips = v.mods.map((x) => `<span class="${x.state === 'done' ? 'done' : x.state === 'skip' ? 'skip' : x.state === 'now' ? 'now' : ''}">${esc(x.name)}</span>`).join('');
  let n = '';
  if (c && S.phase !== 'intro') n = c.mod === 'write' ? `${c.i + 1} / ${c.items.length}` : `${(v.blockNo - 1) * c.items.length + c.i + 1}번째 문항`;
  return `<div class="secbar"><h2>${esc(m ? m.name : '')}</h2><div class="mods-mini" aria-label="영역 진행">${chips}</div><span class="cnt">${n}</span></div>`;
}

const INTRO = {
  voc: ['낱말을 보고 알맞은 뜻을 고르세요.', "한 낱말에 10~15초예요. 모르면 바로 '잘 모르겠어요'를 누르세요."],
  gram: ['빈칸에 알맞은 말이나 어법상 틀린 곳을 고르세요.', '한 문항에 25~60초예요.'],
  read: ['지문을 읽고 문제 3개를 하나씩 풀어요.', '첫 문제 시간에는 지문 읽는 시간이 들어 있어요. 지문은 문제를 푸는 동안 계속 보여요.'],
  listen: ['영어를 듣고 문제를 풀어요. 이어폰을 끼거나 소리를 키워 주세요.', "'듣기 시작'을 누르면 들려줘요. 초등 단계는 두 번, 중등부터는 한 번 들려주고, 듣기가 끝나면 문제마다 시간이 시작돼요."],
  write: ['영어로 문장과 글을 써요.', '문장 맞추기는 1분 안팎, 조건 영작은 2분, 짧은 글은 6~10분이에요. 시간이 끝나면 쓴 데까지 제출돼요.'],
};

function viewIntro() {
  const v = S.view;
  const m = curMod();
  const key = m.key;
  const info = INTRO[key] || ['', ''];
  const hi = v.mi === 0 ? `<p style="margin:-8px 0 0;font-weight:700;color:var(--board)">${esc(given(v.student.name))} 학생, 시작해 볼까요?</p>` : '';
  const noSound = key === 'listen' && !canSpeak();
  return `${secBar()}
  <div class="card intro">
    <h2>${esc(m.name)}</h2>${hi}
    <ul><li>${info[0]}</li><li>${info[1]}</li><li>지나간 문항으로는 돌아갈 수 없어요.</li></ul>
    ${noSound ? '<div class="banner err">이 기기에서는 영어 소리를 낼 수 없어요. 다른 기기로 보거나 듣기를 건너뛰어 주세요.</div>' : ''}
    <div class="actions">
      <button type="button" class="btn primary" data-act="begin">${esc(m.name)} 시작</button>
      ${key === 'listen' ? '<button type="button" class="link" data-act="skip-ask">듣기를 건너뛸래요</button>' : ''}
    </div>
    ${S.skipAsk ? skipBox() : ''}
  </div>`;
}

function skipBox() {
  return `<div class="banner" role="alert"><span>듣기를 건너뛰면 결과에서 듣기가 빠져요. 건너뛸까요?</span><button type="button" class="btn" data-act="skip-listen">듣기 건너뛰기</button><button type="button" class="link" data-act="skip-no">그냥 볼래요</button></div>`;
}

function viewAudio() {
  const c = S.cur;
  const playing = S.phase === 'audio';
  const prev = c.set && c.i === 0 && (c.key || 0) <= 6 ? `<div class="preview"><b>먼저 문제를 읽어 두세요</b>${c.items.map((x, k) => `<span>${k + 1}. ${esc(x.q)}</span>`).join('')}</div>` : '';
  const again = c.set && c.i > 0 ? '<p class="muted">새로 고쳐서 한 번 더 들려줘요.</p>' : '';
  return `${secBar()}
  <div class="card listen">
    <div class="eq${playing ? '' : ' stop'}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    ${playing ? `<p><b>잘 들어 보세요</b></p><p class="muted" id="aplay">${S.audioPlay}번째 듣는 중</p>` : `<p><b>${c.set ? '대화를 듣고 문제 3개를 풀어요' : '듣고 알맞은 답을 고르세요'}</b></p>${again}`}
    ${prev}
    ${playing ? '' : '<button type="button" class="btn primary" data-act="play">듣기 시작</button>'}
    <button type="button" class="link" data-act="skip-ask">소리가 안 나와요</button>
    ${S.skipAsk ? skipBox() : ''}
  </div>`;
}

function timerHTML(limit) {
  return `<div class="timer2" id="timer2"><div class="tbar"><i id="tbar"></i></div><span class="tleft" id="tleft" aria-live="off">${mmss(limit * 1000)}</span></div>`;
}

function optsHTML(it, c) {
  const pics = it.opts.length > 0 && typeof it.opts[0] === 'object';
  const wordsOpt = !pics && c.mod === 'read' && c.key === 1;
  const marks = !pics && it.opts.length > 0 && it.opts.every((o) => /^[①-⑤]$/.test(o)); // 어법 문제: 번호만 고르면 돼서 한 줄로
  const showMk = !pics && !wordsOpt && (it.opts.length > 3 || c.mod === 'gram' || (c.key || 0) >= 3);
  const o = it.opts
    .map((op, k) => {
      const ck = S.sel === k ? 'checked' : '';
      if (pics) return `<label class="opt"><input type="radio" name="q" value="${k}" ${ck}><span class="opt-pic">${LT_PICS[op.pic] || ''}</span><span class="sr">그림 ${k + 1}</span></label>`;
      if (wordsOpt) return `<label class="opt"><input type="radio" name="q" value="${k}" ${ck}><span class="tx">${esc(op)}</span></label>`;
      const only = /^[①-⑤]$/.test(op);
      return `<label class="opt"><input type="radio" name="q" value="${k}" ${ck}>${showMk && !only ? `<span class="mk">${MARK[k]}</span>` : ''}<span class="tx${isEn(op) ? ' en' : ''}"${isEn(op) ? ' lang="en"' : ''}>${esc(op)}</span></label>`;
    })
    .join('');
  return `<div class="opts${pics ? ' pics' : wordsOpt ? ' words' : marks ? ' marks' : ''}" role="radiogroup" aria-label="보기">${o}</div>
    <label class="idk"><input type="radio" name="q" value="-1" ${S.sel === -1 ? 'checked' : ''}>잘 모르겠어요</label>`;
}

function nextRow(ready, label) {
  return `<div class="next-row"><button type="button" class="btn primary" data-act="next" ${ready ? '' : 'disabled'}>${label || '다음'}</button><span class="timeup" id="timeup" hidden>시간이 끝났어요. 다음 문항으로 넘어가요.</span></div>`;
}

function viewItem() {
  const c = S.cur;
  const it = c.items[c.i];
  const b = block();
  const tm = timerHTML(it.limit);
  if (c.mod === 'write') return `${secBar()}${tm}<div id="qzone">${writeHTML(it)}</div>`;
  let body = '';
  if (c.mod === 'voc') {
    body = `<div class="qcard"><p class="qn"><span class="qi">${c.i + 1}</span><span>낱말의 뜻으로 알맞은 것을 고르세요.</span></p><div class="vword" lang="en">${esc(it.en)}</div>${optsHTML(it, c)}</div>${nextRow(S.sel != null)}`;
  } else if (c.mod === 'gram') {
    body = `<div class="qcard"><p class="qn"><span class="qi">${c.i + 1}</span><span>${it.kind === 'gerr' ? '밑줄 친 부분 중 어법상 틀린 것을 고르세요.' : '빈칸에 알맞은 말을 고르세요.'}</span></p><div class="gq" lang="en">${gramText(it.q)}</div>${optsHTML(it, c)}</div>${nextRow(S.sel != null)}`;
  } else if (c.mod === 'listen') {
    body = `<div class="qcard"><p class="qnum">${c.set ? `들은 내용, 문제 ${c.i + 1}/${c.items.length}` : '들은 내용'}</p><p class="qn"><span class="qi">${c.i + 1}</span><span>${esc(it.q)}</span></p>${optsHTML(it, c)}</div>${nextRow(S.sel != null)}`;
  } else {
    const kid = (c.key || 0) <= 4;
    const q = `<div class="qcard"><p class="qnum">문제 ${c.i + 1}/${c.items.length}</p><p class="qn"><span class="qi">${c.i + 1}</span><span>${esc(it.q)}</span></p>
      ${it.pic ? `<div class="qpic">${LT_PICS[it.pic] || ''}</div>` : ''}${it.box ? `<div class="qbox${kid ? ' kid' : ''}" lang="en">${richText(it.box)}</div>` : ''}${optsHTML(it, c)}</div>`;
    body = b.passage
      ? `<div class="test-body split"><article class="passage${kid ? ' kid' : ''}"><p class="p-lb">다음 글을 읽고 물음에 답하세요.</p><p class="p-tx" lang="en">${richText(b.passage)}</p></article><div class="questions">${q}${nextRow(S.sel != null)}</div></div>`
      : `${q}${nextRow(S.sel != null)}`;
  }
  return `${secBar()}${tm}<div id="qzone">${body}</div>`;
}

function writeHTML(it) {
  const c = S.cur;
  const head = `<p class="qn"><span class="qi">${c.i + 1}</span><span>${esc(it.q)}</span></p>`;
  if (it.kind === 'spell' || it.kind === 'order') {
    const used = {};
    S.built.forEach((w) => {
      used[w] = (used[w] || 0) + 1;
    });
    const seen = {};
    const tiles = (it.tiles || [])
      .map((t, k) => {
        seen[t] = (seen[t] || 0) + 1;
        const dis = seen[t] <= (used[t] || 0);
        return `<button type="button" class="tile" data-tile="${k}" lang="en" ${dis ? 'disabled' : ''}>${esc(t)}</button>`;
      })
      .join('');
    return `<div class="wq">${head}
      ${it.pic ? `<div class="qpic">${LT_PICS[it.pic] || ''}</div>` : ''}${it.ko ? `<div class="wko">${esc(it.ko)}</div>` : ''}
      <div class="built" aria-live="polite" lang="en">${S.built.length ? S.built.map((w) => `<span class="w">${esc(w)}</span>`).join('') : `<span class="ph">아래 ${it.kind === 'spell' ? '글자를' : '낱말을'} 차례로 누르세요</span>`}</div>
      <div class="tiles">${tiles}</div>
      <div class="wrow"><button type="button" class="btn" data-act="undo" ${S.built.length ? '' : 'disabled'}>하나 지우기</button></div>
      ${nextRow(S.built.length > 0)}</div>`;
  }
  if (it.kind === 'cond') {
    return `<div class="wq">${head}
      <div class="wko">${esc(it.ko)}</div><ul class="conds">${(it.cond || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <label class="sr" for="w-in">영어 문장</label><input class="winput" id="w-in" lang="en" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="400" value="${esc(S.text)}" placeholder="영어로 쓰세요">
      ${nextRow(S.text.trim().length > 0)}</div>`;
  }
  const wc = words(S.text);
  const range = it.words ? `권장 <b>${it.words[0]}~${it.words[1]}단어</b>, ` : '';
  return `<div class="wq">${head}
    <p class="wcount">${range}지금 <b id="wc">${wc}</b>단어</p>
    <label class="sr" for="w-essay">글쓰기</label><textarea class="wtext" id="w-essay" lang="en" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="2400" placeholder="영어로 쓰세요">${esc(S.text)}</textarea>
    ${nextRow(wc > 0, '제출')}</div>`;
}

function viewSending() {
  return `${S.view ? secBar() : ''}<div class="card sending"><div class="boot" aria-hidden="true"></div><p><b>답을 보내는 중이에요</b></p><p class="muted">잠시만 기다려 주세요.</p></div>`;
}

function viewSendFail() {
  return `${secBar()}<div class="card sending"><h2 style="margin:0;font-size:19px">답을 보내지 못했어요</h2><p class="muted">${esc(S.err)} 푼 답은 이 기기에 남아 있어요.</p><button type="button" class="btn primary" data-act="resend">다시 보내기</button></div>`;
}

function viewDone() {
  const v = S.view;
  const doneMods = v.mods.filter((m) => m.state !== 'skip').map((m) => m.name);
  const skipped = v.mods.filter((m) => m.state === 'skip').map((m) => m.name);
  return `<div class="card finish">
    <div class="chalk">수고했어요!</div>
    <h2>시험이 끝났어요</h2>
    <p class="muted">${esc(doneMods.join(', '))} 영역을 모두 봤어요.${skipped.length ? ` ${esc(skipped.join(', '))}는 건너뛰었어요.` : ''} 결과는 선생님이 확인한 뒤 학부모님께 보내 드려요.</p>
    ${telLine('fin-tel')}
    ${S.info && S.info.teacher ? '<a class="btn" href="/#/classes/lt">선생님 화면에서 결과 보기</a>' : ''}
    <button type="button" class="link" data-act="new">다른 학생이 새로 보기</button>
  </div>`;
}

function render() {
  const v = {
    loading: () => '<div class="boot" aria-label="여는 중"></div>',
    fatal: viewFatal,
    closed: viewClosed,
    form: viewForm,
    resume: viewResume,
    intro: viewIntro,
    'audio-ready': viewAudio,
    audio: viewAudio,
    item: viewItem,
    sending: viewSending,
    'send-fail': viewSendFail,
    done: viewDone,
  }[S.phase];
  app.innerHTML = v ? v() : '';
  if (S.phase === 'item') onTick();
}

function onTick() {
  if (S.phase !== 'item' || S.locked || !S.cur) return;
  const it = S.cur.items[S.cur.i];
  const left = it.limit * 1000 - (performance.now() - S.t0);
  const bar = $('#tbar');
  const txt = $('#tleft');
  const box = $('#timer2');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, left / (it.limit * 1000))})`;
  if (txt) txt.textContent = mmss(left);
  if (box) box.classList.toggle('warn', left <= 10000);
  if (left <= 0) timeout();
}

function setNextReady(ready) {
  const btn = app.querySelector('[data-act="next"]');
  if (btn) btn.disabled = !ready;
}

// ---------------------------------------------------------------- 시작
function checkForm() {
  const f = S.form;
  const bad = {};
  if (!f.name.trim()) bad.name = true;
  if (!(f.grade >= 1 && f.grade <= 12)) bad.grade = true;
  if (!f.consent) bad.consent = true;
  S.bad = bad;
  if (bad.name) return '학생 이름을 적어 주세요.';
  if (bad.grade) return '학년을 골라 주세요.';
  if (bad.consent) return '개인정보 수집과 이용에 동의해 주세요.';
  return '';
}

async function startTest() {
  const msg = checkForm();
  if (msg) {
    S.err = msg;
    render();
    return;
  }
  S.err = '';
  S.busy = true;
  render();
  try {
    const r = await api('/api/lt/start', { method: 'POST', body: { ...S.form, mods: S.info.mods.map((m) => m.key) } });
    S.token = r.token;
    store.set(TOKEN, r.token);
    store.del(PART);
    S.view = r.view;
    S.phase = 'intro';
  } catch (e) {
    S.err = e.message;
  }
  S.busy = false;
  render();
  window.scrollTo({ top: 0 });
}

function newStudent() {
  stopAudio();
  store.del(TOKEN);
  store.del(PART);
  S.token = null;
  S.view = null;
  S.cur = null;
  S.err = '';
  S.bad = {};
  const me = S.info && S.info.me;
  S.form = { name: me ? me.name : '', grade: me && me.grade ? me.grade : 0, school: me ? me.school : '', years: '1to2', phone: '', consent: false };
  S.phase = S.info && S.info.open ? 'form' : 'closed';
  render();
  window.scrollTo({ top: 0 });
}

async function boot() {
  try {
    S.info = await api('/api/lt/info' + location.search);
  } catch (e) {
    S.phase = 'fatal';
    S.err = e.message;
    render();
    return;
  }
  renderBrand();
  const me = S.info.me;
  if (me) {
    S.form.name = me.name;
    S.form.school = me.school || '';
    if (me.grade) S.form.grade = me.grade;
  }
  if (S.token) {
    try {
      const r = await api('/api/lt/me');
      S.view = r.view;
      S.phase = r.view.done ? 'done' : 'resume';
      render();
      return;
    } catch (e) {
      if (e.status === 404 || e.status === 401) {
        store.del(TOKEN);
        store.del(PART);
        S.token = null;
      } else {
        S.phase = 'fatal';
        S.err = e.message;
        render();
        return;
      }
    }
  }
  S.phase = S.info.open ? 'form' : 'closed';
  render();
}

// ---------------------------------------------------------------- 누르기, 고르기, 쓰기
document.addEventListener('click', (e) => {
  const t = e.target;
  const tile = t.closest('[data-tile]');
  if (tile && S.phase === 'item' && !S.locked) {
    const it = S.cur.items[S.cur.i];
    S.built.push(it.tiles[Number(tile.dataset.tile)]);
    render();
    return;
  }
  const act = t.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'reload') location.reload();
  else if (a === 'resume') {
    S.phase = 'intro';
    render();
  } else if (a === 'new') newStudent();
  else if (a === 'begin') {
    loadBlock();
    render();
    window.scrollTo({ top: 0 });
  } else if (a === 'play') startAudio();
  else if (a === 'skip-ask') {
    S.skipAsk = true;
    render();
  } else if (a === 'skip-no') {
    S.skipAsk = false;
    render();
  } else if (a === 'skip-listen') skipListen();
  else if (a === 'next') {
    if (S.phase === 'item' && !S.locked) submitItem(false);
  } else if (a === 'undo') {
    S.built.pop();
    render();
  } else if (a === 'resend') sendBlock();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'q' && S.phase === 'item' && !S.locked) {
    S.sel = Number(t.value);
    setNextReady(true);
    return;
  }
  if (t.dataset && t.dataset.f) {
    const f = t.dataset.f;
    S.form[f] = f === 'consent' ? t.checked : f === 'grade' ? Number(t.value) : t.value;
    if (S.bad[f]) {
      delete S.bad[f];
      const el = t.closest('.field, .consent');
      if (el) el.classList.remove('bad');
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if ((t.id === 'w-in' || t.id === 'w-essay') && S.phase === 'item') {
    S.text = t.value;
    const wc = $('#wc');
    if (wc) wc.textContent = String(words(t.value));
    setNextReady(t.id === 'w-in' ? t.value.trim().length > 0 : words(t.value) > 0);
    return;
  }
  if (t.dataset && t.dataset.f && t.tagName === 'INPUT' && t.type !== 'checkbox') S.form[t.dataset.f] = t.value;
});

// 글쓰기 칸에는 붙여 넣지 않아요 (번역기 답을 막아요)
for (const ev of ['paste', 'drop']) {
  document.addEventListener(ev, (e) => {
    if (e.target && (e.target.id === 'w-in' || e.target.id === 'w-essay')) {
      e.preventDefault();
      toast('직접 써 주세요. 붙여 넣기는 쓰지 않아요.');
    }
  });
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'f-info') return;
  e.preventDefault();
  if (!S.busy) startTest();
});

document.addEventListener('keydown', (e) => {
  if (S.phase !== 'item' || S.locked || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'TEXTAREA') return;
  const c = S.cur;
  const it = c.items[c.i];
  if (c.mod !== 'write' && /^[1-5]$/.test(e.key) && Number(e.key) <= it.opts.length && tag !== 'INPUT') {
    S.sel = Number(e.key) - 1;
    const r = app.querySelector(`input[name="q"][value="${S.sel}"]`);
    if (r) r.checked = true;
    setNextReady(true);
    return;
  }
  if (e.key === 'Enter') {
    const btn = app.querySelector('[data-act="next"]');
    if (btn && !btn.disabled) {
      e.preventDefault();
      submitItem(false);
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (['item', 'audio', 'audio-ready', 'sending'].includes(S.phase)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

setInterval(onTick, 200);
boot();
