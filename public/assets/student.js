import {
  html, useState, useEffect, useRef, api, Icon, Btn, Field, Bar, Ring, Empty, Skel, toast, toastErr, fmtDur, fmtMin, fmtDate, ago, dueLabel, initial, useRoute, go,
} from './ui.js';
import { Player } from './player.js';
import { StudentQuiz, QuizEntry, HomeworkEntry, MockEntry, StudentMock } from './quizview.js';

// ------------------------------------------------------------ 시청 구간 비트맵 (1초 = 1비트)
function decodeBits(b64, n) {
  const out = new Uint8Array(Math.ceil(n / 8));
  if (!b64) return out;
  try {
    const bin = atob(b64);
    for (let i = 0; i < Math.min(bin.length, out.length); i++) out[i] = bin.charCodeAt(i);
  } catch {
    /* 잘못된 값은 빈 것으로 봐요 */
  }
  return out;
}
function encodeBits(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function StudentApp({ info, me, onLogout, preview }) {
  const hashRoute = useRoute();
  const [inner, setInner] = useState('/');
  const scrRef = useRef(null);
  const route = preview ? inner : hashRoute;
  const nav = (p) => {
    if (preview) {
      setInner(p);
      const scr = scrRef.current && scrRef.current.closest('.scr');
      if (scr) scr.scrollTop = 0;
    } else go(p);
  };
  const q = preview ? `?as=${preview}` : '';
  const parts = route.split('?')[0].split('/');
  let page;
  if (parts[1] === 'watch') page = html`<${Watch} id=${parts[2]} key=${parts[2]} q=${q} nav=${nav} preview=${preview} />`;
  else if (parts[1] === 'quiz') page = html`<${StudentQuiz} id=${parts[2]} key=${`q${parts[2]}`} q=${q} nav=${nav} preview=${preview} />`;
  else if (parts[1] === 'hw') page = html`<${StudentQuiz} kind="hw" id=${parts[2]} key=${`h${parts[2]}`} q=${q} nav=${nav} preview=${preview} />`;
  else if (parts[1] === 'mock') page = html`<${StudentMock} id=${parts[2]} key=${`m${parts[2]}`} q=${q} nav=${nav} preview=${preview} />`;
  else if (parts[1] === 'exam') page = html`<${StudentQuiz} kind="exam" id=${parts[2]} key=${`e${parts[2]}`} q=${q} nav=${nav} preview=${preview} />`;
  else if (parts[1] === 'done') page = html`<${Home} q=${q} nav=${nav} info=${info} doneOnly />`;
  else if (parts[1] === 'me') page = html`<${Me} q=${q} me=${me} info=${info} onLogout=${onLogout} preview=${preview} />`;
  else page = html`<${Home} q=${q} nav=${nav} info=${info} />`;
  const tab = parts[1] || '';
  return html`<div class=${`sapp ${['quiz', 'hw', 'mock', 'exam'].includes(tab) ? 'qz' : ''}`} ref=${scrRef}>
    ${preview && html`<div class="pv-banner"><${Icon} name="eye" size="sm" />미리보기예요. 여기서 본 기록은 남지 않아요</div>`}
    ${page}
    ${!['watch', 'quiz', 'hw', 'mock', 'exam'].includes(tab) && html`<nav class="s-tabbar"><div class="in">
      ${[['', 'home', '홈'], ['done', 'trophy', '다 본 강의'], ['me', 'user', '내 정보']].map(
        ([p, ic, label]) => html`<a href=${preview ? undefined : `#/${p}`} class=${tab === p ? 'on' : ''} onClick=${(e) => { if (preview) { e.preventDefault(); nav('/' + p); } }}><${Icon} name=${ic} size="lg" />${label}</a>`,
      )}</div></nav>`}
  </div>`;
}

function TopBar({ info, title, right }) {
  return html`<header class="s-top">
    <div class="brand-s"><div class="mark">${info.logo_url ? html`<img src=${info.logo_url} alt="" />` : html`<${Icon} name="penLine" size="sm" />`}</div>${title || info.app_name}</div>
    <span class="spacer"></span>${right}
  </header>`;
}

function Thumb({ l, done }) {
  return html`<div class="thumb">
    ${l.has_thumb ? html`<img src=${`/media/lecture/${l.id}/thumb`} alt="" loading="lazy" />` : html`<div class="tt"></div>`}
    ${done ? html`<${Stamp} small />` : html`<div class="pi"><span><${Icon} name="play" size="sm" /></span></div>`}
  </div>`;
}

function LectureCard({ l, nav }) {
  const d = dueLabel(l.due_at);
  const done = !!l.completed_at;
  return html`<div class=${`card s-card ${done ? 'done' : ''}`} onClick=${() => nav(`/watch/${l.id}`)}>
    <${Thumb} l=${l} done=${done} />
    <div class="info">
      <div class="st">${l.title}</div>
      <div class="ss ellipsis">${[l.source, fmtMin(l.duration)].filter(Boolean).join(', ')}</div>
      ${((l.quiz_n > 0 && (l.quiz_score !== null || done)) || (l.hw_n > 0 && (l.hw_score !== null || done))) && html`<div class="s-chips">
        ${l.quiz_n > 0 && (l.quiz_score !== null || done) && html`<span class=${`chip ${l.quiz_score !== null ? 'ivy' : 'amber'}`}><${Icon} name="circleHelp" size="sm" />${l.quiz_score !== null ? `확인 문제 ${l.quiz_score}/${l.quiz_total}` : '확인 문제 안 풀었어요'}</span>`}
        ${l.hw_n > 0 && (l.hw_score !== null || done) && html`<span class=${`chip ${l.hw_score !== null ? 'ivy' : 'amber'}`}><${Icon} name="clipboard" size="sm" />${l.hw_score !== null ? `숙제 ${l.hw_score}/${l.hw_total}` : '숙제 안 냈어요'}</span>`}</div>`}
      ${done ? html`<div class="faint" style="font-size:12.5px">${fmtDate(l.completed_at)}에 다 봤어요</div>`
        : html`<div class="row" style="gap:8px"><div style="flex:1"><${Bar} value=${l.percent} thin /></div><span class="num" style="font-size:12.5px;font-weight:800;color:${l.percent ? 'var(--ink)' : 'var(--faint)'}">${l.percent}%</span></div>
          <div class="faint" style="font-size:12px">${l.percent > 0 ? `${fmtDur(l.last_pos)}부터 이어 보기` : '아직 안 봤어요'}</div>`}
    </div>
    ${!done && d && html`<span class=${`due-note ${d.tone === 'rose' || d.tone === 'amber' ? 'hot' : ''}`}>${d.text}</span>`}
  </div>`;
}

// 선생님이 낸 시험 한 줄 (풀기, 점수, 마감)
function ExamCard({ e, nav }) {
  const d = dueLabel(e.due_at);
  const done = e.score !== null;
  return html`<button class=${`card s-exam ${done ? 'done' : ''}`} onClick=${() => nav(`/exam/${e.id}`)}>
    <span class="se-ic"><${Icon} name="clipboardCheck" /></span>
    <span class="info"><span class="st">${e.title}</span>
      <span class="ss">${e.n}문항${done ? `, ${fmtDate(e.done_at)}에 냈어요` : e.closed ? ', 마감됐어요' : e.due_at ? `, ${fmtDate(e.due_at)}까지` : ''}</span></span>
    ${done ? html`<span class="chip ivy num">${e.score}/${e.total}</span>` : e.closed ? html`<span class="chip">마감</span>` : html`<span class=${`chip ${d && (d.tone === 'rose' || d.tone === 'amber') ? 'rose' : 'amber'}`}>${d && d.tone ? d.text : '풀기'}</span>`}
  </button>`;
}

// ------------------------------------------------------------ 홈 / 다 본 강의
function Home({ q, nav, info, doneOnly }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api(`/api/student/lectures${q}`).then((d) => { setData(d); setErr(null); }).catch(setErr);
  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [q]);
  if (err && !data) return html`<${TopBar} info=${info} /><div class="s-body"><${Empty} icon="wifiOff" title="불러오지 못했어요" action=${html`<${Btn} onClick=${load}>다시 시도</${Btn}>`}>${err.message}</${Empty}></div>`;
  if (!data) return html`<${TopBar} info=${info} /><div class="s-body"><${Skel} h=${60} mb=${18} /><${Skel} h=${96} mb=${18} /><${Skel} h=${84} /><${Skel} h=${84} /></div>`;
  const all = data.lectures;
  const todo = all.filter((l) => !l.completed_at);
  const done = all.filter((l) => l.completed_at);
  // 시험: 풀 것 먼저(마감 가까운 차례), 그다음 푼 것(최근 2주), 마감된 것은 빼요
  const exams = data.exams || [];
  const exTodo = exams.filter((e) => e.score === null && !e.closed).sort((a, b) => (a.due_at || 9e12) - (b.due_at || 9e12));
  const exDone = exams.filter((e) => e.score !== null);
  const exRecent = exDone.filter((e) => e.done_at > Date.now() / 1000 - 14 * 86400);
  const name = data.student.name;
  const firstName = name.length >= 3 ? name.slice(1) : name;
  const nextDue = todo.filter((l) => l.due_at).sort((a, b) => a.due_at - b.due_at)[0];
  const right = html`<button class="s-avatar" onClick=${() => nav('/me')} aria-label="내 정보">${initial(name)}</button>`;
  if (doneOnly) {
    return html`<${TopBar} info=${info} title="다 본 강의" right=${right} />
      <div class="s-body">
        ${done.length ? html`<div class="sec-h">완료한 강의 <span class="num">${done.length}</span></div>${done.map((l) => html`<${LectureCard} l=${l} nav=${nav} />`)}`
          : html`<div class="card" style="margin-top:8px"><${Empty} icon="trophy" title="아직 다 본 강의가 없어요">강의를 끝까지 보면 여기에 모여요.</${Empty}></div>`}
        ${exDone.length > 0 && html`<div class="sec-h" style="margin-top:22px">푼 시험 <span class="num">${exDone.length}</span></div>${exDone.map((e) => html`<${ExamCard} e=${e} nav=${nav} />`)}`}
      </div>`;
  }
  return html`<${TopBar} info=${info} right=${right} />
    <div class="s-body">
      ${all.length > 0 ? html`<section class="s-hero chalkboard">
        <div style="flex:1;min-width:0">
          <div class="sh-hi">${firstName}님, 안녕하세요</div>
          <div class="sh-big">${todo.length ? `남은 강의 ${todo.length}개` : '모든 강의를 다 봤어요'}</div>
          <div class="sh-sub">${todo.length ? (nextDue ? `가장 가까운 마감 ${fmtDate(nextDue.due_at)}` : '마감이 없는 강의예요') : '정말 잘했어요. 새 강의가 오면 여기에 나타나요.'}</div>
        </div>
        <${Ring} value=${(done.length / all.length) * 100} size=${72} stroke=${7} label=${`${done.length}/${all.length}`} />
      </section>` : html`<div class="hello"><h2>${firstName}님, 안녕하세요</h2><p>${data.student.class_name ? `${data.student.class_name}, ` : ''}오늘도 한 강의씩 끝내 봐요.</p></div>`}
      ${!data.student.class_name ? html`<div class="notice amber" style="margin-bottom:16px"><${Icon} name="info" /><div>아직 반이 정해지지 않았어요. 선생님께 말씀드려 주세요.</div></div>` : null}
      ${(exTodo.length > 0 || exRecent.length > 0) && html`<div class="sec-h">시험 ${exTodo.length > 0 && html`<span class="num">${exTodo.length}</span>`}</div>
        ${exTodo.map((e) => html`<${ExamCard} e=${e} nav=${nav} />`)}${exRecent.map((e) => html`<${ExamCard} e=${e} nav=${nav} />`)}`}
      ${all.length === 0 ? html`<div class="card"><${Empty} icon="video" title="아직 받은 강의가 없어요">선생님이 강의를 내 주면 여기에 나타나요.</${Empty}></div>`
        : html`<div class="sec-h">해야 할 강의 <span class="num">${todo.length}</span></div>
          ${todo.length ? todo.map((l) => html`<${LectureCard} l=${l} nav=${nav} />`)
            : html`<div class="card s-alldone"><${Icon} name="trophy" size="xl" /><div><b>할 일을 모두 끝냈어요</b><div class="muted" style="font-size:13.5px">다시 보고 싶으면 다 본 강의에서 열어 보세요.</div></div></div>`}
          ${done.length > 0 && html`<button class="sec-link" onClick=${() => nav('/done')}>다 본 강의 ${done.length}개 보기<${Icon} name="chevronRight" size="sm" /></button>`}`}
    </div>`;
}

// ------------------------------------------------------------ 강의 보기
// 잘라낸 구간은 빼고 셉니다
function cutMask(cuts, n) {
  const m = new Uint8Array(n);
  for (const [a, b] of cuts || []) for (let i = Math.max(0, Math.ceil(a)); i < Math.min(n, Math.floor(b)); i++) m[i] = 1;
  return m;
}

function Watch({ id, q, nav, preview }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pct, setPct] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [resume, setResume] = useState(null);
  const [ended, setEnded] = useState(false);
  const [ready, setReady] = useState(false);
  const [chap, setChap] = useState(-1);
  const pl = useRef(null);
  const st = useRef({ bits: null, dur: 0, skip: null, lastT: null, maxReached: 0, startedPending: false, started: false, dirty: false, completed: false, rules: {} });

  useEffect(() => {
    api(`/api/student/lectures/${id}${q}`)
      .then((d) => {
        const s = st.current;
        s.dur = Math.ceil(d.lecture.duration || 0);
        s.bits = decodeBits(d.progress.bits, s.dur || 1);
        s.skip = cutMask(d.lecture.cuts, s.dur || 1);
        s.maxReached = d.progress.max_pos || 0;
        s.completed = !!d.progress.completed_at;
        s.rules = d.rules;
        setCompleted(s.completed);
        setPct(d.progress.percent || 0);
        const lp = d.progress.last_pos || 0;
        if (lp > 15 && (!s.dur || lp < s.dur - 15)) setResume(lp);
        setData(d);
      })
      .catch(setErr);
  }, [id]);

  const localPct = () => {
    const s = st.current;
    if (!s.dur) return 0;
    let seen = 0;
    let need = 0;
    for (let i = 0; i < s.dur; i++) {
      if (s.skip && s.skip[i]) continue;
      need++;
      if (s.bits[i >> 3] & (1 << (i & 7))) seen++;
    }
    return Math.min(100, Math.round((seen / Math.max(1, need)) * 100));
  };
  const gapAt = () => {
    const s = st.current;
    for (let i = 0; i < s.dur; i++) if (!(s.skip && s.skip[i]) && !(s.bits[i >> 3] & (1 << (i & 7)))) return i;
    return -1;
  };

  const flush = (keepalive) => {
    const s = st.current;
    const v = pl.current && pl.current.video;
    if (!s.dur || (!s.dirty && !s.startedPending)) return;
    const body = { lecture_id: Number(id), bits: encodeBits(s.bits), pos: v ? v.currentTime : 0, duration: s.dur, started: s.startedPending };
    s.startedPending = false;
    s.dirty = false;
    fetch('/api/student/progress', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json', 'X-Ivy': '1' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.preview || !d.ok) return;
        if (d.bits) {
          const srv = decodeBits(d.bits, s.dur);
          for (let i = 0; i < s.bits.length; i++) s.bits[i] |= srv[i];
        }
        setPct(Math.max(d.percent || 0, localPct()));
        if (d.completed && !s.completed) {
          s.completed = true;
          setCompleted(true);
          toast('강의를 다 봤어요. 완료 도장을 찍었어요!');
        }
      })
      .catch(() => {
        s.dirty = true;
      });
  };

  useEffect(() => {
    if (!data || !ready) return;
    const P = pl.current;
    const v = P.video;
    const s = st.current;
    const markRange = (a, b) => {
      const from = Math.max(0, Math.floor(a));
      const to = Math.min(s.dur - 1, Math.floor(b));
      for (let i = from; i <= to; i++) s.bits[i >> 3] |= 1 << (i & 7);
    };
    const onMeta = () => {
      if (!s.dur && v.duration && Number.isFinite(v.duration)) {
        s.dur = Math.ceil(v.duration);
        s.bits = decodeBits(null, s.dur);
        s.skip = cutMask(data.lecture.cuts, s.dur);
      }
    };
    const onTime = () => {
      const t = v.currentTime;
      if (!v.paused && !v.seeking && s.lastT !== null && s.dur) {
        const d = t - s.lastT;
        if (d > 0 && d < 3.5) {
          markRange(s.lastT, t);
          s.dirty = true;
          if (t > s.maxReached) s.maxReached = t;
        }
      }
      s.lastT = t;
      const ch = data.lecture.chapters || [];
      let k = -1;
      for (let i = 0; i < ch.length; i++) if (t + 0.3 >= ch[i].t) k = i;
      setChap(k);
    };
    const onSeeking = () => {
      if (P.autoSeek) {
        s.maxReached = Math.max(s.maxReached, v.currentTime);
      }
      s.lastT = null;
    };
    const onSeeked = () => {
      s.lastT = v.currentTime;
    };
    const onPlay = () => {
      if (!s.started) {
        s.started = true;
        s.startedPending = true;
      }
      s.lastT = v.currentTime;
      setResume(null);
      setEnded(false);
    };
    const onPause = () => flush();
    const onEnded = () => {
      if (s.dur && s.lastT !== null && s.dur - s.lastT < 3.5) markRange(s.lastT, s.dur);
      s.dirty = true;
      flush();
      setEnded(true);
      P.redraw();
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    const tick = setInterval(() => {
      if (s.dirty) flush();
      if (s.dur) setPct((p) => Math.max(p, localPct()));
    }, 10000);
    const ui = setInterval(() => {
      if (!v.paused && s.dur) setPct((p) => Math.max(p, localPct()));
    }, 2500);
    const onHide = () => document.visibilityState === 'hidden' && flush(true);
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      flush(true);
      clearInterval(tick);
      clearInterval(ui);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [data, ready]);

  const back = () => nav('/');
  if (err) return html`<div class="s-body" style="padding-top:24px"><${Empty} icon="alert" title="강의를 열 수 없어요" action=${html`<${Btn} onClick=${back}>목록으로</${Btn}>`}>${err.message}</${Empty}></div>`;
  if (!data) return html`<div class="s-watch"><div class="vid"><div class="vtop"><button class="vback" onClick=${back}><${Icon} name="chevronLeft" /></button></div><div style="aspect-ratio:16/9;background:#000"></div></div><div class="wb"><${Skel} h=${26} w="70%" /><${Skel} h=${16} w="40%" mb=${24} /><${Skel} h=${110} /></div></div>`;
  const l = data.lecture;
  const thr = data.rules.complete_threshold;
  const d = dueLabel(l.due_at);
  const gap = ended && !completed && st.current.dur ? gapAt() : -1;
  const goTo = (t) => {
    const P = pl.current;
    if (!P) return;
    if (P.seek(t)) P.play();
  };
  const canSeek = (t) => {
    const s = st.current;
    if (s.rules.prevent_skip && !s.completed && t > s.maxReached + 2) return '처음 볼 때는 안 본 곳으로 넘길 수 없어요';
    return true;
  };
  const chapters = l.chapters || [];
  return html`<div class="s-watch">
    <div class="vid">
      <div class="vtop"><button class="vback" onClick=${back} aria-label="뒤로"><${Icon} name="chevronLeft" /></button><div class="vt ellipsis">${l.title}</div></div>
      <${Player} src=${`/media/lecture/${l.id}/video`} poster=${l.has_thumb ? `/media/lecture/${l.id}/thumb` : undefined}
        subtitle=${data.files.subtitle} duration=${l.duration} cuts=${l.cuts} chapters=${chapters} strokes=${l.strokes}
        slots=${data.name ? data.name.slots : []} name=${data.name} canSeek=${canSeek}
        watched=${() => ({ bits: st.current.bits, dur: st.current.dur })}
        onApi=${(a) => { pl.current = a; setReady(true); }} />
    </div>
    <div class="wb">
      ${l.source && html`<div class="w-src">${l.source}</div>`}
      <h2>${l.title}</h2>
      <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">${completed ? html`<span class="chip ivy"><${Icon} name="check" size="sm" />다 봤어요</span>` : d && html`<span class="chip ${d.tone}">${d.text}</span>`}
        ${l.due_at && html`<span class="chip">${fmtDate(l.due_at)}까지</span>`}${l.duration ? html`<span class="chip">${fmtMin(l.duration)}</span>` : null}</div>
      ${resume !== null && html`<div class="resume"><${Icon} name="clock" /><div style="flex:1">지난번에 <b class="num">${fmtDur(resume)}</b>까지 봤어요.</div><${Btn} kind="primary" size="sm" onClick=${() => goTo(resume)}>이어 보기</${Btn}></div>`}
      ${gap >= 0 && html`<div class="resume warn"><${Icon} name="alert" /><div style="flex:1">건너뛴 부분이 있어요. <b class="num">${fmtDur(gap)}</b>부터 마저 보면 완료돼요.</div><${Btn} size="sm" onClick=${() => goTo(gap)}>마저 보기</${Btn}></div>`}
      ${l.note && html`<div class="t-note"><div class="avatar" style="width:30px;height:30px;font-size:12px">T</div><div><div class="faint" style="font-size:12px;font-weight:700">선생님 한마디</div><div>${l.note}</div></div></div>`}
      <div class=${`card prog-card ${completed ? 'done' : ''}`}>
        <div class="row between"><div><div class="label">내가 본 만큼</div><div class="pv num">${pct}<small>%</small></div></div>
          ${completed ? html`<${Stamp} text="완료" />` : html`<div class="faint" style="font-size:12.5px;text-align:right">${thr}% 이상 보면<br />완료 도장을 찍어 줘요</div>`}</div>
        <div class="hl-track"><i style=${`width:${pct}%`}></i></div>
        <div class="faint" style="font-size:12.5px;margin-top:8px">영상 아래 노란 줄이 실제로 본 곳이에요. 빨리 넘긴 곳은 빠져요.</div>
      </div>
      <${QuizEntry} id=${l.id} quiz=${data.quiz} result=${data.quiz_result} completed=${completed} nav=${nav} />
      <${HomeworkEntry} id=${l.id} hw=${data.homework} result=${data.homework_result} nav=${nav} />
      <${MockEntry} id=${l.id} mock=${data.mock} nav=${nav} />
      ${chapters.length > 0 && html`<div class="card w-toc"><div class="label" style="margin-bottom:6px"><${Icon} name="listOrdered" size="sm" /> 목차</div>
        ${chapters.map((c, i) => html`<button class=${`toc-i ${i === chap ? 'on' : ''}`} onClick=${() => goTo(c.t)}><span class="num">${fmtDur(c.t)}</span><span>${c.title}</span></button>`)}</div>`}
      ${l.summary && html`<${Study} sm=${l.summary} />`}
      ${(data.files.note || data.files.practice) && html`<div class="label" style="margin:4px 0 10px">학습 자료</div>
        <div class="res">
          ${data.files.note && html`<a href=${data.files.note} target="_blank" rel="noopener"><span class="ri"><${Icon} name="pencil" /></span><span><div>판서노트</div><div class="faint" style="font-size:12px;font-weight:500">PDF로 보고 인쇄할 수 있어요</div></span></a>`}
          ${data.files.practice && html`<a href=${data.files.practice} target="_blank" rel="noopener"><span class="ri"><${Icon} name="clipboard" /></span><span><div>${l.summary && !data.files.note ? '복습 노트' : '연습지'}</div><div class="faint" style="font-size:12px;font-weight:500">PDF로 보고 인쇄할 수 있어요</div></span></a>`}
        </div>`}
    </div>
  </div>`;
}

// 완료 도장
export function Stamp({ text = '완료', small }) {
  return html`<div class=${`stamp ${small ? 'sm' : ''}`} aria-label=${text}><svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 6c24 .5 44 19 43.6 44.3C93.2 75 74.6 94 49.6 93.8 25 93.6 6.4 74.7 6.6 49.6 6.8 25.3 25.6 5.6 50 6Z" />
    <path d="M50 15c19 .3 35 15.5 34.6 35.2C84.2 69.6 69.3 85 49.8 84.8 30.3 84.6 15.4 69.3 15.6 49.8 15.8 30.5 30.8 14.7 50 15Z" /></svg><b>${text}</b></div>`;
}

// AI 요약과 스스로 풀어 보기 (점수를 남기지 않는 짧은 문제)
function Study({ sm }) {
  const [pick, setPick] = useState({});
  const quiz = sm.quiz || [];
  return html`<div class="card w-study">
    <div class="label" style="margin-bottom:8px"><${Icon} name="bookOpen" size="sm" /> 강의 요약</div>
    ${sm.one_line && html`<p class="one">${sm.one_line}</p>`}
    ${(sm.points || []).length > 0 && html`<ul class="pts">${sm.points.map((x) => html`<li>${x}</li>`)}</ul>`}
    ${(sm.vocab || []).length > 0 && html`<div class="voc">${sm.vocab.map((v) => html`<span><b>${v.en}</b> ${v.ko}</span>`)}</div>`}
    ${quiz.length > 0 && html`<div class="label" style="margin:16px 0 8px"><${Icon} name="circleHelp" size="sm" /> 스스로 풀어 보기</div>
      ${quiz.map((qz, i) => {
        const p = pick[i];
        return html`<div class="qz"><div class="qq"><b class="num">${i + 1}</b>${qz.q}</div>
          <div class="qc">${qz.choices.map((c, k) => html`<button class=${p === undefined ? '' : k === qz.answer ? 'ok' : k === p ? 'no' : 'dim'} disabled=${p !== undefined} onClick=${() => setPick({ ...pick, [i]: k })}>${c}</button>`)}</div>
          ${p !== undefined && html`<div class=${`qw ${p === qz.answer ? 'ok' : 'no'}`}>${p === qz.answer ? '맞았어요! ' : '아쉬워요. '}${qz.why || ''}</div>`}</div>`;
      })}`}
  </div>`;
}

// ------------------------------------------------------------ 내 정보
function Me({ q, me, info, onLogout, preview }) {
  const [data, setData] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(!!window.__ivyInstall);
  useEffect(() => {
    api(`/api/student/lectures${q}`).then(setData).catch(() => {});
    const on = () => setCanInstall(!!window.__ivyInstall);
    window.addEventListener('ivy:installable', on);
    return () => window.removeEventListener('ivy:installable', on);
  }, []);
  const install = async () => {
    const e = window.__ivyInstall;
    if (!e) return;
    e.prompt();
    await e.userChoice.catch(() => {});
    window.__ivyInstall = null;
    setCanInstall(false);
  };
  const change = async () => {
    setBusy(true);
    try {
      await api('/api/me/password', { method: 'POST', body: pw });
      toast('비밀번호를 바꿨어요');
      setPw({ current: '', next: '' });
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const name = (data && data.student.name) || (me && me.name) || '';
  const cls = data ? data.student.class_name : me && me.class_name;
  const total = data ? data.lectures.length : 0;
  const done = data ? data.lectures.filter((l) => l.completed_at).length : 0;
  return html`<${TopBar} info=${info} title="내 정보" />
    <div class="s-body stack">
      <div class="card pad" style="display:flex;align-items:center;gap:14px">
        <div class="avatar" style="width:54px;height:54px;font-size:20px">${initial(name)}</div>
        <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:18px">${name}</div><div class="muted" style="font-size:13.5px">${[cls || '반 없음', me && me.login_id ? `아이디 ${me.login_id}` : ''].filter(Boolean).join(', ')}</div></div>
        ${data && html`<div style="text-align:right"><div class="num" style="font-weight:800;font-size:20px;color:var(--ivy-700)">${done}/${total}</div><div class="faint" style="font-size:12px">완료한 강의</div></div>`}
      </div>
      <div class="card pad">
        <div style="font-weight:800;margin-bottom:6px">휴대폰 앱으로 쓰기</div>
        ${isStandalone() ? html`<div class="row" style="gap:8px;color:var(--ivy-700);font-weight:650"><${Icon} name="checkCircle" />앱으로 쓰고 있어요</div>`
          : canInstall ? html`<p class="muted" style="margin:0 0 12px;font-size:14px">홈 화면에 아이콘을 만들어 앱처럼 바로 열 수 있어요.</p><${Btn} kind="primary" icon="download" onClick=${install}>앱 설치하기</${Btn}>`
          : isIOS() ? html`<ol class="how">
              <li>Safari에서 이 주소를 열어요.</li>
              <li>아래쪽 <b>공유</b> 버튼 <span class="kbd"><${Icon} name="share" size="sm" /></span>을 눌러요.</li>
              <li><b>홈 화면에 추가</b> <span class="kbd"><${Icon} name="squarePlus" size="sm" /></span>를 누르고 <b>추가</b>를 눌러요.</li></ol>`
          : html`<ol class="how"><li>Chrome에서 이 주소를 열어요.</li><li>오른쪽 위 <b>⋮</b> 메뉴를 눌러요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.</li></ol>`}
      </div>
      <div class="card pad stack">
        <div style="font-weight:800">비밀번호 바꾸기</div>
        ${preview ? html`<div class="muted" style="font-size:14px">미리보기에서는 바꿀 수 없어요.</div>` : html`
          <${Field} label="지금 비밀번호"><input type="password" value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} autocomplete="current-password" /></${Field}>
          <${Field} label="새 비밀번호" hint="4자 이상"><input type="password" value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} autocomplete="new-password" /></${Field}>
          <div><${Btn} icon="lock" busy=${busy} disabled=${!pw.current || pw.next.length < 4} onClick=${change}>바꾸기</${Btn}></div>`}
      </div>
      ${!preview && html`<${Btn} kind="danger" icon="logout" block onClick=${onLogout}>로그아웃</${Btn}>`}
      <div class="faint" style="text-align:center;font-size:12.5px;padding:4px 0 8px">${info.academy_name}</div>
    </div>`;
}
