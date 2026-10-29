// 선생님 화면: 오늘, 강의, 반, 설정
// 위쪽 칠판 막대에 메뉴 네 개만 두고, 나머지는 각 화면 안에서 해결해요. Ctrl+K(맥은 ⌘K)나 / 로 무엇이든 찾아요.
import {
  html, useState, useEffect, useRef, api, Icon, Btn, Field, Seg, Switch, Bar, Ring, Empty, Skel, Modal, StatusChip, STATUS, ChalkLine,
  toast, toastErr, confirmBox, fmtDur, fmtDate, ago, dueLabel, fmtBytes, initial, useRoute, go, useAsync, uploadFile, videoDuration, videoThumb, copyText,
  matches, matchScore, useEvent, emit, MOD_KEY, RecoveryCard, KeyWarn, useCapsLock,
} from './ui.js';
import { StudentApp } from './student.js';
import { Player } from './player.js';
import { QuizItem, AREA, isOk } from './quizview.js';
import { HomeworkCard, MockCard, MaterialsCard, uploadMaterial } from './bankcards.js';
import { mountBoard, VIEW_LABEL, normalizeStyle, STYLE_PRESETS, DEFAULT_STYLE } from './board.js';
import { DEMO_SCRIPT } from './board-demo.js';
import { Editor } from './editor.js';
import { prepareMaterial, outline, planParts, splitTranslation, noiseLine } from './material.js';
import { DuePicker, ymd, daysLater, endOfDay } from './due.js';
import { ExamsPage, ExamBuilder, ExamDetail, ClassScores } from './exams.js';

const WORKING = ['queued', 'scripting', 'render_queued', 'rendering'];
const NAV = [['/', '오늘', 'today', 'home'], ['/lectures', '강의', 'lectures', 'library'], ['/classes', '반', 'classes', 'users'], ['/settings', '설정', 'settings', 'settings']];
const SECTION = { '': 'today', lectures: 'lectures', new: 'lectures', lecture: 'lectures', review: 'lectures', edit: 'lectures', exams: 'lectures', classes: 'classes', settings: 'settings' };
const TITLES = { '': '오늘', lectures: '강의', new: '새 강의', lecture: '강의', review: '검수', edit: '강의 편집', exams: '시험', classes: '반', settings: '설정' };

function engineOnline(last) {
  return !!last && Date.now() / 1000 - last < 150;
}

// 예전 주소로 들어와도 새 화면으로 열어요 (북마크, 안내서 주소 그대로 쓰게)
function mapOld(route) {
  const [p, qs = ''] = route.split('?');
  const q = new URLSearchParams(qs);
  if (p === '/create') return '/new';
  if (p === '/library') return `/lectures${qs ? `?${qs}` : ''}`;
  if (p === '/watch') return q.get('class') ? `/classes/${q.get('class')}/watch` : '/classes?tab=watch';
  if (p === '/assign') return '/classes';
  if (p === '/preview') return '/settings/preview';
  if (p === '/board-style') return '/settings/board';
  return route;
}

// 학생 이름 부르기 미리 보기 (서버 util.js callText 와 같은 규칙)
export function callPreview(name) {
  const base = String(name || '').trim();
  if (!base) return '하준아';
  const isH = (ch) => ch >= '가' && ch <= '힣';
  const given = base.length === 3 && [...base].every(isH) ? base.slice(1) : base;
  const last = given[given.length - 1];
  return isH(last) ? given + ((last.charCodeAt(0) - 0xac00) % 28 ? '아' : '야') : given;
}

// 아직 안 끝낸 학생 이름과 남은 것: 김하준(숙제), 이서윤(강의, 숙제). 숙제가 없는 강의는 이름만
function missText(p, st) {
  if (!st || st.hw == null) return p.name;
  const left = [!p.watched ? '강의' : '', !p.hw ? '숙제' : ''].filter(Boolean);
  return left.length ? `${p.name}(${left.join(', ')})` : p.name;
}

// 단톡방에 붙여 넣을 과제 알림
function reminderText(a, academy) {
  const st = a.stats || {};
  const names = (st.pending || []).map((p) => missText(p, st));
  const what = st.hw != null ? '끝까지 보고 숙제까지 내 주세요' : '끝까지 봐 주세요';
  const lines = [`[${academy}] ${a.class_name} 강의 과제 안내`, `「${a.title}」 강의를 ${a.due_at ? `${fmtDate(a.due_at)}까지 ` : ''}${what}.`];
  if (names.length) lines.push(`아직 끝내지 않은 학생: ${names.join(', ')}`);
  lines.push(`강의실: ${location.origin}`);
  return lines.join('\n');
}


// ---------------------------------------------------------------- 어디서나 여는 과제 내기 창
let assignSetter = null;
export function openAssign(opts = {}) {
  if (assignSetter) assignSetter(opts);
}
function AssignHost() {
  const [o, setO] = useState(null);
  useEffect(() => {
    assignSetter = setO;
    return () => {
      assignSetter = null;
    };
  }, []);
  return o ? html`<${AssignModal} ...${o} onClose=${() => setO(null)} />` : null;
}

function useLite(route) {
  const [d, setD] = useState(null);
  const load = () => api('/api/admin/dashboard?lite=1').then(setD).catch(() => {});
  useEffect(() => {
    load();
  }, [route]);
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  useEvent('ivy:changed', load);
  return d;
}

// ================================================================ 뼈대
export function TeacherApp({ info, me, onLogout, onInfo }) {
  const raw = useRoute();
  const route = mapOld(raw);
  useEffect(() => {
    if (route !== raw) history.replaceState(null, '', `#${route}`);
  }, [route, raw]);
  const [path, qs = ''] = route.split('?');
  const query = new URLSearchParams(qs);
  const parts = path.split('/');
  const p1 = parts[1] || '';
  const sec = SECTION[p1] || '';
  const lite = useLite(route);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('.backdrop')) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setPalette(false), [route]);

  let page;
  if (!p1) page = html`<${Today} me=${me} info=${info} />`;
  else if (p1 === 'new') page = html`<${Composer} mode0=${query.get('mode')} />`;
  else if (p1 === 'lectures') page = html`<${Lectures} f0=${query.get('f') || ''} />`;
  else if (p1 === 'lecture') page = html`<${LectureDetail} id=${parts[2]} key=${parts[2]} info=${info} />`;
  else if (p1 === 'review') page = html`<${Review} id=${parts[2]} key=${parts[2]} />`;
  else if (p1 === 'edit') page = html`<${Editor} id=${parts[2]} key=${parts[2]} />`;
  else if (p1 === 'exams') {
    if (parts[2] === 'new') page = html`<${ExamBuilder} key=${`new${qs}`} lectureId=${query.get('l')} fromId=${query.get('from')} />`;
    else if (/^\d+$/.test(parts[2] || '') && parts[3] === 'edit') page = html`<${ExamBuilder} key=${`edit${parts[2]}`} editId=${parts[2]} />`;
    else if (/^\d+$/.test(parts[2] || '')) page = html`<${ExamDetail} id=${parts[2]} key=${parts[2]} />`;
    else page = html`<${ExamsPage} />`;
  }
  else if (p1 === 'classes') page = html`<${ClassHub} sel0=${parts[2]} tab0=${parts[3] || query.get('tab')} qs=${qs} info=${info} ltNew=${lite && lite.counts ? lite.counts.lt_new || 0 : 0} />`;
  else if (p1 === 'settings') page = html`<${SettingsPage} section=${parts[2] || 'academy'} rc=${query.get('rc')} info=${info} me=${me} onInfo=${onInfo} onLogout=${onLogout} />`;
  else page = html`<div class="page"><${Empty} title="없는 화면이에요" action=${html`<${Btn} onClick=${() => go('/')}>오늘로</${Btn}>`} /></div>`;

  const review = lite && lite.counts ? lite.counts.review : 0;
  const ltNew = lite && lite.counts ? lite.counts.lt_new || 0 : 0;
  const eng = lite && lite.engine;
  const on = eng && engineOnline(eng.last_seen);
  const engTitle = !eng ? '제작 엔진' : on ? `제작 엔진 켜짐: ${(eng.info && eng.info.host) || '학원 PC'}` : eng.connected ? `제작 엔진 꺼짐, 마지막 연결 ${ago(eng.last_seen)}` : '제작 엔진 연결 전';
  return html`<div class="t-app">
    <header class="tbar chalkboard">
      <div class="tbar-in">
        <a class="tb-brand" href="#/" aria-label=${`${info.app_name}, 오늘`}><span class="mark">${info.logo_url ? html`<img src=${info.logo_url} alt="" />` : html`<${Icon} name="penLine" size="sm" />`}</span><span class="bt">${info.app_name}</span></a>
        <span class="tb-title">${TITLES[p1] || info.app_name}</span>
        <nav class="tb-nav" aria-label="메뉴">${NAV.map(([p, label, key]) => html`<a href=${'#' + p} class=${sec === key ? 'on' : ''} aria-current=${sec === key ? 'page' : undefined}>${label}
          ${key === 'lectures' && review > 0 && html`<span class="badge num" title=${`검수 대기 ${review}개`}>${review}</span>`}${key === 'classes' && ltNew > 0 && html`<span class="badge num" title=${`새 레벨테스트 결과 ${ltNew}개`}>${ltNew}</span>`}${sec === key && html`<${ChalkLine} key=${route.split('/')[1] || 'today'} />`}</a>`)}</nav>
        <span class="spacer hide-m"></span>
        <button class="tb-search" onClick=${() => setPalette(true)} aria-label="찾기" title=${`찾기 (${MOD_KEY} K)`}><${Icon} name="search" size="sm" /><span>강의, 반, 학생 찾기</span><kbd>${MOD_KEY} K</kbd></button>
        <a class="btn chalk sm tb-new" href="#/new"><${Icon} name="plus" size="sm" />새 강의</a>
        <button class="tb-ico" title=${engTitle} aria-label=${engTitle} onClick=${() => go('/settings/engine')}><span class=${`eng-dot ${on ? 'on' : eng && eng.connected ? 'off' : ''}`}></span></button>
        <${MeMenu} me=${me} onLogout=${onLogout} />
      </div>
    </header>
    <main class="t-main">${page}</main>
    <nav class="t-tabs" aria-label="메뉴">
      ${NAV.slice(0, 2).map(([p, label, key, ic]) => html`<a href=${'#' + p} class=${sec === key ? 'on' : ''}><${Icon} name=${ic} size="lg" />${label}${key === 'lectures' && review > 0 && html`<span class="tb-badge num">${review}</span>`}</a>`)}
      <a class="plus" href="#/new" aria-label="새 강의"><span><${Icon} name="plus" size="lg" /></span></a>
      ${NAV.slice(2).map(([p, label, key, ic]) => html`<a href=${'#' + p} class=${sec === key ? 'on' : ''}><${Icon} name=${ic} size="lg" />${label}${key === 'classes' && ltNew > 0 && html`<span class="tb-badge num">${ltNew}</span>`}</a>`)}
    </nav>
    ${palette && html`<${Palette} onClose=${() => setPalette(false)} onLogout=${onLogout} />`}
    <${AssignHost} />
  </div>`;
}

function MeMenu({ me, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return html`<div class="tb-me" ref=${ref}>
    <button class="avatar-btn" aria-haspopup="menu" aria-expanded=${open} title=${me.name} onClick=${() => setOpen(!open)}>${initial(me.name)}</button>
    ${open && html`<div class="pop" role="menu">
      <div class="pop-h"><div style="font-weight:750">${me.name}</div><div class="faint" style="font-size:12.5px">관리자, 아이디 ${me.login_id}</div></div>
      <a href="#/settings/account" role="menuitem" onClick=${() => setOpen(false)}><${Icon} name="user" />내 계정</a>
      <a href="#/settings/preview" role="menuitem" onClick=${() => setOpen(false)}><${Icon} name="phone" />학생 화면 보기</a>
      <button class="pi" role="menuitem" onClick=${() => { setOpen(false); onLogout(); }}><${Icon} name="logout" />로그아웃</button>
    </div>`}
  </div>`;
}

// ================================================================ 빠른 찾기 (Ctrl+K)
let palCache = null;
function Palette({ onClose, onLogout }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [data, setData] = useState(palCache);
  const inp = useRef(null);
  const box = useRef(null);
  useEffect(() => {
    if (inp.current) inp.current.focus();
    if (!palCache || Date.now() - palCache.t > 60000) {
      Promise.all([api('/api/admin/lectures'), api('/api/admin/classes'), api('/api/admin/students')])
        .then(([l, c, s]) => {
          palCache = { t: Date.now(), lectures: l.lectures, classes: c.classes, students: s.students };
          setData(palCache);
        })
        .catch(() => setData({ lectures: [], classes: [], students: [] }));
    }
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, []);
  const run = (it) => {
    onClose();
    if (typeof it.to === 'function') it.to();
    else go(it.to);
  };
  const acts = [
    { icon: 'sparkles', label: '새 강의 만들기', hint: '지문을 붙여 넣어 판서 강의를 만들어요', to: '/new' },
    { icon: 'upload', label: '내 영상 올리기', hint: '직접 찍은 강의 영상을 올려요', to: '/new?mode=upload' },
    { icon: 'send', label: '과제 내기', hint: '완성된 강의를 반에 내요', to: () => openAssign({}) },
    { icon: 'userPlus', label: '학생 넣기', to: () => go(`/classes?add=${Date.now()}`) },
    { icon: 'plus', label: '반 만들기', to: () => go(`/classes?new=${Date.now()}`) },
    { icon: 'chart', label: '시청표 보기', hint: '학생마다 강의를 얼마나 봤는지', to: '/classes?tab=watch' },
    { icon: 'clipboardCheck', label: '시험 만들기', hint: '확인 문제와 문제 은행에서 골라 시험지를 만들어요', to: '/exams/new' },
    { icon: 'list', label: '시험 목록', hint: '만든 시험, 인쇄, 반에 내기, 결과', to: '/exams' },
    { icon: 'trophy', label: '성적 보기', hint: '반 학생들의 확인 문제, 숙제, 시험 점수', to: '/classes?tab=scores' },
    { icon: 'clipboard', label: '레벨테스트', hint: '시험 링크 보내기, 결과와 리포트', to: '/classes/lt' },
    { icon: 'type', label: '판서 스타일', to: '/settings/board' },
    { icon: 'cpu', label: '제작 엔진', to: '/settings/engine' },
    { icon: 'phone', label: '학생 화면 보기', to: '/settings/preview' },
    { icon: 'school', label: '학원 정보', to: '/settings' },
    { icon: 'logout', label: '로그아웃', to: onLogout },
  ];
  // 앞부분이 맞는 것부터: 묶음 안에서도, 묶음끼리도 점수 높은 쪽이 위로 와요
  const best = (fields) => Math.max(...fields.map((x) => matchScore(x, q)));
  const rank = (list) => list.filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
  let groups = [];
  const A = rank(acts.map((a) => ({ ...a, sc: best([a.label]) })));
  if (A.length) groups.push(['할 일', q ? A : A.slice(0, 5)]);
  if (data) {
    const L = rank(data.lectures.map((l) => ({ icon: l.status === 'done' ? 'video' : 'hourglass', label: l.title, hint: [l.source, STATUS[l.status] ? STATUS[l.status][0] : ''].filter(Boolean).join(', '), to: `/lecture/${l.id}`, sc: best([l.title, l.source]) }))).slice(0, q ? 8 : 5);
    if (L.length) groups.push([q ? '강의' : '최근 강의', L]);
    if (q) {
      const C = rank(data.classes.map((c) => ({ icon: 'users', label: c.name, hint: `학생 ${c.students}명`, to: `/classes/${c.id}`, sc: best([c.name]) }))).slice(0, 5);
      if (C.length) groups.push(['반', C]);
      const S = rank(data.students.map((x) => ({ icon: 'user', label: x.name, hint: `${x.class_name || '반 없음'}, 아이디 ${x.login_id}`, to: `/classes/${x.class_id || 'none'}/students?s=${x.id}`, sc: best([x.name, x.login_id]) }))).slice(0, 8);
      if (S.length) groups.push(['학생', S]);
      groups = groups.map((g, i) => [g, i]).sort((a, b) => b[0][1][0].sc - a[0][1][0].sc || a[1] - b[1]).map((x) => x[0]);
    }
  }
  const flat = groups.flatMap((g) => g[1]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const el = box.current && box.current.querySelector('.po.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[sel]) run(flat[sel]);
    }
  };
  let k = -1;
  return html`<div class="palette-bd" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="빠른 찾기">
      <div class="pin"><${Icon} name="search" size="lg" />
        <input ref=${inp} value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${onKey} placeholder="강의, 반, 학생, 할 일 찾기 (초성도 돼요)" aria-label="찾기" autocomplete="off" spellcheck="false" />
        <kbd class="hide-m">Esc</kbd><button class="btn ghost sm hide-d" onClick=${onClose}>닫기</button></div>
      <div class="pres" ref=${box} role="listbox">
        ${groups.map(([g, items]) => html`<div class="pg">${g}</div>${items.map((it) => {
          k += 1;
          const i = k;
          return html`<button class=${`po ${i === sel ? 'on' : ''}`} role="option" aria-selected=${i === sel} onMouseMove=${() => sel !== i && setSel(i)} onClick=${() => run(it)}>
            <span class="pi"><${Icon} name=${it.icon} size="sm" /></span><span class="pt"><div>${it.label}</div>${it.hint && html`<small>${it.hint}</small>`}</span></button>`;
        })}`)}
        ${!flat.length && html`<div class="pempty">${data ? `'${q}'에 맞는 것이 없어요` : '불러오는 중…'}</div>`}
      </div>
      <div class="pfoot hide-m"><span>↑↓ 고르기</span><span>Enter 열기</span><span>${MOD_KEY} K 열고 닫기</span></div>
    </div>
  </div>`;
}

// ================================================================ 표지 (썸네일이 없으면 작은 칠판)
export function Cover({ lec, sm }) {
  const working = WORKING.includes(lec.status);
  const dim = working || ['review', 'failed', 'manual'].includes(lec.status);
  return html`<div class=${`cover chalkboard ${sm ? 'sm' : ''} ${dim ? 'work' : ''}`}>
    ${lec.has_thumb ? html`<img src=${`/media/lecture/${lec.id}/thumb`} alt="" loading="lazy" />`
      : html`<div class="cv"><div class="cs">${lec.source || (lec.tool === 'manual' ? '내가 찍은 강의' : '지문 강의')}</div><div class="ctt">${lec.title}</div></div>`}
    ${!sm && lec.status !== 'done' && html`<div class="state"><${StatusChip} status=${lec.status} /></div>`}
    ${lec.status === 'done' && lec.duration ? html`<span class="dur num">${fmtDur(lec.duration)}</span>` : null}
    ${!sm && working && lec.progress > 0 ? html`<div class="prog"><${Bar} value=${lec.progress} thin /></div>` : null}
  </div>`;
}

// 과제 한 줄: 반, 마감, 끝낸 학생(강의를 다 보고 숙제까지), 강의, 확인 문제, 숙제를 한 학생 수, 아직 안 끝낸 학생, 알림 문구 복사
function AsgRow({ a, academy, showClass = true, showTitle = true, onClick, actions }) {
  const d = dueLabel(a.due_at);
  const st = a.stats || { total: 0, done: 0, watched: 0, quiz: null, hw: null };
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const left = st.total - st.done;
  const pend = st.pending;
  const kinds = [['강의', st.watched], ['확인 문제', st.quiz], ['숙제', st.hw]].filter(([, n]) => n != null);
  return html`<li class=${`asg ${onClick ? 'click' : ''} ${a.closed_at ? 'closed' : ''}`} onClick=${onClick}>
    <div class="asg-top">
      ${showClass && html`<span class="cls-tag" style=${a.class_color ? `--c:${a.class_color}` : ''}>${a.class_name}</span>`}
      ${showTitle ? html`<b class="asg-t ellipsis">${a.title}</b>` : null}
      <span class="spacer"></span>
      ${a.closed_at ? html`<span class="chip">목록에서 지움</span>` : d ? html`<span class=${`chip ${d.tone}`}>${d.text}</span>` : html`<span class="chip">마감 없음</span>`}
      ${actions}
    </div>
    <div class="asg-prog"><${Bar} value=${pct} /><span class="n num">${st.done}/${st.total}명 끝냄</span></div>
    ${st.total > 0 && kinds.length > 1 && html`<div class="asg-kinds">${kinds.map(([t, n]) => html`<span class=${n >= st.total ? 'full' : ''}>${t} <b class="num">${n}/${st.total}</b></span>`)}</div>`}
    ${st.total > 0 && left > 0 && html`<div class="asg-pend">
      <span>아직 ${pend && pend.length ? html`<b>${pend.slice(0, 5).map((p) => missText(p, st)).join(', ')}</b>${left > 5 ? ` 외 ${left - 5}명` : ''}` : html`<b>${left}명</b>`}</span>
      ${pend && html`<button class="btn link" onClick=${(e) => { e.stopPropagation(); copyText(reminderText(a, academy)); }}>알림 문구 복사</button>`}</div>`}
    ${st.total > 0 && left === 0 && html`<div class="asg-all"><${Icon} name="checkCircle" size="sm" />${st.hw != null ? '모두 강의를 다 보고 숙제까지 냈어요' : '모두 다 봤어요'}</div>`}
  </li>`;
}

// ================================================================ 오늘
function buildTodos(data, on, academy) {
  const out = [];
  const c = data.counts;
  for (const j of data.jobs.filter((x) => x.status === 'review')) out.push({ text: `「${j.title}」 대본과 판서를 확인해 주세요`, sub: j.source, go: '검수하기', act: () => go(`/review/${j.id}`) });
  for (const j of data.jobs.filter((x) => x.status === 'failed')) out.push({ text: `「${j.title}」 만들기가 멈췄어요`, sub: j.error, go: '살펴보기', act: () => go(`/lecture/${j.id}`) });
  const soon = Date.now() + 2 * 86400000;
  for (const a of data.assignments) {
    const left = a.stats.total - a.stats.done;
    if (!a.due_at || left <= 0 || a.due_at * 1000 < Date.now() || a.due_at * 1000 > soon) continue;
    out.push({
      text: `${a.class_name} 「${a.title}」 ${dueLabel(a.due_at).text}, 아직 ${left}명이 끝내지 않았어요`,
      sub: (a.stats.pending || []).slice(0, 8).map((p) => missText(p, a.stats)).join(', '),
      go: '알림 문구 복사',
      act: () => copyText(reminderText(a, academy)),
    });
  }
  if (c.lt_new > 0) out.push({ text: `새 레벨테스트 결과가 ${c.lt_new}개 있어요`, sub: '결과를 확인하고 학부모님께 리포트를 보내 주세요', go: '결과 보기', act: () => go('/classes/lt') });
  if (!data.engine.connected) out.push({ text: '학원 PC에 제작 엔진을 설치해 주세요', sub: '설치 파일 하나만 실행하면 돼요', go: '설치하기', act: () => go('/settings/engine') });
  else if (!on && c.working > 0) out.push({ text: `강의 ${c.working}개가 제작 엔진을 기다리고 있어요`, sub: '학원 PC에서 제작 엔진을 켜 주세요', go: '엔진 보기', act: () => go('/settings/engine') });
  if (!c.classes) out.push({ text: '반을 만들고 학생을 넣어 주세요', sub: '학생은 받은 아이디로 휴대폰에서 강의를 봐요', go: '반 만들기', act: () => go(`/classes?new=${Date.now()}`) });
  // 복구 코드가 없으면 할 일이 많아도 이 줄은 꼭 보여요
  const rec = data.recovery_ready === false ? { text: '비밀번호를 잊을 때를 대비해 복구 코드를 만들어 두세요', sub: '사진이나 종이로 보관해 두면 언제든 새 비밀번호를 정할 수 있어요', go: '만들기', act: () => go('/settings/account?rc=1') } : null;
  return rec ? [...out.slice(0, 5), rec] : out.slice(0, 6);
}

function Today({ me, info }) {
  const { data, loading, reload } = useAsync(() => api('/api/admin/dashboard'), []);
  useEvent('ivy:changed', () => reload(true));
  useEffect(() => {
    const working = data && data.jobs.some((j) => WORKING.includes(j.status));
    const t = setInterval(() => reload(true), working ? 6000 : 30000);
    return () => clearInterval(t);
  }, [data]);
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`;
  if (loading && !data) return html`<div class="page"><div class="today chalkboard" style="min-height:190px"></div><div class="today-grid"><${Skel} h=${260} /><${Skel} h=${260} /></div></div>`;
  if (!data) return html`<div class="page"><${Empty} title="불러오지 못했어요" action=${html`<${Btn} onClick=${() => reload()}>다시 시도</${Btn}>`} /></div>`;
  const eng = data.engine;
  const on = engineOnline(eng.last_seen);
  const academy = data.academy_name || info.academy_name;
  const todos = buildTodos(data, on, academy);
  const engLine = on ? `제작 엔진 켜짐, ${(eng.info && eng.info.status) || '대기 중'}` : eng.connected ? `제작 엔진 꺼짐, ${ago(eng.last_seen)}` : '제작 엔진 연결 전';
  return html`<div class="page">
    <section class="today chalkboard" aria-label="오늘 할 일">
      <div class="today-top">
        <div><div class="date">${dateStr}</div><h1>안녕하세요, ${me.name}</h1></div>
        <button class="eng" onClick=${() => go('/settings/engine')}><span class=${`eng-dot ${on ? 'on' : eng.connected ? 'off' : ''}`}></span>${engLine}</button>
      </div>
      ${todos.length ? html`<ul class="todo">${todos.map((t) => html`<li><button class="todo-i" onClick=${t.act}><span class="box"></span>
          <span class="tx">${t.text}${t.sub ? html`<small class="ellipsis">${t.sub}</small>` : null}</span><span class="go">${t.go}<${Icon} name="chevronRight" size="sm" /></span></button></li>`)}</ul>`
        : html`<div class="todo-calm"><span>오늘 챙길 일은 없어요. 새 지문으로 강의를 만들어 볼까요?</span><a class="btn chalk sm" href="#/new"><${Icon} name="plus" size="sm" />새 강의</a></div>`}
    </section>
    <div class="today-grid">
      <section class="panel">
        <div class="panel-h"><h2>진행 중인 과제</h2>${data.assignments.length > 0 && html`<span class="count num">${data.assignments.length}</span>`}<span class="spacer"></span>
          ${data.assignments.length > 0 && html`<${Btn} kind="ghost" size="sm" icon="send" onClick=${() => openAssign({})}>과제 내기</${Btn}>`}</div>
        ${data.assignments.length ? html`<ul class="rows">${data.assignments.map((a) => html`<${AsgRow} a=${a} academy=${academy} onClick=${() => go(`/classes/${a.class_id}`)} />`)}</ul>`
          : html`<${Empty} icon="send" title="진행 중인 과제가 없어요" action=${html`<${Btn} kind="soft" icon="send" onClick=${() => openAssign({})}>과제 내기</${Btn}>`}>완성된 강의를 반에 내면, 누가 다 봤는지 여기서 바로 보여요.</${Empty}>`}
      </section>
      <div class="stack lg">
        <section class="panel">
          <div class="panel-h"><h2>만드는 강의</h2><span class="spacer"></span><a class="btn ghost sm" href="#/lectures">강의 전체<${Icon} name="chevronRight" size="sm" /></a></div>
          ${data.jobs.length ? html`<ul class="rows">${data.jobs.map((j) => html`<li class="click" onClick=${() => go(`/lecture/${j.id}`)}>
              <div class="row" style="gap:10px"><b class="ellipsis" style="flex:1;min-width:0">${j.title}</b><${StatusChip} status=${j.status} /></div>
              ${(j.progress_msg || j.source) && html`<div class="faint ellipsis" style="font-size:13px;margin-top:2px">${j.progress_msg || j.source}</div>`}
              ${WORKING.includes(j.status) && j.progress > 0 && html`<div style="margin-top:8px"><${Bar} value=${j.progress} thin tone="seen" /></div>`}</li>`)}</ul>`
            : html`<${Empty} icon="sparkles" title="만드는 강의가 없어요">지문을 넣으면 학원 PC가 판서 강의 영상을 만들어요.</${Empty}>`}
        </section>
        <section class="panel">
          <div class="panel-h"><h2>최근 시청</h2></div>
          ${data.recent.length ? html`<ul class="rows feed">${data.recent.map((r) => html`<li class=${r.class_id ? 'click' : ''} onClick=${() => r.class_id && go(`/classes/${r.class_id}/watch`)}>
              <div class="avatar">${initial(r.student)}</div>
              <div style="flex:1;min-width:0"><div class="ellipsis"><span class="who">${r.student}</span> <span class="faint" style="font-size:13px">${r.class_name || ''}</span></div><div class="what ellipsis">${r.title}</div></div>
              <div class="pct"><div class="num" style=${`color:${r.completed_at ? 'var(--green)' : 'var(--ink)'}`}>${r.percent}%</div><div class="faint" style="font-size:12px;font-weight:500">${ago(r.updated_at)}</div></div></li>`)}</ul>`
            : html`<${Empty} icon="eye" title="아직 시청 기록이 없어요">학생이 강의를 보면 여기에 바로 나타나요.</${Empty}>`}
        </section>
      </div>
    </div>
  </div>`;
}

// ================================================================ 강의 목록
// 예전 강의(확인 문제, 숙제 기능이 생기기 전에 만든 강의)에 한 번에 만들기. 강의마다 Claude 사용료가 들어서 버튼으로 둬요
function BackfillBar() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/admin/backfill').then(setD).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!d || !d.working) return undefined;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [d && d.working]);
  if (!d) return null;
  if (d.working > 0) {
    return html`<div class="notice bf-bar"><${Icon} name="sparkles" /><div><b>예전 강의의 확인 문제와 숙제를 만드는 중이에요</b>
      <div class="muted" style="font-size:13px">남은 작업 ${d.working}개예요. 학원 PC 제작 엔진이 새 강의와 레벨테스트 채점을 먼저 하고, 쉬는 동안 차례대로 만들어요.</div></div></div>`;
  }
  if (!d.lectures) return null;
  const make = async () => {
    const parts = [d.quiz ? `확인 문제 ${d.quiz}개` : '', d.bank ? `숙제 문제 ${d.bank}개` : ''].filter(Boolean).join(', ');
    const body = parts
      ? `${parts}를 학원 PC 제작 엔진이 차례대로 만들어요. 새 강의와 레벨테스트 채점을 먼저 하고, 강의마다 Claude 사용료가 들어요. 숙제 문제가 다 만들어지면 사이트 숙제도 저절로 생겨요.`
      : '이미 만들어 둔 문제로 사이트 숙제를 바로 뽑아요.';
    if (!(await confirmBox({ title: `강의 ${d.lectures}개에 확인 문제와 숙제를 만들까요?`, body, ok: '만들기' }))) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/backfill', { method: 'POST', body: {} });
      toast(r.quiz || r.bank ? `강의 ${r.lectures}개를 만들기 시작했어요` : `숙제 ${r.hw}개를 뽑았어요`);
      load();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<div class="notice amber bf-bar"><${Icon} name="circleHelp" /><div style="flex:1;min-width:0"><b>확인 문제나 숙제가 없는 강의가 ${d.lectures}개 있어요</b>
      <div class="muted" style="font-size:13px">확인 문제와 숙제는 새로 만든 강의에만 저절로 생겨요. 그 전에 만든 강의는 여기서 한 번에 만들 수 있어요.</div></div>
    <${Btn} kind="soft" size="sm" icon="sparkles" busy=${busy} onClick=${make}>한 번에 만들기</${Btn}></div>`;
}

function Lectures({ f0 }) {
  const [filter, setFilter] = useState(f0);
  const [q, setQ] = useState('');
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('ivy.lview') || 'tiles';
    } catch {
      return 'tiles';
    }
  });
  const { data, loading, reload } = useAsync(() => api('/api/admin/lectures'), []);
  useEffect(() => setFilter(f0), [f0]);
  useEffect(() => {
    const working = data && data.lectures.some((l) => WORKING.includes(l.status));
    if (!working) return;
    const t = setInterval(() => reload(true), 6000);
    return () => clearInterval(t);
  }, [data]);
  const setV = (v) => {
    setView(v);
    try {
      localStorage.setItem('ivy.lview', v);
    } catch {
      /* 저장 못 해도 괜찮아요 */
    }
  };
  // 학년으로 나눠 봐요 (고른 학년은 다음에도 그대로)
  const [grade, setGrade] = useState(() => {
    try {
      const v = localStorage.getItem('ivy.lgrade') || '';
      return LEVEL_NAME[v] || v === 'none' ? v : '';
    } catch {
      return '';
    }
  });
  const setG = (g) => {
    setGrade(g);
    try {
      localStorage.setItem('ivy.lgrade', g);
    } catch {
      /* 저장 못 해도 괜찮아요 */
    }
  };
  const every = data ? data.lectures : [];
  const gradeCount = (g) => every.filter((l) => (g === 'none' ? !levelOf(l) : levelOf(l) === g)).length;
  const grades = [...LEVELS.map(([k, t]) => [k, t]), ['none', '학년 없음']].filter(([k]) => gradeCount(k) > 0 || grade === k);
  const all = grade ? every.filter((l) => (grade === 'none' ? !levelOf(l) : levelOf(l) === grade)) : every;
  const by = {
    '': all,
    working: all.filter((l) => WORKING.includes(l.status)),
    review: all.filter((l) => l.status === 'review'),
    done: all.filter((l) => l.status === 'done'),
    failed: all.filter((l) => l.status === 'failed'),
  };
  const tabs = [['', '전체'], ['working', '만드는 중'], ['review', '검수 대기'], ['done', '완성'], ['failed', '실패']].filter(([k]) => !k || k === 'done' || by[k].length || filter === k);
  const list = (by[filter] || all).filter((l) => matches(l.title, q) || matches(l.source, q));
  return html`<div class="page">
    <div class="ph lec-ph"><div><h1>강의</h1><div class="sub">만든 강의와 올린 강의가 모두 여기 있어요.</div></div>
      <div class="actions">
        <div class="search-in"><${Icon} name="search" size="sm" /><input class="input" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="제목, 출처로 찾기" aria-label="강의 찾기" /></div>
        <${Seg} value=${view} onChange=${setV} label="보기 방식" options=${[['tiles', html`<${Icon} name="grid" size="sm" />`, '표지로 보기'], ['rows', html`<${Icon} name="listOrdered" size="sm" />`, '목록으로 보기']]} />
        <a class="btn secondary" href="#/exams" title="확인 문제와 문제 은행에서 골라 시험지를 만들어요"><${Icon} name="clipboardCheck" />시험</a>
        <a class="btn primary" href="#/new"><${Icon} name="plus" />새 강의</a>
      </div></div>
    ${every.some((l) => l.status === 'done') && html`<${BackfillBar} />`}
    ${every.length > 0 && html`<div class="pick-row grade-row" role="group" aria-label="학년">
      <button type="button" class=${`pick ${!grade ? 'on' : ''}`} aria-pressed=${!grade} onClick=${() => setG('')}>모든 학년<small>${every.length}</small></button>
      ${grades.map(([k, t]) => html`<button type="button" class=${`pick ${grade === k ? 'on' : ''}`} aria-pressed=${grade === k} onClick=${() => setG(k)}>${t}<small>${gradeCount(k)}</small></button>`)}</div>`}
    <div class="tabs" role="tablist">${tabs.map(([k, label]) => html`<button role="tab" aria-selected=${filter === k} class=${filter === k ? 'on' : ''} onClick=${() => setFilter(k)}>${label}<span class="n num">${by[k].length}</span></button>`)}</div>
    ${loading && !data ? html`<div class="tiles">${[1, 2, 3, 4].map(() => html`<div><div class="skel" style="aspect-ratio:16/9;margin-bottom:10px"></div><${Skel} h=${16} w="80%" /><${Skel} h=${12} w="50%" /></div>`)}</div>`
      : list.length ? (view === 'rows'
        ? html`<div class="panel"><ul class="rows lrows">${list.map((l) => html`<li class="click" onClick=${() => go(`/lecture/${l.id}`)}>
            <${Cover} lec=${l} sm />
            <div style="min-width:0"><div class="lt clamp2">${l.title}</div><div class="ls ellipsis">${l.source || (l.tool === 'manual' ? '내가 찍은 강의' : '출처 없음')}</div></div>
            <div class="lm">${levelOf(l) && html`<span class="chip">${LEVEL_NAME[levelOf(l)]}</span>`}${l.status !== 'done' ? html`<${StatusChip} status=${l.status} />`
              : html`${l.duration ? html`<span class="num">${fmtDur(l.duration)}</span>` : null}${l.assigned_classes ? html`<span class="chip ivy">${l.assigned_classes}개 반 과제</span>` : html`<span class="chip">과제 전</span>`}`}
              <span class="hide-m">${ago(l.updated_at)}</span></div></li>`)}</ul></div>`
        : html`<div class="tiles">${list.map((l) => html`<a class="tile" href=${`#/lecture/${l.id}`}>
            <${Cover} lec=${l} />
            <div class="tb"><div class="tt clamp2">${l.title}</div>
              <div class="ts ellipsis">${l.source || (l.tool === 'manual' ? '내가 찍은 강의' : '출처 없음')}</div>
              <div class="tmeta">${levelOf(l) && html`<span class="chip grade">${LEVEL_NAME[levelOf(l)]}</span>`}${l.status === 'done'
                ? html`${l.assigned_classes ? html`<span class="chip ivy">${l.assigned_classes}개 반 과제</span>` : html`<span class="chip">과제 전</span>`}<span>${ago(l.done_at || l.updated_at)}</span>`
                : html`<span class="ellipsis">${l.status === 'review' ? '대본과 판서를 확인해 주세요' : l.status === 'failed' ? '다시 시도할 수 있어요' : l.progress_msg && (!STATUS[l.status] || l.progress_msg !== STATUS[l.status][0]) ? l.progress_msg : `${ago(l.updated_at)} 요청`}</span>`}</div></div></a>`)}</div>`)
      : html`<div class="panel"><${Empty} icon="library" title=${filter || q ? '찾는 강의가 없어요' : grade ? `${grade === 'none' ? '학년을 정하지 않은' : LEVEL_NAME[grade]} 강의가 아직 없어요` : '아직 강의가 없어요'}
          action=${!filter && !q && html`<a class="btn soft" href="#/new"><${Icon} name="plus" />새 강의 만들기</a>`}>${filter || q ? '다른 말로 찾아보세요. 초성(ㅁㅅ)으로도 찾을 수 있어요.' : '지문을 넣거나 영상을 올리면 여기에 모여요.'}</${Empty}></div>`}
  </div>`;
}

// ================================================================ 새 강의 (한 화면에서)
const LEVELS = [['mid1', '중1'], ['mid2', '중2'], ['mid3', '중3'], ['high1', '고1'], ['high2', '고2'], ['high3', '고3']];
const LEVEL_NAME = Object.fromEntries(LEVELS);
const levelOf = (l) => (l && l.options && LEVEL_NAME[l.options.level] ? l.options.level : '');
// 새 강의 학년은 마지막에 고른 학년으로 시작해요 (중1 강의를 이어서 만들 때 편하게)
function lastLevel() {
  try {
    const v = localStorage.getItem('ivy.level');
    return LEVEL_NAME[v] ? v : 'high1';
  } catch {
    return 'high1';
  }
}
function keepLevel(v) {
  try {
    localStorage.setItem('ivy.level', v);
  } catch {
    /* 저장 못 해도 괜찮아요 */
  }
}
// 강의 말투: 반말 강의체, 반존대(존댓말에 반말을 섞어요), 존댓말
const TONE_OPTS = [['banmal', '반말', '반말 강의체'], ['banjon', '반존대', '존댓말을 바탕으로 반말을 섞어요'], ['jondaet', '존댓말', '존댓말 강의체']];
const FOCUS = [['balanced', '골고루'], ['grammar', '어법'], ['reading', '독해 흐름'], ['vocab', '어휘']];

// 붙여 넣은 자료를 정리한 결과 한 줄 (뺀 줄은 마우스를 올리면 보여요)
function prepSummary(p) {
  if (!p) return '자료를 정리했어요.';
  const bits = [];
  if (p.headings) bits.push(`소제목 ${p.headings}개를 따로 떼고`);
  if (p.dropped.length) {
    const why = {};
    for (const d of p.dropped) why[d.why] = (why[d.why] || 0) + 1;
    bits.push(`지문이 아닌 줄 ${p.dropped.length}개(${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')})를 빼고`);
  }
  bits.push('끊긴 줄을 이었어요');
  return `붙여 넣은 자료를 정리했어요: ${bits.join(', ')}.`;
}

function Composer({ mode0 }) {
  const [mode, setMode] = useState(mode0 === 'upload' ? 'upload' : 'passage');
  const [f, setF] = useState({ title: '', source: '', passage: '', translation: '' });
  const [o, setO] = useState({ minutes: 15, tone: 'banmal', focus: 'balanced', level: lastLevel(), practice: true, auto_approve: false, call_names: true, memo: '' });
  const setLevel = (v) => {
    setO((x) => ({ ...x, level: v }));
    keepLevel(v);
  };
  const [up, setUp] = useState({ auto_subtitle: true, auto_summary: true });
  const [files, setFiles] = useState({ video: null, note: null, practice: null });
  const [busy, setBusy] = useState(false);
  const [upPct, setUpPct] = useState(0);
  const [eng, setEng] = useState(null);
  const [showTr, setShowTr] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [undo, setUndo] = useState(null);
  const [prep, setPrep] = useState(null); // 붙여 넣은 자료를 정리한 결과 { dropped, headings }
  const [split, setSplit] = useState(null); // 나눠서 만들기: null 이면 길이에 따라 저절로
  const [drag, setDrag] = useState(false);
  const [photos, setPhotos] = useState([]); // 지문을 읽을 교과서 사진·PDF (올린 자료)
  const [reading, setReading] = useState(null); // 사진 읽기 작업 { id, status, progress, progress_msg, error }
  const [photoBusy, setPhotoBusy] = useState(false);
  const readDone = useRef(new Set()); // 지문 칸에 넣은 읽기 작업 (두 번 넣지 않게)
  // 사진 읽기 작업이 끝날 때까지 지켜봐요
  useEffect(() => {
    if (!reading || !['queued', 'running'].includes(reading.status)) return;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/admin/tasks/${reading.id}`);
        if (readDone.current.has(r.task.id)) return;
        if (r.task.status === 'done' || r.task.status === 'failed') readDone.current.add(r.task.id);
        setReading(r.task);
        if (r.task.status === 'done' && r.task.result) applyRead(r.task.result);
        if (r.task.status === 'failed') toast(`사진을 읽지 못했어요: ${r.task.error || ''}`, 'err');
      } catch (e) {
        if (e && e.status === 404) setReading(null);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [reading && reading.id, reading && reading.status]);
  useEffect(() => {
    api('/api/admin/settings').then((r) => {
      setEng(r.settings);
      setO((x) => ({ ...x, minutes: r.settings.default_minutes || 15, tone: r.settings.default_tone || 'banmal' }));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (mode0) setMode(mode0 === 'upload' ? 'upload' : 'passage');
  }, [mode0]);
  const switchMode = (m) => {
    setMode(m);
    history.replaceState(null, '', m === 'upload' ? '#/new?mode=upload' : '#/new');
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const upload = mode === 'upload';
  const text = f.passage.trim();
  const words = text ? text.replace(/^#+.*$/gm, '').split(/\s+/).filter(Boolean).length : 0;
  // 지문 구성: 소제목(## 줄)과 문단, 문장 수. 길면 소제목(없으면 문단)마다 나눠 강의 여러 개로 만들어요
  const ol = upload ? null : outline(f.passage);
  const sents = ol ? ol.total : 0;
  const parts = ol && sents >= 20 ? planParts(ol) : [];
  const mustSplit = sents > 40;
  const splitOn = parts.length >= 2 && (mustSplit || (split === null ? sents > 30 : split));
  const tooLong = !upload && !splitOn && (mustSplit || f.passage.length > 12000);
  const needsTidy = !undo && ((/[^\n]\n[^\n]/.test(f.passage) && f.passage.split('\n').length >= 3) || f.passage.split('\n').some((l) => !/^#/.test(l.trim()) && noiseLine(l)));
  const canGo = upload ? !!(f.title.trim() && files.video) : words >= 20 && !tooLong;
  // 붙여 넣는 순간 자료 정리: 끊긴 줄 잇기, 소제목 떼기, 쪽 번호·어휘 풀이 줄 빼기 (되돌리기 가능)
  const tidyNow = (raw) => {
    const r = prepareMaterial(raw);
    setUndo(raw);
    setF((x) => ({ ...x, passage: r.text }));
    setPrep({ dropped: r.dropped, headings: r.headings });
  };
  const onPaste = (e) => {
    const clip = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!clip || !/\n/.test(clip.trim())) return;
    const el = e.target;
    const raw = f.passage.slice(0, el.selectionStart) + clip + f.passage.slice(el.selectionEnd);
    if (prepareMaterial(raw).text === raw.trim()) return;
    e.preventDefault();
    tidyNow(raw);
  };
  const on = eng && engineOnline(eng.engine_last_seen);
  // 교과서 사진·PDF 올리기 → 학원 PC 엔진이 지문 글자를 읽어 칸을 채워요
  const readPhotos = async (list) => {
    try {
      const r = await api('/api/admin/materials/read', { method: 'POST', body: { ids: list.map((x) => x.id) } });
      setReading({ id: r.task_id, status: 'queued', progress: 0 });
    } catch (e) {
      toastErr(e);
    }
  };
  const pickPhotos = async (files) => {
    if (!files || !files.length) return;
    setPhotoBusy(true);
    const added = [];
    for (const file of [...files].slice(0, 12)) {
      try {
        added.push(await uploadMaterial(file, { purpose: 'passage' }));
      } catch (e) {
        toastErr(e);
      }
    }
    setPhotoBusy(false);
    if (!added.length) return;
    const all = [...photos, ...added];
    setPhotos(all);
    readPhotos(all);
  };
  const dropPhoto = async (x) => {
    try {
      await api(`/api/admin/materials/${x.id}`, { method: 'DELETE' });
    } catch {
      /* 이미 지워졌으면 그냥 빼요 */
    }
    setPhotos(photos.filter((y) => y.id !== x.id));
  };
  const applyRead = async (r) => {
    const cur = document.getElementById('psg');
    const has = cur && cur.value.trim();
    if (has && !(await confirmBox({ title: '지문 칸을 사진에서 읽은 글로 바꿀까요?', body: '지금 지문 칸에 있는 글은 지워져요.', ok: '바꾸기' }))) return;
    setF((x) => ({
      ...x,
      passage: r.passage || x.passage,
      title: x.title.trim() ? x.title : r.title || '',
      source: x.source.trim() ? x.source : r.source || '',
      translation: r.translation ? r.translation : x.translation,
    }));
    if (r.translation) setShowTr(true);
    setUndo(null);
    setPrep(null);
    toast(r.note ? `사진에서 지문을 읽었어요. ${r.note}` : '사진에서 지문을 읽었어요. 틀린 글자가 없는지 한 번 봐 주세요.');
  };
  const attachPhotos = async (lectureId) => {
    if (!photos.length) return;
    await api('/api/admin/materials/attach', { method: 'POST', body: { lecture_id: lectureId, ids: photos.map((x) => x.id) } }).catch(() => {});
  };
  const pickVideo = (file) => {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.mp4$/i.test(file.name)) return toast('MP4 영상 파일을 골라 주세요', 'err');
    setFiles((x) => ({ ...x, video: file }));
    if (!f.title.trim()) setF((x) => ({ ...x, title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 120) }));
  };
  const submit = async () => {
    if (!canGo || busy) return;
    setBusy(true);
    try {
      if (upload) {
        const dur = await videoDuration(files.video);
        const r = await api('/api/admin/lectures', { method: 'POST', body: { title: f.title, source: f.source, manual: true, tool: 'manual', options: { ...up, level: o.level } } });
        await uploadFile(files.video, r.id, 'video', (p) => setUpPct(Math.round(p * 0.85)), { duration: dur });
        const thumb = await videoThumb(files.video);
        if (thumb) await uploadFile(thumb, r.id, 'thumb').catch(() => {});
        if (files.note) await uploadFile(files.note, r.id, 'note');
        setUpPct(93);
        if (files.practice) await uploadFile(files.practice, r.id, 'practice');
        await api(`/api/admin/lectures/${r.id}/finish`, { method: 'POST', body: { duration: dur } });
        toast('강의를 올렸어요');
        emit('ivy:changed');
        go(`/lecture/${r.id}`);
      } else if (splitOn) {
        // 나눠서 만들기: 부마다 강의를 하나씩 만들어요 (제목·출처 뒤에 몇 부인지 붙여요)
        const N = parts.length;
        const trs = splitTranslation(f.translation, parts, sents);
        for (let i = 0; i < N; i++) {
          setUpPct(Math.round((i / N) * 100));
          const made = await api('/api/admin/lectures', {
            method: 'POST',
            body: {
              title: f.title.trim() ? `${f.title.trim()} ${i + 1}부` : '',
              source: f.source.trim() ? `${f.source.trim()} (${i + 1}/${N})` : `${i + 1}/${N}부`,
              passage: parts[i].text,
              translation: trs ? trs[i] : f.translation,
              tool: 'passage',
              options: o,
            },
          });
          if (i === 0) await attachPhotos(made.id);
        }
        toast(`강의 ${N}개를 만들도록 요청했어요`);
        emit('ivy:changed');
        go('/lectures');
      } else {
        const r = await api('/api/admin/lectures', { method: 'POST', body: { ...f, title: f.title.trim(), tool: 'passage', options: o } });
        await attachPhotos(r.id);
        toast('제작을 요청했어요');
        emit('ivy:changed');
        go(`/lecture/${r.id}`);
      }
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };
  const pdfRow = (k, label) => html`<label class="drop"><div class="di"><${Icon} name=${files[k] ? 'checkCircle' : 'file'} /></div>
    <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14.5px">${label}</div><div class="muted ellipsis" style="font-size:13px">${files[k] ? `${files[k].name}, ${fmtBytes(files[k].size)}` : 'PDF, 눌러서 고르기 (선택)'}</div></div>
    ${files[k] && html`<button class="btn ghost icon sm" aria-label="빼기" onClick=${(e) => { e.preventDefault(); setFiles({ ...files, [k]: null }); }}><${Icon} name="x" size="sm" /></button>`}
    <input type="file" accept="application/pdf" class="sr" onChange=${(e) => setFiles({ ...files, [k]: e.target.files[0] || null })} /></label>`;
  return html`<div class="page" onKeyDown=${onKey}>
    <div class="ph"><div><h1>새 강의</h1><div class="sub">${upload ? '직접 찍은 강의 영상을 올리면 자막, 목차, AI 요약을 붙여 학생에게 낼 수 있어요.' : '지문을 붙여 넣으면 판서 강의 영상과 판서노트, 연습지를 만들어요.'}</div></div>
      <div class="actions"><${Seg} value=${mode} onChange=${switchMode} label="만드는 방법" options=${[['passage', '지문으로 만들기'], ['upload', '내 영상 올리기']]} /></div></div>
    ${!upload ? html`<div class="composer">
      <div class="stack lg">
        <div class="grid2">
          <${Field} label="강의 제목" hint="비워 두면 AI가 지어요"><input value=${f.title} onInput=${set('title')} placeholder="예: 맹수는 정말 범인이었을까" /></${Field}>
          <${Field} label="출처" hint="판서 머리글과 강의 목록에 보여요"><input value=${f.source} onInput=${set('source')} placeholder="예: 올림포스 영어독해 기본 1, 18번" /></${Field}>
        </div>
        <div class="stack sm">
          <div class="row between" style="gap:10px"><label class="label" for="psg">영어 지문</label>
            <label class=${`btn secondary sm ${photoBusy ? 'busy' : ''}`} style="cursor:pointer"><${Icon} name="image" size="sm" />${photoBusy ? '올리는 중…' : '사진, PDF로 넣기'}
              <input type="file" multiple accept="image/*,application/pdf" class="sr" disabled=${photoBusy} onChange=${(e) => { pickPhotos(e.target.files); e.target.value = ''; }} /></label></div>
          ${photos.length > 0 && html`<div class="photo-box">
            <div class="photo-list">${photos.map((x) => html`<span class="photo-chip"><${Icon} name=${x.mime === 'application/pdf' ? 'fileText' : 'image'} size="sm" /><span class="ellipsis">${x.name}</span>
              <button class="btn ghost icon sm" aria-label="빼기" onClick=${() => dropPhoto(x)}><${Icon} name="x" size="sm" /></button></span>`)}</div>
            ${reading && ['queued', 'running'].includes(reading.status) && html`<div class="task-run"><div class="row between" style="font-size:13.5px"><b>${reading.status === 'queued' ? (on ? '엔진이 사진을 읽을 차례를 기다리는 중' : '제작 엔진이 꺼져 있어요. 학원 PC에서 켜면 사진을 읽어요') : reading.progress_msg || '사진에서 지문을 읽는 중'}</b><span class="num muted">${reading.progress || 0}%</span></div><div class="hl-track"><i style=${`width:${reading.progress || 0}%`}></i></div></div>`}
            ${reading && reading.status === 'done' && html`<div class="faint" style="font-size:13px">사진에서 읽은 지문을 아래 칸에 넣었어요. 틀린 글자가 없는지 확인해 주세요. 사진은 강의를 만들면 강의 화면의 문제 자료 칸에 남고, 언제든 지울 수 있어요.</div>`}
            ${reading && reading.status === 'failed' && html`<div class="row wrap" style="gap:8px"><span class="warn" style="font-size:13px">사진을 읽지 못했어요: ${reading.error || ''}</span><button class="btn link" onClick=${() => readPhotos(photos)}>다시 읽기</button></div>`}
          </div>`}
          <div class="passage-box"><textarea id="psg" class="input" value=${f.passage} onPaste=${onPaste} onInput=${(e) => { setF({ ...f, passage: e.target.value }); setUndo(null); setPrep(null); }} spellcheck="false"
            placeholder="지문이나 교과서 본문을 그대로 붙여 넣어 주세요. 소제목은 따로 떼고, 쪽 번호·어휘 풀이 같은 줄은 저절로 빼요."></textarea></div>
          <div class="meta-line"><span class="num">${words}단어</span>${sents > 0 && html`<span class="num">문장 ${sents}개</span>`}${ol && ol.headings > 0 && html`<span class="num">소제목 ${ol.headings}개</span>`}
            ${words > 0 && words < 20 && html`<span class="warn">20단어 이상 넣어 주세요</span>`}
            ${needsTidy && html`<button class="btn link" onClick=${() => tidyNow(f.passage)}>자료 정리하기</button>`}
            ${undo !== null && html`<span title=${prep && prep.dropped.length ? `뺀 줄:\n${prep.dropped.map((d) => `· ${d.text} (${d.why})`).join('\n')}` : ''}>${prepSummary(prep)}</span><button class="btn link" onClick=${() => { setF({ ...f, passage: undo }); setUndo(null); setPrep(null); }}>되돌리기</button>`}</div>
          ${ol && ol.headings > 0 && html`<div class="meta-line">'## '로 시작하는 줄은 소제목이에요. 판서에서 그 문단 위에 따로 써요. 소제목이 아니면 ## 를 지우고, 빠진 소제목은 줄 앞에 ## 를 붙여 주세요.</div>`}
          ${parts.length >= 2 && html`<div class="split-box">
            <${Switch} checked=${splitOn} onChange=${(v) => setSplit(mustSplit ? true : v)} title=${`나눠서 강의 ${parts.length}개 만들기`}
              desc=${mustSplit ? '문장이 40개를 넘어서 한 강의로는 만들 수 없어요. 나눠서 만들어요.' : `문장이 ${sents}개예요. ${ol.headings ? '소제목' : '문단'}마다 나누면 문장 하나하나를 더 자세히 설명해요.`} />
            ${splitOn && html`<ol class="part-list">${parts.map((p, i) => html`<li><b>${i + 1}부</b><span class="pt">${p.headings.length ? p.headings.join(' · ') : `${p.first.slice(0, 60)}${p.first.length > 60 ? '…' : ''}`}</span><span class="num">문장 ${p.n}개</span></li>`)}</ol>`}
          </div>`}
          ${tooLong && html`<div class="notice amber"><${Icon} name="alert" /><div>${mustSplit ? `문장이 ${sents}개라 한 강의로는 만들 수 없어요. 빈 줄로 문단을 나누거나 줄 앞에 ## 를 붙여 소제목을 표시하면 나눠서 만들 수 있어요.` : '지문이 너무 길어요 (12,000자까지). 나눠서 만들기를 켜 주세요.'}</div></div>`}
        </div>
        <div class="stack sm">
          <button class=${`more-t ${showTr ? 'open' : ''}`} aria-expanded=${showTr} onClick=${() => setShowTr(!showTr)}><${Icon} name="chevronDown" size="sm" />해석도 넣기<span class="faint" style="font-weight:550">(선택, 넣으면 이 해석을 기준으로 설명해요)</span></button>
          ${showTr && html`<textarea class="input" rows="4" value=${f.translation} onInput=${set('translation')} placeholder="문장마다 해석을 붙여 넣어 주세요"></textarea>`}
        </div>
        <div class="stack sm">
          <button class=${`more-t ${showMemo ? 'open' : ''}`} aria-expanded=${showMemo} onClick=${() => setShowMemo(!showMemo)}><${Icon} name="chevronDown" size="sm" />AI에게 따로 부탁하기<span class="faint" style="font-weight:550">(선택)</span></button>
          ${showMemo && html`<textarea class="input" rows="3" value=${o.memo} onInput=${(e) => setO({ ...o, memo: e.target.value })} placeholder="예: 3번 문장 분사구문을 특히 자세히, 시험에 자주 나오는 어휘 위주로"></textarea>`}
        </div>
      </div>
      <aside class="panel pad opts">
        <div class="opt-g"><div class="label">강의 길이</div><${Seg} full value=${o.minutes} onChange=${(v) => setO({ ...o, minutes: v })} options=${[[10, '10분'], [15, '15분'], [20, '20분']]} /></div>
        <div class="opt-g"><div class="label">말투</div><${Seg} full value=${o.tone} onChange=${(v) => setO({ ...o, tone: v })} options=${TONE_OPTS} /></div>
        <div class="opt-g"><div class="label">학년</div><${Seg} full value=${o.level} onChange=${setLevel} options=${LEVELS} /></div>
        <div class="opt-g"><div class="label">설명 중점</div><${Seg} full value=${o.focus} onChange=${(v) => setO({ ...o, focus: v })} options=${FOCUS} /></div>
        <div style="margin-top:8px">
          <${Switch} checked=${o.call_names} onChange=${(v) => setO({ ...o, call_names: v })} title="학생 이름 불러 주기" desc="강의 중 3~4번, 보는 학생 이름을 불러요" />
          <${Switch} checked=${o.practice} onChange=${(v) => setO({ ...o, practice: v })} title="연습지 만들기" desc="어법, 어휘, 해석 연습지 PDF" />
          <${Switch} checked=${!o.auto_approve} onChange=${(v) => setO({ ...o, auto_approve: !v })} title="영상 전에 검수하기" desc="대본과 판서를 먼저 보고 고쳐요 (추천)" />
          <${Switch} checked=${o.review !== false} onChange=${(v) => setO({ ...o, review: v })} title="AI 자료 검토" desc="문제·지시문처럼 지문이 아닌 문장은 빼고, 붙은 소제목은 떼요" />
        </div>
        <div class="go-box">
          ${eng && !on && html`<div class="notice amber" style="font-size:13px;padding:10px 12px"><${Icon} name="alert" size="sm" /><div>제작 엔진이 꺼져 있어요. 요청은 저장되고, 학원 PC에서 켜면 그때 만들어요.</div></div>`}
          <${Btn} kind="primary" size="lg" block icon="wand" busy=${busy} disabled=${!canGo} onClick=${submit}>${splitOn ? `강의 ${parts.length}개 만들기` : '강의 만들기'}</${Btn}>
          <div class="hint">${MOD_KEY}+Enter로도 만들어요. ${splitOn ? '강의마다 차례로 만들어요. 하나에 ' : ''}대본과 판서는 2~3분, 영상은 10분 안팎 걸려요.</div>
        </div>
      </aside>
    </div>`
    : html`<div class="composer">
      <div class="stack lg">
        <label class=${`dropzone ${drag ? 'drag' : ''} ${files.video ? 'has' : ''}`}
          onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
          onDrop=${(e) => { e.preventDefault(); setDrag(false); pickVideo(e.dataTransfer.files[0]); }}>
          <div class="di"><${Icon} name=${files.video ? 'checkCircle' : 'filmUp'} size="xl" /></div>
          <div class="dt ellipsis" style="max-width:100%">${files.video ? files.video.name : '강의 영상을 여기에 끌어다 놓으세요'}</div>
          <div class="dd">${files.video ? `${fmtBytes(files.video.size)}, 다른 영상으로 바꾸려면 다시 누르세요` : 'MP4 파일, 또는 눌러서 고르기'}</div>
          <input type="file" accept="video/mp4,video/*" class="sr" onChange=${(e) => pickVideo(e.target.files[0])} />
        </label>
        <div class="grid2">
          <${Field} label="강의 제목"><input value=${f.title} onInput=${set('title')} placeholder="예: 맹수는 정말 범인이었을까" /></${Field}>
          <${Field} label="출처 (선택)"><input value=${f.source} onInput=${set('source')} placeholder="예: 올림포스 영어독해 기본 1, 18번" /></${Field}>
        </div>
        <div class="grid2">${pdfRow('note', '판서노트')}${pdfRow('practice', '연습지')}</div>
      </div>
      <aside class="panel pad opts">
        <div class="opt-g"><div class="label">학년</div><${Seg} full value=${o.level} onChange=${setLevel} options=${LEVELS} /></div>
        <h3 style="margin:0 0 6px;font-size:16px;font-weight:750">올린 다음에</h3>
        <${Switch} checked=${up.auto_subtitle} onChange=${(v) => setUp({ ...up, auto_subtitle: v, auto_summary: v && up.auto_summary })} title="자동 자막" desc="학원 PC가 영상의 말을 받아 적어요" />
        <${Switch} checked=${up.auto_summary} onChange=${(v) => setUp({ ...up, auto_summary: v, auto_subtitle: v || up.auto_subtitle })} title="AI 요약과 복습 노트" desc="자막으로 요약, 목차, 확인 문제를 만들어요" />
        <div class="go-box">
          ${busy && html`<div><div class="row between" style="font-size:13px;margin-bottom:6px"><span>올리는 중</span><span class="num">${upPct}%</span></div><${Bar} value=${upPct} tone="seen" /></div>`}
          <${Btn} kind="primary" size="lg" block icon="upload" busy=${busy} disabled=${!canGo} onClick=${submit}>올리기</${Btn}>
          <div class="hint">올린 뒤 강의 편집에서 자르기, 목차, 영상 위에 그리기를 할 수 있어요.</div>
        </div>
      </aside>
    </div>`}
  </div>`;
}

// ================================================================ 과제 내기 창
export function AssignModal({ lectureId, classId, onClose, onDone }) {
  const [classes, setClasses] = useState(null);
  const [lectures, setLectures] = useState(null);
  const [lec, setLec] = useState(lectureId ? String(lectureId) : '');
  const [pick, setPick] = useState(classId ? [Number(classId)] : []);
  const [due, setDue] = useState(daysLater(7));
  const [noDue, setNoDue] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/admin/classes').then((r) => setClasses(r.classes)).catch(toastErr);
    if (!lectureId) api('/api/admin/lectures?status=done').then((r) => setLectures(r.lectures)).catch(toastErr);
  }, []);
  const toggle = (id) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id]);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/admin/assignments', { method: 'POST', body: { lecture_id: Number(lec), class_ids: pick, due_at: noDue || !due ? null : endOfDay(due), note } });
      toast(`과제를 냈어요. 학생 앱에 바로 나타나요`);
      emit('ivy:assigned');
      emit('ivy:changed');
      if (onDone) onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="과제 내기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" icon="send" busy=${busy} disabled=${!lec || !pick.length} onClick=${save}>${pick.length > 1 ? `${pick.length}개 반에 내기` : '과제 내기'}</${Btn}>`}>
    <div class="stack">
      ${!lectureId && html`<${Field} label="강의"><select value=${lec} onChange=${(e) => setLec(e.target.value)}><option value="">${lectures === null ? '불러오는 중…' : lectures.length ? '강의를 골라 주세요' : '완성된 강의가 없어요'}</option>
        ${(() => {
          const opt = (l) => html`<option value=${l.id}>${l.title}${l.source ? ` (${l.source})` : ''}</option>`;
          const ls = lectures || [];
          const groups = LEVELS.map(([k, t]) => [t, ls.filter((l) => levelOf(l) === k)]).filter(([, g]) => g.length);
          const rest = ls.filter((l) => !levelOf(l));
          if (groups.length <= 1 && !rest.length) return ls.map(opt);
          return [...groups.map(([t, g]) => html`<optgroup label=${t}>${g.map(opt)}</optgroup>`), rest.length ? html`<optgroup label="학년 없음">${rest.map(opt)}</optgroup>` : null];
        })()}</select></${Field}>`}
      <div class="field"><label>반 (여러 개 고를 수 있어요)</label>
        ${classes === null ? html`<${Skel} h=${38} />` : classes.length ? html`<div class="pick-row">${classes.map(
          (c) => html`<button type="button" class=${`pick ${pick.includes(c.id) ? 'on' : ''}`} aria-pressed=${pick.includes(c.id)} onClick=${() => toggle(c.id)}><span class="cls-dot" style=${c.color ? `background:${c.color}` : ''}></span>${c.name}<small>${c.students}명</small></button>`,
        )}</div>` : html`<div class="notice"><${Icon} name="info" /><div>반이 없어요. 반 화면에서 반을 먼저 만들어 주세요.</div></div>`}</div>
      <${DuePicker} due=${due} setDue=${setDue} noDue=${noDue} setNoDue=${setNoDue} />
      <${Field} label="학생에게 남길 말 (선택)"><input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="예: 연습지까지 풀어 오세요" /></${Field}>
    </div>
  </${Modal}>`;
}

function DueModal({ a, onClose, onDone }) {
  const [due, setDue] = useState(a.due_at ? ymd(new Date(a.due_at * 1000)) : daysLater(7));
  const [noDue, setNoDue] = useState(!a.due_at);
  const [note, setNote] = useState(a.note || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/assignments/${a.id}`, { method: 'PUT', body: { due_at: noDue || !due ? null : endOfDay(due), note } });
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="마감 고치기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} onClick=${save}>저장</${Btn}>`}>
    <div class="stack"><div class="muted">「${a.title}」, ${a.class_name}</div>
      <${DuePicker} due=${due} setDue=${setDue} noDue=${noDue} setNoDue=${setNoDue} />
      <${Field} label="학생에게 남길 말"><input value=${note} onInput=${(e) => setNote(e.target.value)} /></${Field}></div></${Modal}>`;
}

// ================================================================ 강의 하나
const TASK_NAME = { transcribe: '자막', summarize: 'AI 요약', quiz: '확인 문제' };

function EditCard({ lec, tasks }) {
  // 확인 문제 작업은 확인 문제 칸에서 따로 보여 줘요
  const mine = tasks.filter((x) => x.kind !== 'quiz');
  const run = mine.find((x) => x.status === 'queued' || x.status === 'running');
  const failed = mine.find((x) => x.status === 'failed');
  const e = lec.edit || {};
  const items = [
    ['captions', '자막', lec.has_subtitle ? '있어요' : lec.tool !== 'manual' ? '영상에 있어요' : '없어요', lec.has_subtitle || lec.tool !== 'manual'],
    ['sparkles', 'AI 요약', lec.has_summary ? '있어요' : '없어요', lec.has_summary],
    ['flag', '목차', (e.chapters || []).length ? `${e.chapters.length}개` : '없어요', (e.chapters || []).length > 0],
    ['scissors', '잘라낸 곳', (e.cuts || []).length ? `${e.cuts.length}곳` : '없어요', (e.cuts || []).length > 0],
    ['penLine', '영상 위 그림', (e.strokes || []).length ? `${e.strokes.length}개` : '없어요', (e.strokes || []).length > 0],
  ];
  if (lec.name_slots) items.push(['audioLines', '이름 부르기', `${lec.name_slots}곳`, true]);
  return html`<section class="panel"><div class="panel-h"><h2>편집과 학습 도구</h2><span class="spacer"></span><${Btn} size="sm" icon="scissors" onClick=${() => go(`/edit/${lec.id}`)}>편집하기</${Btn}></div>
    <div class="panel-b stack">
      <div class="tool-grid">${items.map(([ic, k, v, on]) => html`<div class=${`tool-i ${on ? 'on' : ''}`}><${Icon} name=${ic} size="sm" /><span>${k}</span><b>${v}</b></div>`)}</div>
      ${run && html`<div class="task-run"><div class="row between" style="font-size:13.5px"><b>${TASK_NAME[run.kind] || run.kind}: ${run.status === 'queued' ? '차례를 기다리는 중' : run.progress_msg || '만드는 중'}</b><span class="num muted">${run.progress || 0}%</span></div><div class="hl-track"><i style=${`width:${run.progress || 0}%`}></i></div></div>`}
      ${!run && failed && html`<div class="notice rose"><${Icon} name="alert" /><div style="font-size:13.5px">${TASK_NAME[failed.kind] || failed.kind}을 만들지 못했어요: ${failed.error || ''}</div></div>`}
    </div></section>`;
}

function LectureDetail({ id, info }) {
  const { data, loading, reload } = useAsync(() => api(`/api/admin/lectures/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const [files, setFiles] = useState({ video: null, note: null, practice: null });
  const [upPct, setUpPct] = useState(0);
  const [showPassage, setShowPassage] = useState(false);
  const [replace, setReplace] = useState(false);
  useEvent('ivy:assigned', () => reload(true));
  const lec = data && data.lecture;
  const taskBusy = !!(data && data.tasks && data.tasks.some((x) => x.status === 'queued' || x.status === 'running'));
  useEffect(() => {
    if (!lec || (!WORKING.includes(lec.status) && !taskBusy)) return;
    const t = setInterval(() => reload(true), 4000);
    return () => clearInterval(t);
  }, [lec && lec.status, taskBusy]);
  if (loading && !data) return html`<div class="page"><${Skel} h=${30} w="50%" mb=${20} /><div class="detail"><${Skel} h=${380} /><${Skel} h=${220} /></div></div>`;
  if (!lec) return html`<div class="page"><${Empty} title="강의를 찾을 수 없어요" action=${html`<${Btn} onClick=${() => go('/lectures')}>강의 목록으로</${Btn}>`} /></div>`;
  const act = async (action, msg) => {
    setBusy(action);
    try {
      await api(`/api/admin/lectures/${lec.id}/${action}`, { method: 'POST', body: {} });
      toast(msg);
      emit('ivy:changed');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const del = async () => {
    if (!(await confirmBox({ title: '강의를 지울까요?', body: '영상, PDF, 과제, 학생 시청 기록이 모두 지워지고 되돌릴 수 없어요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/admin/lectures/${lec.id}`, { method: 'DELETE' });
      toast('지웠어요');
      emit('ivy:changed');
      go('/lectures');
    } catch (e) {
      toastErr(e);
    }
  };
  const uploadManual = async () => {
    setBusy('upload');
    try {
      let dur = null;
      if (files.video) {
        dur = await videoDuration(files.video);
        await uploadFile(files.video, lec.id, 'video', (p) => setUpPct(p), { duration: dur });
        const thumb = lec.tool === 'manual' ? await videoThumb(files.video) : null;
        if (thumb) await uploadFile(thumb, lec.id, 'thumb').catch(() => {});
      }
      if (files.note) await uploadFile(files.note, lec.id, 'note');
      if (files.practice) await uploadFile(files.practice, lec.id, 'practice');
      if (lec.status === 'manual') await api(`/api/admin/lectures/${lec.id}/finish`, { method: 'POST', body: { duration: dur } });
      toast('올렸어요');
      setFiles({ video: null, note: null, practice: null });
      setReplace(false);
      setUpPct(0);
      reload(true);
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const stIdx = { queued: 0, scripting: 0, review: 1, render_queued: 2, rendering: 2, done: 4, failed: -1 }[lec.status];
  const tl = [['대본·판서', 'pencil'], ['검수', 'eye'], ['영상 만들기', 'video'], ['완성', 'checkCircle']];
  const generated = lec.tool !== 'manual' && lec.status !== 'manual';
  const showUpload = lec.status === 'manual' || (lec.tool === 'manual' && replace);
  const f = data.files || {};
  const done = lec.status === 'done';
  const academy = info.academy_name;
  const meta = [LEVEL_NAME[levelOf(lec)], lec.source || '출처 없음', `${fmtDate(lec.created_at)}에 만듦`].filter(Boolean).join(', ');
  return html`<div class="page">
    <button class="crumb" onClick=${() => go('/lectures')}><${Icon} name="chevronLeft" size="sm" />강의</button>
    <div class="lec-head">
      <div style="min-width:0;flex:1"><div class="row wrap" style="gap:10px"><h1>${lec.title}</h1><${StatusChip} status=${lec.status} /></div><div class="sub">${meta}</div></div>
      <div class="actions">
        <${Btn} size="sm" icon="pencil" onClick=${() => setEdit(true)}>이름, 학년 바꾸기</${Btn}>
        ${done && lec.has_video && html`<${Btn} size="sm" icon="scissors" onClick=${() => go(`/edit/${lec.id}`)}>편집</${Btn}>`}
        ${done && html`<${Btn} kind="primary" size="sm" icon="send" onClick=${() => openAssign({ lectureId: lec.id })}>과제 내기</${Btn}>`}
      </div>
    </div>
    <div class="detail">
      <div class="stack lg">
        ${generated && !done && html`<section class="pipe chalkboard">
          <div class="pipe-steps">${tl.map(([t, ic], i) => {
            const cls = lec.status === 'failed' ? '' : i < stIdx ? 'done' : i === stIdx ? 'now' : '';
            return html`<div class=${`ps ${cls}`}><div class="c">${cls === 'done' ? html`<${Icon} name="check" size="sm" />` : html`<${Icon} name=${ic} size="sm" />`}</div>${t}</div>`;
          })}</div>
          <div class="pipe-msg">
            ${WORKING.includes(lec.status) && html`<div><div class="row between" style="margin-bottom:10px"><b>${lec.progress_msg || STATUS[lec.status][0]}</b><span class="num" style="color:var(--chalk-2)">${lec.progress || 0}%</span></div><${Bar} value=${lec.progress || 0} />
              <p class="note">학원 PC의 제작 엔진이 만들고 있어요. 이 화면은 저절로 새로 고쳐져요.</p></div>`}
            ${lec.status === 'review' && html`<div><b style="font-size:17px">대본과 판서가 준비됐어요</b><p class="note" style="margin-top:4px">확인하고 고칠 곳을 고친 다음 영상을 만들어 주세요.</p>
              <div class="row wrap" style="margin-top:14px"><a class="btn chalk" href=${`#/review/${lec.id}`}><${Icon} name="eye" />검수하기</a>
                <${Btn} kind="on-board" icon="video" busy=${busy === 'approve'} onClick=${() => act('approve', '영상 만들기를 요청했어요')}>바로 영상 만들기</${Btn}></div></div>`}
            ${lec.status === 'failed' && html`<div><b style="font-size:17px">만들지 못했어요</b><p class="note" style="margin-top:4px;color:var(--chalk-2)">${lec.error || '알 수 없는 문제가 생겼어요.'}</p>
              <div class="row" style="margin-top:14px"><${Btn} kind="chalk" icon="refresh" busy=${busy === 'retry'} onClick=${() => act('retry', '다시 요청했어요')}>다시 시도</${Btn}></div></div>`}
          </div></section>`}
        ${showUpload && html`<section class="panel pad stack"><div class="row"><h3 style="margin:0;font-size:16px">${lec.status === 'manual' ? '영상 올리기' : '파일 바꾸기'}</h3><span class="spacer"></span>${lec.status !== 'manual' && html`<button class="btn ghost icon sm" onClick=${() => setReplace(false)} aria-label="닫기"><${Icon} name="x" /></button>`}</div>
          <p class="muted" style="margin:0">${lec.status === 'manual' ? '영상을 올려야 완성돼요. PDF는 나중에 올려도 돼요.' : '바꿀 파일만 골라 주세요. 학생 시청 기록은 그대로 남아요.'}</p>
          ${[['video', '강의 영상 (MP4)', 'video/mp4'], ['note', '판서노트 (PDF)', 'application/pdf'], ['practice', '연습지 (PDF)', 'application/pdf']].map(
            ([k, label, accept]) => html`<label class="drop"><div class="di"><${Icon} name=${files[k] ? 'checkCircle' : k === 'video' ? 'filmUp' : 'file'} /></div>
              <div style="flex:1;min-width:0"><div style="font-weight:700">${label}</div><div class="muted ellipsis" style="font-size:13px">${files[k] ? files[k].name : '눌러서 파일 고르기'}</div></div>
              <input type="file" accept=${accept} class="sr" onChange=${(e) => setFiles({ ...files, [k]: e.target.files[0] || null })} /></label>`,
          )}
          ${busy === 'upload' && html`<${Bar} value=${upPct} tone="seen" />`}
          <div><${Btn} kind="primary" icon="upload" busy=${busy === 'upload'} disabled=${lec.status === 'manual' ? !files.video && !lec.has_video : !files.video && !files.note && !files.practice} onClick=${uploadManual}>올리기</${Btn}></div></section>`}
        ${done && html`<section class="stage">
          ${lec.has_video ? html`<${Player} src=${`/media/lecture/${lec.id}/video`} poster=${lec.has_thumb ? `/media/lecture/${lec.id}/thumb` : undefined} subtitle=${f.subtitle}
            duration=${lec.duration} cuts=${lec.edit.cuts} chapters=${lec.edit.chapters} strokes=${lec.edit.strokes} />` : html`<div class="player"></div>`}
          <div class="stage-f">
            ${f.video && html`<a class="btn secondary sm" href=${f.video} download><${Icon} name="download" size="sm" />영상</a>`}
            ${f.note && html`<a class="btn secondary sm" href=${f.note} target="_blank" rel="noopener"><${Icon} name="fileText" size="sm" />판서노트</a>`}
            ${f.practice && html`<a class="btn secondary sm" href=${f.practice} target="_blank" rel="noopener"><${Icon} name="clipboard" size="sm" />${lec.tool === 'manual' && lec.has_summary ? '복습 노트' : '연습지'}</a>`}
            ${f.subtitle && html`<a class="btn secondary sm" href=${`${f.subtitle}&dl=1`} download><${Icon} name="captions" size="sm" />자막</a>`}
            <span class="meta num">${fmtDur(lec.duration)}${lec.video_bytes ? `, ${fmtBytes(lec.video_bytes)}` : ''}</span>
          </div></section>`}
        ${done && lec.has_video && html`<${EditCard} lec=${lec} tasks=${data.tasks || []} />`}
        ${done && html`<${QuizCard} lec=${lec} />`}
        ${done && html`<${HomeworkCard} lec=${lec} />`}
        ${done && html`<${MockCard} lec=${lec} />`}
      </div>
      <div class="stack lg">
        ${done && html`<section class="panel"><div class="panel-h"><h2>과제</h2>${data.assignments.length > 0 && html`<span class="count">${data.assignments.length}개 반</span>`}<span class="spacer"></span>
            <${Btn} kind="ghost" size="sm" icon="plus" onClick=${() => openAssign({ lectureId: lec.id })}>반 더하기</${Btn}></div>
          ${data.assignments.length ? html`<ul class="rows">${data.assignments.map((a) => html`<${AsgRow} a=${{ ...a, title: lec.title }} academy=${academy} showTitle=${false} onClick=${() => go(`/classes/${a.class_id}`)}
              actions=${a.closed_at ? html`<button class="btn ghost sm" onClick=${async (e) => { e.stopPropagation(); try { await api('/api/admin/assignments/close', { method: 'POST', body: { ids: [a.id], closed: false } }); toast('다시 목록에 보여요'); reload(true); } catch (err) { toastErr(err); } }}><${Icon} name="undo" size="sm" />다시 보이기</button>` : null} />`)}</ul>`
            : html`<${Empty} icon="send" title="아직 과제로 내지 않았어요" action=${html`<${Btn} kind="soft" icon="send" onClick=${() => openAssign({ lectureId: lec.id })}>과제 내기</${Btn}>`}>반을 고르면 학생 앱에 바로 나타나요.</${Empty}>`}</section>`}
        ${done && html`<${MaterialsCard} lec=${lec} />`}
        ${lec.script && lec.script.material && html`<${MaterialNote} m=${lec.script.material} />`}
        ${lec.passage && html`<section class="panel"><div class="panel-h"><h2>지문</h2><span class="spacer"></span><${Btn} kind="ghost" size="sm" onClick=${() => setShowPassage(!showPassage)}>${showPassage ? '접기' : '모두 보기'}</${Btn}></div>
          <div class="panel-b"><p class=${`passage-text ${showPassage ? '' : 'clip'}`}>${lec.passage}</p></div></section>`}
        <section class="panel"><div class="panel-h"><h2>관리</h2></div><div class="panel-b" style="padding-top:2px"><div class="mng">
          ${done && lec.has_script && html`<button onClick=${() => go(`/review/${lec.id}`)}><${Icon} name="pencil" />대본 고쳐서 다시 만들기</button>`}
          ${['done', 'failed', 'review'].includes(lec.status) && lec.passage && html`<button disabled=${busy === 'rescript'} onClick=${async () => {
            if (await confirmBox({ title: '대본부터 새로 만들까요?', body: '지금 대본은 지워지고 AI가 처음부터 다시 써요.', ok: '새로 만들기' })) act('rescript', '대본을 새로 만들어요');
          }}><${Icon} name="refresh" />대본부터 새로 만들기</button>`}
          ${done && lec.tool === 'manual' && !replace && html`<button onClick=${() => setReplace(true)}><${Icon} name="upload" />영상, PDF 바꾸기</button>`}
          <button class="danger" onClick=${del}><${Icon} name="trash" />강의 지우기</button>
        </div></div></section>
      </div>
    </div>
    ${edit && html`<${RenameModal} lec=${lec} onClose=${() => setEdit(false)} onDone=${() => reload(true)} />`}
  </div>`;
}

// ------------------------------------------------------------ 확인 문제 (강의를 듣고 푸는 문제와 학생 점수)
function QuizCard({ lec }) {
  const { data, reload } = useAsync(() => api(`/api/admin/lectures/${lec.id}/quiz`), [lec.id]);
  const [showKey, setShowKey] = useState(false);
  const [stu, setStu] = useState(null);
  const [busy, setBusy] = useState(false);
  const task = data && data.task;
  const making = !!(task && ['queued', 'running'].includes(task.status));
  useEffect(() => {
    if (!making) return;
    const t = setInterval(() => reload(true), 4000);
    return () => clearInterval(t);
  }, [making]);
  const canMake = lec.has_script || lec.has_transcript;
  const make = async (again) => {
    if (again && !(await confirmBox({ title: '확인 문제를 새로 만들까요?', body: '새 문제로 바뀌면 학생들은 새 문제를 다시 풀어요. 지금까지 푼 점수는 시청표에서 빠져요.', ok: '새로 만들기' }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/lectures/${lec.id}/tasks`, { method: 'POST', body: { kind: 'quiz' } });
      toast('확인 문제를 만들기 시작했어요');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const quiz = data && data.quiz;
  const atts = (data && data.attempts) || [];
  const pend = (data && data.pending) || [];
  const n = quiz ? quiz.items.length : 0;
  const avg = atts.length ? atts.reduce((t, a) => t + a.score, 0) / atts.length : 0;
  const hard = quiz && atts.length >= 3
    ? quiz.items.map((it, i) => ({ it, i, rate: data.right[i] / atts.length })).filter((x) => x.rate < 0.6).sort((a, b) => a.rate - b.rate).slice(0, 3)
    : [];
  const head = html`<div class="panel-h"><h2>확인 문제</h2>${quiz && html`<span class="count">${n}문항</span>`}<span class="spacer"></span>
    ${quiz && html`<${Btn} size="sm" icon="printer" onClick=${() => window.open(`/print.html#q${lec.id}`, '_blank')}>인쇄</${Btn}><${Btn} size="sm" icon="eye" onClick=${() => setShowKey(true)}>문제 보기</${Btn}>`}</div>`;
  if (!data) return html`<section class="panel">${head}<div class="panel-b"><${Skel} h=${60} /></div></section>`;
  return html`<section class="panel">${head}
    <div class="panel-b stack">
      ${making && html`<div class="task-run"><div class="row between" style="font-size:13.5px"><b>${task.status === 'queued' ? '확인 문제: 차례를 기다리는 중' : task.progress_msg || '확인 문제를 만드는 중'}</b><span class="num muted">${task.progress || 0}%</span></div>
        <div class="hl-track"><i style=${`width:${task.progress || 0}%`}></i></div>
        ${task.status === 'queued' && html`<div class="faint" style="font-size:12.5px;margin-top:6px">학원 PC의 제작 엔진이 1.1.8 이상이어야 만들어요. 엔진은 저절로 업데이트돼요.</div>`}</div>`}
      ${!quiz && !making && task && task.status === 'failed' && html`<div class="notice rose"><${Icon} name="alert" /><div style="font-size:13.5px">확인 문제를 만들지 못했어요: ${task.error || ''}</div></div>`}
      ${!quiz && !making && html`<div class="row wrap" style="gap:12px"><p class="muted" style="margin:0;flex:1;min-width:220px;font-size:14px">${canMake ? '강의를 듣고 푸는 객관식 25문항을 AI가 만들어요. 어휘(동의어, 반의어), 문법, 해석, 내용, 변형 유형을 내신처럼 묻고, 만든 뒤 한 번 더 검사해서 억지 문제는 빼요. 학생은 폰이나 PC에서 풀면 바로 채점돼요.' : '확인 문제는 강의 대본이나 자막으로 만들어요. 자막을 먼저 만들어 주세요.'}</p>
        <${Btn} kind="soft" icon="sparkles" busy=${busy} disabled=${!canMake} onClick=${() => make(false)}>${task && task.status === 'failed' ? '다시 시도' : '확인 문제 만들기'}</${Btn}></div>`}
      ${quiz && html`<div class="qk-stats">
          <div><span>푼 학생</span><b class="num">${atts.length}명</b></div>
          <div><span>평균</span><b class="num">${atts.length ? `${avg.toFixed(1)}점` : '-'}</b></div>
          <div><span>아직 안 푼 학생</span><b class="num">${pend.length}명</b></div></div>
        ${hard.length > 0 && html`<div class="qk-hard"><div class="label">많이 틀린 문제</div>${hard.map(({ it, i, rate }) => html`<button class="qk-h" onClick=${() => setShowKey(true)}>
          <b class="num">${i + 1}번</b><span class="ellipsis">${AREA[it.area]}, ${it.q}</span><span class="num rate">${Math.round(rate * 100)}%</span></button>`)}</div>`}
        ${atts.length > 0 ? html`<ul class="rows qk-rows">${atts.map((a) => html`<li class="row" style="cursor:pointer" onClick=${() => setStu(a)}>
            <div style="flex:1;min-width:0"><b>${a.name}</b> <span class="faint" style="font-size:12.5px">${a.class_name || ''}</span></div>
            <span class="faint num" style="font-size:12.5px">${fmtDate(a.created_at)}</span><b class="num qk-sc">${a.score}/${a.total}</b></li>`)}</ul>`
          : html`<p class="muted" style="margin:0;font-size:14px">아직 푼 학생이 없어요. 과제로 낸 반 학생들은 강의 화면에서 바로 풀 수 있어요.</p>`}
        ${pend.length > 0 && html`<p class="faint" style="margin:0;font-size:13px">안 푼 학생: ${pend.slice(0, 30).map((x) => x.name).join(', ')}${pend.length > 30 ? ` 외 ${pend.length - 30}명` : ''}</p>`}
        <div class="row wrap" style="justify-content:flex-end;gap:6px"><a class="btn ghost sm" href=${`#/exams/new?l=${lec.id}`}><${Icon} name="clipboardCheck" size="sm" />골라서 시험 만들기</a>
          <${Btn} kind="ghost" size="sm" icon="refresh" busy=${busy} disabled=${making || !canMake} onClick=${() => make(true)}>새로 만들기</${Btn}></div>`}
    </div>
    ${showKey && quiz && html`<${QuizKeyModal} lec=${lec} data=${data} onClose=${() => setShowKey(false)} onDeleted=${() => { setShowKey(false); reload(true); }} />`}
    ${stu && quiz && html`<${QuizAnswerModal} quiz=${quiz} a=${stu} onClose=${() => setStu(null)} onChanged=${() => reload(true)} />`}
  </section>`;
}

function QuizKeyModal({ lec, data, onClose, onDeleted }) {
  const quiz = data.quiz;
  const n = data.attempts.length;
  const del = async () => {
    if (!(await confirmBox({ title: '확인 문제를 지울까요?', body: '학생 화면에서 확인 문제가 사라져요. 필요하면 나중에 새로 만들 수 있어요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/admin/lectures/${lec.id}/quiz`, { method: 'DELETE' });
      toast('확인 문제를 지웠어요');
      onDeleted();
    } catch (e) {
      toastErr(e);
    }
  };
  return html`<${Modal} title=${`확인 문제, ${quiz.items.length}문항`} onClose=${onClose} wide
    footer=${html`<button class="btn danger" onClick=${del}><${Icon} name="trash" size="sm" />확인 문제 지우기</button><span class="spacer"></span><button class="btn primary" onClick=${onClose}>닫기</button>`}>
    <div class="qk-list">${quiz.items.map((it, i) => html`<${QuizItem} it=${it} i=${i} mode="key" stat=${n ? { rate: data.right[i] / n } : null} />`)}</div>
  </${Modal}>`;
}

function QuizAnswerModal({ quiz, a, onClose, onChanged }) {
  const [res, setRes] = useState(a.results);
  const [score, setScore] = useState(a.score);
  const setOk = async (i, ok) => {
    try {
      const r = await api(`/api/admin/quiz-attempts/${a.id}`, { method: 'PUT', body: { i, ok } });
      setRes(r.results);
      setScore(r.score);
      onChanged();
    } catch (e) {
      toastErr(e);
    }
  };
  const reset = async () => {
    if (!(await confirmBox({ title: `${a.name} 학생이 다시 풀게 할까요?`, body: '지금 점수와 답안이 지워지고, 학생이 처음부터 다시 풀어요.', ok: '다시 풀게 하기', danger: true }))) return;
    try {
      await api(`/api/admin/quiz-attempts/${a.id}`, { method: 'DELETE' });
      toast('다시 풀 수 있게 했어요');
      onChanged();
      onClose();
    } catch (e) {
      toastErr(e);
    }
  };
  return html`<${Modal} title=${`${a.name}, ${score}/${a.total}점`} onClose=${onClose} wide
    footer=${html`<button class="btn danger" onClick=${reset}><${Icon} name="refresh" size="sm" />다시 풀게 하기</button><span class="spacer"></span><button class="btn primary" onClick=${onClose}>닫기</button>`}>
    <p class="muted" style="margin:0 0 10px;font-size:13.5px">${a.class_name || ''} ${fmtDate(a.created_at, true)}에 냈어요. 서술형은 답이 맞는데 틀리게 채점됐으면 '맞음'으로 바꿔 주세요.</p>
    <div class="qk-list">${quiz.items.map((it, i) => html`<div class="qk-ans">
      <${QuizItem} it=${it} i=${i} mode="review" value=${a.answers[i]} result=${res[i]} />
      ${it.type === 'sa' && html`<div class="row" style="gap:6px;justify-content:flex-end;margin:-4px 0 12px">
        ${isOk(res[i]) ? html`<${Btn} size="sm" kind="ghost" onClick=${() => setOk(i, false)}>틀림으로 바꾸기</${Btn}>` : html`<${Btn} size="sm" kind="soft" onClick=${() => setOk(i, true)}>맞음으로 바꾸기</${Btn}>`}
        ${res[i] >= 2 && html`<${Btn} size="sm" kind="ghost" onClick=${() => setOk(i, null)}>자동 채점으로</${Btn}>`}</div>`}</div>`)}</div>
  </${Modal}>`;
}

function RenameModal({ lec, onClose, onDone }) {
  const [title, setTitle] = useState(lec.title);
  const [source, setSource] = useState(lec.source || '');
  const [level, setLevel] = useState(levelOf(lec) || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/lectures/${lec.id}`, { method: 'PUT', body: { title, source, ...(level ? { level } : {}) } });
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="이름과 학년 바꾸기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} onClick=${save}>저장</${Btn}>`}>
    <div class="stack"><${Field} label="강의 제목"><input value=${title} onInput=${(e) => setTitle(e.target.value)} /></${Field}>
      <${Field} label="출처"><input value=${source} onInput=${(e) => setSource(e.target.value)} /></${Field}>
      <div class="field"><label>학년</label><${Seg} full value=${level} onChange=${setLevel} options=${LEVELS} label="학년" />
        <div class="hint">강의 목록에서 학년별로 나눠 보여요. 앞으로 만드는 확인 문제와 숙제 문제도 이 학년에 맞춰요.</div></div></div></${Modal}>`;
}

// ================================================================ 검수
// 자료 검토 결과: 대본을 쓰기 전에 엔진이 자료를 훑어 소제목을 떼고, 지문이 아닌 줄·문장과 군더더기를 뺀 것
function MaterialNote({ m, style }) {
  const [open, setOpen] = useState(false);
  const removed = (m && m.removed) || [];
  const cuts = (m && m.cuts) || [];
  const heads = (m && m.headings) || 0;
  if (!removed.length && !cuts.length && !heads) return null;
  const bits = [];
  if (heads) bits.push(`소제목 ${heads}개를 문장 위로 따로 올렸어요`);
  if (removed.length) bits.push(`지문이 아닌 줄·문장 ${removed.length}개를 뺐어요`);
  if (cuts.length) bits.push(`문장 속 군더더기 ${cuts.length}개(${cuts.slice(0, 3).join(', ')}${cuts.length > 3 ? ' …' : ''})를 지웠어요`);
  return html`<div class="notice" style=${style || ''}><${Icon} name="checkCircle" /><div style="min-width:0"><b>자료 검토</b> ${bits.join('. ')}.
    ${removed.length > 0 && html` <button class="btn link" onClick=${() => setOpen(!open)}>${open ? '접기' : '뺀 것 보기'}</button>`}
    ${open && html`<ul class="mat-list">${removed.map((r) => html`<li><span class="chip">${r.why}</span><span>${r.text}</span></li>`)}</ul>
      <div class="faint" style="font-size:12.5px;margin-top:6px">빠지면 안 되는 문장이 빠졌으면, 새 강의에서 'AI 자료 검토'를 끄고 다시 만들어 주세요.</div>`}</div></div>`;
}

function Review({ id }) {
  const { data, loading } = useAsync(() => api(`/api/admin/lectures/${id}`), [id]);
  const [script, setScript] = useState(null);
  const [cur, setCur] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState('');
  const [problems, setProblems] = useState([]);
  const [settings, setSettings] = useState(null);
  const [big, setBig] = useState(false);
  const boardRef = useRef(null);
  const boardApi = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    api('/api/admin/settings').then((r) => setSettings(r.settings)).catch(() => setSettings({}));
  }, []);
  useEffect(() => {
    if (data && data.lecture.script) setScript(JSON.parse(JSON.stringify(data.lecture.script)));
  }, [data]);
  // 문장·표시·단계 구성이 바뀔 때만 판서를 다시 그려요 (대본 글자를 고칠 때는 그대로)
  const shapeKey = script ? JSON.stringify([script.sentences, script.summary, script.memo, script.vocab, script.exam, (script.steps || []).map((x) => [x.view, x.n, x.show, x.focus])]) : '';
  useEffect(() => {
    if (!script || !boardRef.current || !settings || raw) return;
    const b = mountBoard(boardRef.current, script, {
      mode: 'preview',
      academy: settings.academy_name,
      header: settings.header_text || (data && data.lecture.source) || '',
      logo: settings.logo_url,
      style: settings.board_style,
    });
    boardApi.current = b;
    b.ready.then(() => {
      if (boardApi.current !== b) return;
      setProblems(b.problems);
      b.showStep(Math.min(cur, (script.steps || []).length - 1), script.steps[cur] && script.steps[cur].say);
    });
    return () => {
      b.destroy();
      if (boardApi.current === b) boardApi.current = null;
    };
  }, [shapeKey, settings, raw]);
  useEffect(() => {
    const b = boardApi.current;
    if (b && script) b.ready.then(() => boardApi.current === b && b.showStep(cur, script.steps[cur] && script.steps[cur].say));
    const item = !big && listRef.current && listRef.current.querySelector(`[data-i="${cur}"]`);
    if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cur]);
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      if (!script || document.querySelector('.palette-bd, .backdrop')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setCur((c) => Math.min(script.steps.length - 1, c + 1));
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [script]);
  if (loading && !data) return html`<div class="page wide"><${Skel} h=${30} w="40%" mb=${20} /><${Skel} h=${400} /></div>`;
  if (!data || !data.lecture.script) return html`<div class="page"><${Empty} title="검수할 대본이 없어요" action=${html`<${Btn} onClick=${() => go(`/lecture/${id}`)}>강의로 돌아가기</${Btn}>`} /></div>`;
  if (!script) return null;
  const lec = data.lecture;
  const steps = script.steps || [];
  const setSay = (i, v) => {
    setScript({ ...script, steps: steps.map((st, j) => (j === i ? { ...st, say: v } : st)) });
    setDirty(true);
  };
  const setKo = (n, v) => {
    setScript({ ...script, sentences: script.sentences.map((x) => (x.n === n ? { ...x, ko: v } : x)) });
    setDirty(true);
  };
  const removeStep = async (i) => {
    if (!(await confirmBox({ title: `${i + 1}번 단계를 뺄까요?`, body: '이 단계의 설명과 판서 표시 순서가 빠져요. 표시 자체는 그 문장 차례에 함께 나타나요.', ok: '빼기', danger: true }))) return;
    setScript({ ...script, steps: steps.filter((_, j) => j !== i) });
    setDirty(true);
    setCur(Math.max(0, Math.min(i, steps.length - 2)));
  };
  const save = async (approve) => {
    setBusy(approve ? 'approve' : 'save');
    try {
      let body = script;
      if (raw) {
        try {
          body = JSON.parse(rawText);
        } catch {
          throw new Error('데이터 형식이 올바르지 않아요. 괄호나 쉼표를 확인해 주세요.');
        }
        setScript(body);
      }
      await api(`/api/admin/lectures/${id}`, { method: 'PUT', body: { script: body } });
      setDirty(false);
      if (approve) {
        await api(`/api/admin/lectures/${id}/${lec.status === 'review' ? 'approve' : 'rerender'}`, { method: 'POST', body: {} });
        toast('영상 만들기를 요청했어요');
        emit('ivy:changed');
        go(`/lecture/${id}`);
      } else toast('저장했어요');
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const chars = steps.reduce((a, x) => a + (x.say || '').length, 0);
  const estMin = Math.max(1, Math.round(chars / 330));
  const st = steps[cur];
  return html`<div class="page wide">
    <button class="crumb" onClick=${() => go(`/lecture/${id}`)}><${Icon} name="chevronLeft" size="sm" />${lec.title}</button>
    <div class="ph"><div><h1>검수</h1><div class="sub">단계 ${steps.length}개, 대본 ${chars.toLocaleString()}자, 약 ${estMin}분 분량</div></div>
      <div class="actions"><${Seg} value=${raw ? 'raw' : 'easy'} label="편집 방식" onChange=${(v) => { if (v === 'raw') setRawText(JSON.stringify(script, null, 2)); setRaw(v === 'raw'); }} options=${[['easy', '쉬운 편집'], ['raw', '전체 데이터']]} /></div></div>
    ${!raw && script && html`<${MaterialNote} m=${script.material} style="margin-bottom:16px" />`}
    ${problems.length > 0 && !raw && html`<div class="notice amber" style="margin-bottom:16px"><${Icon} name="alert" /><div><b>판서 표시 ${problems.length}개를 문장에서 찾지 못했어요.</b>
      <div style="font-size:13.5px">${problems.slice(0, 4).map((p) => `${p.n}번 문장 "${p.text || ''}"`).join(', ')}${problems.length > 4 ? ' …' : ''}. 전체 데이터에서 고치거나, 그대로 두면 그 표시만 빠져요.</div></div></div>`}
    ${raw ? html`<div class="panel pad"><p class="muted" style="margin-top:0;font-size:13.5px">판서 표시(박스, 밑줄, S·V 표시), 내용 정리, 메모, 핵심 단어까지 모두 고칠 수 있는 원본 데이터예요. 형식이 깨지지 않게 조심해 주세요.</p>
      <textarea class="input" style="height:62vh;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;padding:12px;line-height:1.5" value=${rawText} onInput=${(e) => { setRawText(e.target.value); setDirty(true); }}></textarea></div>`
    : html`<div class=${`review ${big ? 'big' : ''}`}>
      <div class="board-frame">
        <div ref=${boardRef}></div>
        <div class="board-nav">
          <button class="btn ghost icon sm" disabled=${cur <= 0} onClick=${() => setCur(cur - 1)} aria-label="이전 단계"><${Icon} name="chevronLeft" /></button>
          <div class="bn-t"><b class="num">${cur + 1}</b><span class="num"> / ${steps.length}</span><span class="bn-v">${st ? `${VIEW_LABEL[st.view] || st.view}${st.n ? ` ${st.n}` : ''}` : ''}</span></div>
          <button class="btn ghost icon sm" disabled=${cur >= steps.length - 1} onClick=${() => setCur(cur + 1)} aria-label="다음 단계"><${Icon} name="chevronRight" /></button>
          <button class="btn ghost sm hide-m" onClick=${() => setBig(!big)} title=${big ? '작게 보기' : '크게 보기'}><${Icon} name=${big ? 'minimize' : 'maximize'} size="sm" />${big ? '작게' : '크게'}</button>
        </div>
        <div class="bn-hint hide-m">판서 위에서 휠을 굴리면 위아래로 볼 수 있어요. 키보드 ↑↓로 단계를 옮겨요</div>
      </div>
      <div class="panel steps-card" ref=${listRef}>
        <div class="panel-h" style="padding-bottom:8px"><h2>대본</h2><span class="spacer"></span><span class="muted hide-m" style="font-size:13px">단계를 누르면 판서가 그 장면으로 바뀌어요</span></div>
        <div class="say-help">대본 속 <code>{호명}</code> 자리에서 보는 학생의 이름을 불러요 (하준아). 넣거나 빼도 돼요. <code>[excited]</code> 같은 영어 표시는 목소리에 감정을 넣는 표시예요.</div>
        <div>${(big ? [[steps[cur], cur]] : steps.map((x, i) => [x, i])).filter(([x]) => x).map(([x, i]) => {
          const sent = x.view === 'sentence' ? script.sentences.find((q) => q.n === Number(x.n)) : null;
          return html`<div class=${`step-item ${i === cur ? 'on' : ''}`} data-i=${i} onClick=${() => setCur(i)}>
            <div class="sh"><span class="num si">${i + 1}</span><span class=${`chip ${x.view === 'sentence' ? 'ivy' : x.view === 'summary' ? 'sky' : x.view === 'memo' ? 'rose' : x.view === 'vocab' ? 'amber' : x.view === 'exam' ? 'board' : ''}`}>${VIEW_LABEL[x.view] || x.view}${x.n ? ` ${x.n}` : ''}</span>
              ${x.show && x.show.length ? html`<span class="faint">판서 ${x.show.length}개</span>` : null}
              ${/\{\s*호명\s*\}/.test(x.say || '') ? html`<span class="chip board" title="이 자리에서 보는 학생의 이름을 불러요">이름 부르기</span>` : null}<span class="spacer"></span>
              <span class="faint num">${(x.say || '').length}자</span>
              ${i === cur && html`<button class="btn ghost icon sm" title="이 단계 빼기" onClick=${(e) => { e.stopPropagation(); removeStep(i); }}><${Icon} name="trash" size="sm" /></button>`}</div>
            <textarea rows=${i === cur ? 5 : 2} value=${x.say} onInput=${(e) => setSay(i, e.target.value)} onFocus=${() => i !== cur && setCur(i)}></textarea>
            ${i === cur && sent && html`<div class="field" style="margin-top:10px"><label style="font-size:12.5px">${sent.n}번 문장 해석 (판서에 들어가요)</label><input value=${sent.ko} onChange=${(e) => setKo(sent.n, e.target.value)} /></div>`}
          </div>`;
        })}</div>
      </div></div>`}
    <div class="bottom-bar">
      ${dirty && html`<span class="muted" style="align-self:center;font-size:13px;margin-right:auto">저장하지 않은 변경이 있어요</span>`}
      <${Btn} icon="save" busy=${busy === 'save'} onClick=${() => save(false)}>저장</${Btn}>
      <${Btn} kind="primary" icon="video" busy=${busy === 'approve'} onClick=${() => save(true)}>저장하고 영상 만들기</${Btn}>
    </div>
  </div>`;
}

// ================================================================ 반: 과제, 학생, 시청표를 한곳에
const COLORS = ['#2f7d5b', '#2f6690', '#b07a12', '#c4513a', '#6d58b0', '#1f8088', '#5b6670'];

function ClassHub({ sel0, tab0, qs, info, ltNew = 0 }) {
  const cls = useAsync(() => api('/api/admin/classes'), []);
  const [ver, setVer] = useState(0);
  const [clsModal, setClsModal] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [creds, setCreds] = useState(null);
  const query = new URLSearchParams(qs || '');
  useEffect(() => {
    if (query.get('add')) setAddModal(true);
    if (query.get('new')) setClsModal({});
  }, [qs]);
  const classes = cls.data ? cls.data.classes : [];
  // 반이 하나도 없으면 반 만들기부터 권해요 (반 없는 학생은 왼쪽 목록에서 볼 수 있어요)
  const isLt = sel0 === 'lt';
  const sel = sel0 || (classes[0] ? String(classes[0].id) : '');
  const current = classes.find((c) => String(c.id) === sel) || null;
  const tab = sel === 'none' ? 'students' : ['assign', 'students', 'watch', 'scores'].includes(tab0) ? tab0 : 'assign';
  const refresh = () => {
    cls.reload(true);
    setVer((v) => v + 1);
    palCache = null;
  };
  const open = (id, t = tab) => go(`/classes/${id}${t && t !== 'assign' && id !== 'none' ? `/${t}` : ''}`);
  const delCls = async (c) => {
    if (!(await confirmBox({ title: `${c.name}을(를) 지울까요?`, body: '반에 있던 학생은 반 없음으로 옮겨지고, 이 반에 낸 과제는 지워져요. 학생 계정과 시청 기록은 남아요.', ok: '반 지우기', danger: true }))) return false;
    try {
      await api(`/api/admin/classes/${c.id}`, { method: 'DELETE' });
      toast('반을 지웠어요');
      cls.reload(true);
      go('/classes');
      return true;
    } catch (e) {
      toastErr(e);
      return false;
    }
  };
  if (cls.loading && !cls.data) return html`<div class="page"><div class="hub"><div><${Skel} h=${38} /><${Skel} h=${38} /><${Skel} h=${38} /></div><div><${Skel} h=${34} w="40%" mb=${20} /><${Skel} h=${260} /></div></div></div>`;
  const total = classes.reduce((a, c) => a + (c.students || 0), 0);
  if (sel0 && sel0 !== 'none' && !isLt && !current) return html`<div class="page"><div class="panel"><${Empty} icon="users" title="반을 찾을 수 없어요" action=${html`<${Btn} onClick=${() => go('/classes')}>반 목록으로</${Btn}>`}>지워졌거나 주소가 바뀌었어요.</${Empty}></div></div>`;
  return html`<div class="page">
    <div class="hub">
      <nav class="cls-list" aria-label="반 목록">
        <div class="grp">반 ${classes.length}개, 학생 ${total}명</div>
        ${classes.map((c) => html`<button class=${`cls-item ${sel === String(c.id) ? 'on' : ''}`} aria-current=${sel === String(c.id) ? 'page' : undefined} onClick=${() => open(c.id)}>
          <span class="cls-dot" style=${c.color ? `background:${c.color}` : ''}></span><span class="cn">${c.name}</span><span class="cc num">${c.students}</span></button>`)}
        <button class=${`cls-item ${sel === 'none' ? 'on' : ''}`} onClick=${() => open('none')}><span class="cls-dot" style="background:#c6cec8"></span><span class="cn">반 없는 학생</span></button>
        <${Btn} kind="ghost" size="sm" icon="plus" cls="add" onClick=${() => setClsModal({})}>반 만들기</${Btn}>
        <div class="grp">상담</div>
        <button class=${`cls-item ${isLt ? 'on' : ''}`} aria-current=${isLt ? 'page' : undefined} onClick=${() => go('/classes/lt')}><${Icon} name="clipboard" size="sm" /><span class="cn">레벨테스트</span>${ltNew > 0 && html`<span class="cc lt-cnt num" title=${`새 결과 ${ltNew}개`}>${ltNew}</span>`}</button>
      </nav>
      <div style="min-width:0">
        <div class="cls-chips">${classes.map((c) => html`<button class=${`pick ${sel === String(c.id) ? 'on' : ''}`} onClick=${() => open(c.id)}><span class="cls-dot" style=${c.color ? `background:${c.color}` : ''}></span>${c.name}</button>`)}
          <button class=${`pick ${sel === 'none' ? 'on' : ''}`} onClick=${() => open('none')}>반 없음</button>
          <button class="pick" onClick=${() => setClsModal({})}><${Icon} name="plus" size="sm" />반 만들기</button>
          <button class=${`pick ${isLt ? 'on' : ''}`} onClick=${() => go('/classes/lt')}><${Icon} name="clipboard" size="sm" />레벨테스트${ltNew > 0 ? html`<small class="num">${ltNew}</small>` : null}</button></div>
        ${isLt ? html`<${LtPage} id=${/^\d+$/.test(tab0 || '') ? tab0 : null} info=${info} />`
          : !sel ? html`<div class="panel"><${Empty} icon="users" title="반이 아직 없어요" action=${html`<${Btn} kind="primary" icon="plus" onClick=${() => setClsModal({})}>반 만들기</${Btn}>`}>반을 만들고 학생을 넣으면, 과제를 내고 누가 봤는지 볼 수 있어요.</${Empty}></div>`
          : html`
          <div class="hub-h">
            <div style="min-width:0"><h1><span class="cls-dot" style=${current && current.color ? `background:${current.color}` : current ? '' : 'background:#c6cec8'}></span>${current ? current.name : '반 없는 학생'}</h1>
              <div class="sub">${current ? [current.note, `학생 ${current.students}명`, `과제 ${current.assignments}개`].filter(Boolean).join(', ') : '반을 정하지 않은 학생이에요. 학생 고치기에서 반을 정할 수 있어요.'}</div></div>
            <div class="actions">
              ${current && html`<${Btn} kind="ghost" size="sm" icon="pencil" onClick=${() => setClsModal(current)}>반 고치기</${Btn}>`}
              <${Btn} icon="userPlus" onClick=${() => setAddModal(true)}>학생 넣기</${Btn}>
              ${current && html`<${Btn} kind="primary" icon="send" onClick=${() => openAssign({ classId: current.id, onDone: refresh })}>과제 내기</${Btn}>`}
            </div>
          </div>
          <div class="tabs" role="tablist">
            ${current && html`<a role="tab" aria-selected=${tab === 'assign'} class=${tab === 'assign' ? 'on' : ''} href=${`#/classes/${sel}`}>과제<span class="n num">${current.assignments}</span></a>`}
            <a role="tab" aria-selected=${tab === 'students'} class=${tab === 'students' ? 'on' : ''} href=${`#/classes/${sel}/students`}>학생${current && html`<span class="n num">${current.students}</span>`}</a>
            ${current && html`<a role="tab" aria-selected=${tab === 'watch'} class=${tab === 'watch' ? 'on' : ''} href=${`#/classes/${sel}/watch`}>시청표</a>`}
            ${current && html`<a role="tab" aria-selected=${tab === 'scores'} class=${tab === 'scores' ? 'on' : ''} href=${`#/classes/${sel}/scores`}>성적</a>`}
          </div>
          ${tab === 'assign' && current && html`<${ClassAssign} cls=${current} ver=${ver} academy=${info.academy_name} onChanged=${refresh} key=${current.id} />`}
          ${tab === 'students' && html`<${ClassStudents} sel=${sel} ver=${ver} classes=${classes} info=${info} focusId=${query.get('s')} onAdd=${() => setAddModal(true)} onCreds=${setCreds} onChanged=${refresh} key=${sel} />`}
          ${tab === 'watch' && current && html`<${ClassWatch} cls=${current} ver=${ver} key=${current.id} />`}
          ${tab === 'scores' && current && html`<${ClassScores} cls=${current} ver=${ver} key=${current.id} />`}`}
      </div>
    </div>
    ${clsModal && html`<${ClassModal} cls=${clsModal} onClose=${() => setClsModal(null)} onDelete=${delCls} onDone=${(id) => { refresh(); if (id) open(id, 'students'); }} />`}
    ${addModal && html`<${AddStudents} classes=${classes} defaultClass=${current ? current.id : ''} onClose=${() => setAddModal(false)} onDone=${(c) => { setCreds(c); refresh(); }} />`}
    ${creds && html`<${CredsModal} creds=${creds} info=${info} onClose=${() => setCreds(null)} />`}
  </div>`;
}

// ---------------------------------------------------------------- 레벨테스트 (반 → 레벨테스트). 화면 코드는 필요할 때만 불러요
let ltMod = null;
function LtPage({ id, info }) {
  const [M, setM] = useState(ltMod);
  useEffect(() => {
    if (!ltMod) {
      import('./lt/admin.js')
        .then((m) => {
          ltMod = m;
          setM(m);
        })
        .catch(toastErr);
    }
  }, []);
  if (!M) return html`<div><${Skel} h=${34} w="40%" mb=${20} /><${Skel} h=${260} /></div>`;
  return id ? html`<${M.LtDetail} id=${id} key=${id} info=${info} />` : html`<${M.LtHub} info=${info} />`;
}

function ClassAssign({ cls, ver, academy, onChanged }) {
  const { data, loading, reload } = useAsync(() => api(`/api/admin/assignments?class_id=${cls.id}`), [cls.id, ver]);
  const [editA, setEditA] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEvent('ivy:assigned', () => reload(true));
  // 목록에서 지우기(정리): 선생님 과제 목록과 오늘 화면에서만 빠지고, 학생 앱은 그대로예요
  const close = async (list, closed = true) => {
    setBusy(true);
    try {
      await api('/api/admin/assignments/close', { method: 'POST', body: { ids: list.map((a) => a.id), closed } });
      toast(!closed ? '다시 목록에 보여요' : list.length > 1 ? `과제 ${list.length}개를 목록에서 지웠어요` : '목록에서 지웠어요. 학생 앱은 그대로예요');
      reload(true);
      onChanged();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const del = async (a) => {
    if (!(await confirmBox({ title: '학생 앱에서도 지울까요?', body: `${a.class_name} 학생 앱에서 「${a.title}」이(가) 사라져서 다시 볼 수 없어요. 시청 기록과 점수는 남아요.`, ok: '학생 앱에서도 지우기', danger: true }))) return;
    try {
      await api(`/api/admin/assignments/${a.id}`, { method: 'DELETE' });
      toast('과제를 지웠어요');
      reload(true);
      onChanged();
    } catch (e) {
      toastErr(e);
    }
  };
  if (loading && !data) return html`<${Skel} h=${90} /><${Skel} h=${90} />`;
  const list = data ? data.assignments : [];
  const live = list.filter((a) => !a.closed_at);
  const closed = list.filter((a) => a.closed_at).sort((a, b) => b.closed_at - a.closed_at);
  const nowS = Date.now() / 1000;
  const isFinished = (a) => a.stats && a.stats.total > 0 && a.stats.done === a.stats.total;
  const finished = live.filter(isFinished);
  const open = live.filter((a) => !a.due_at || a.due_at >= nowS).sort((a, b) => (a.due_at || 9e12) - (b.due_at || 9e12));
  const past = live.filter((a) => a.due_at && a.due_at < nowS).sort((a, b) => b.due_at - a.due_at);
  const row = (a) => html`<${AsgRow} a=${a} academy=${academy} showClass=${false} onClick=${() => go(`/lecture/${a.lecture_id}`)}
    actions=${html`<span class="asg-acts">${isFinished(a) && html`<button class="btn soft sm" disabled=${busy} onClick=${(e) => { e.stopPropagation(); close([a]); }}><${Icon} name="check" size="sm" />목록에서 지우기</button>`}
      <button class="btn ghost icon sm" title="마감 고치기" aria-label="마감 고치기" onClick=${(e) => { e.stopPropagation(); setEditA(a); }}><${Icon} name="calendar" size="sm" /></button>
      ${!isFinished(a) && html`<button class="btn ghost icon sm" title="목록에서 지우기 (학생 앱은 그대로)" aria-label="목록에서 지우기" disabled=${busy} onClick=${(e) => { e.stopPropagation(); close([a]); }}><${Icon} name="x" size="sm" /></button>`}</span>`} />`;
  const closedBox = closed.length > 0 && html`<section class="panel asg-closed">
    <button class="panel-h asg-closed-h" aria-expanded=${showClosed} onClick=${() => setShowClosed(!showClosed)}><h2>목록에서 지운 과제</h2><span class="count num">${closed.length}</span><span class="spacer"></span>
      <span class="faint" style="font-size:13px;font-weight:500">학생 앱에는 그대로 있어요</span><${Icon} name=${showClosed ? 'chevronUp' : 'chevronDown'} size="sm" /></button>
    ${showClosed && html`<ul class="rows">${closed.map((a) => html`<li class="row asg-cl">
      <div style="flex:1;min-width:0"><b class="ellipsis" style="display:block">${a.title}</b><span class="faint num" style="font-size:12.5px">${a.due_at ? `마감 ${fmtDate(a.due_at)}, ` : ''}${fmtDate(a.closed_at)}에 지움</span></div>
      <button class="btn ghost sm" disabled=${busy} onClick=${() => close([a], false)}><${Icon} name="undo" size="sm" />다시 보이기</button>
      <button class="btn ghost icon sm" title="학생 앱에서도 지우기" aria-label="학생 앱에서도 지우기" onClick=${() => del(a)}><${Icon} name="trash" size="sm" /></button></li>`)}</ul>`}
  </section>`;
  if (!live.length) {
    return html`<div class="stack lg"><div class="panel"><${Empty} icon="send" title=${closed.length ? '진행 중인 과제가 없어요' : '이 반에 낸 과제가 없어요'} action=${html`<${Btn} kind="soft" icon="send" onClick=${() => openAssign({ classId: cls.id, onDone: onChanged })}>과제 내기</${Btn}>`}>완성된 강의를 과제로 내면 학생 앱에 바로 나타나요.</${Empty}></div>${closedBox}</div>`;
  }
  return html`<div class="stack lg">
    ${finished.length > 0 && html`<div class="notice asg-done-bar"><${Icon} name="checkCircle" /><div style="flex:1;min-width:0"><b>다 끝낸 과제가 ${finished.length}개 있어요</b><div class="muted" style="font-size:13px">반 학생 모두 강의를 다 보고 숙제까지 냈어요. 목록에서 지워도 학생 앱에는 그대로 있어서 다시 볼 수 있어요.</div></div>
      <${Btn} size="sm" icon="check" busy=${busy} onClick=${() => close(finished)}>${finished.length > 1 ? '모두 목록에서 지우기' : '목록에서 지우기'}</${Btn}></div>`}
    ${open.length > 0 && html`<section class="panel"><div class="panel-h"><h2>진행 중</h2><span class="count num">${open.length}</span></div><ul class="rows">${open.map(row)}</ul></section>`}
    ${past.length > 0 && html`<section class="panel"><div class="panel-h"><h2>마감 지난 과제</h2><span class="count num">${past.length}</span></div><ul class="rows">${past.map(row)}</ul></section>`}
    ${closedBox}
    ${editA && html`<${DueModal} a=${editA} onClose=${() => setEditA(null)} onDone=${() => reload(true)} />`}
  </div>`;
}

function ClassStudents({ sel, ver, classes, info, focusId, onAdd, onCreds, onChanged }) {
  const stu = useAsync(() => api(`/api/admin/students?class_id=${sel}`), [sel, ver]);
  const [q, setQ] = useState('');
  const [editStu, setEditStu] = useState(null);
  const [prog, setProg] = useState(null);
  useEffect(() => {
    if (focusId && stu.data) {
      const s = stu.data.students.find((x) => String(x.id) === String(focusId));
      if (s) setProg(s);
    }
  }, [focusId, stu.data]);
  const resetPw = async (s) => {
    if (!(await confirmBox({ title: `${s.name} 비밀번호를 새로 만들까요?`, body: '새 4자리 비밀번호가 만들어지고, 지금 로그인된 기기에서는 로그아웃돼요.', ok: '새로 만들기' }))) return;
    try {
      const r = await api(`/api/admin/students/${s.id}/password`, { method: 'POST', body: {} });
      onCreds([{ name: s.name, login_id: s.login_id, password: r.password }]);
    } catch (e) {
      toastErr(e);
    }
  };
  const delStu = async (s) => {
    if (!(await confirmBox({ title: `${s.name} 학생을 뺄까요?`, body: '학생이 더는 로그인할 수 없어요. 시청 기록은 남아 있어요.', ok: '빼기', danger: true }))) return;
    try {
      await api(`/api/admin/students/${s.id}`, { method: 'DELETE' });
      toast('뺐어요');
      onChanged();
    } catch (e) {
      toastErr(e);
    }
  };
  if (stu.loading && !stu.data) return html`<${Skel} h=${44} /><${Skel} h=${44} /><${Skel} h=${44} />`;
  const all = stu.data ? stu.data.students : [];
  const list = all.filter((s) => matches(s.name, q) || matches(s.login_id, q) || matches(s.school, q));
  if (!all.length) return html`<div class="panel"><${Empty} icon="userPlus" title="학생이 없어요" action=${html`<${Btn} kind="soft" icon="userPlus" onClick=${onAdd}>학생 넣기</${Btn}>`}>이름만 적으면 아이디와 비밀번호를 만들어 드려요.</${Empty}></div>`;
  return html`<div class="stack">
    ${all.length > 8 && html`<div class="search-in" style="max-width:320px"><${Icon} name="search" size="sm" /><input class="input" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="이름, 아이디로 찾기" aria-label="학생 찾기" /></div>`}
    <div class="panel"><div class="table-wrap"><table class="t">
      <thead><tr><th>이름</th><th>아이디</th><th class="hide-m">최근 접속</th><th>과제 완료</th><th></th></tr></thead>
      <tbody>${list.map((s) => html`<tr class="click" onClick=${() => setProg(s)}>
        <td><div class="row" style="gap:10px"><div class="avatar" style="width:32px;height:32px;font-size:13px">${initial(s.name)}</div><div style="min-width:0"><div style="font-weight:700">${s.name}</div>
          <div class="faint" style="font-size:12px">${[s.school, s.grade].filter(Boolean).join(' ')}${s.school || s.grade ? ', ' : ''}부를 때 '${s.call_name || callPreview(s.name)}'</div></div></div></td>
        <td class="num">${s.login_id}</td>
        <td class="hide-m muted">${s.last_login_at ? ago(s.last_login_at) : '접속 전'}</td>
        <td><span class="num" style="font-weight:700">${s.completed}/${s.assigned}</span></td>
        <td style="text-align:right;white-space:nowrap" onClick=${(e) => e.stopPropagation()}>
          <button class="btn ghost icon sm" title="비밀번호 새로 만들기" aria-label="비밀번호 새로 만들기" onClick=${() => resetPw(s)}><${Icon} name="key" size="sm" /></button>
          <button class="btn ghost icon sm" title="고치기" aria-label="고치기" onClick=${() => setEditStu(s)}><${Icon} name="pencil" size="sm" /></button>
          <button class="btn ghost icon sm" title="빼기" aria-label="빼기" onClick=${() => delStu(s)}><${Icon} name="trash" size="sm" /></button></td></tr>`)}</tbody></table></div></div>
    ${editStu && html`<${EditStudent} s=${editStu} classes=${classes} onClose=${() => setEditStu(null)} onDone=${onChanged} />`}
    ${prog && html`<${StudentProgressModal} student=${prog} onClose=${() => setProg(null)} />`}
  </div>`;
}

function ClassWatch({ cls, ver }) {
  const { data: raw, loading, reload } = useAsync(() => api(`/api/admin/watch?class_id=${cls.id}`), [cls.id, ver]);
  const [cell, setCell] = useState(null);
  const [stu, setStu] = useState(null);
  const [thr, setThr] = useState(90);
  const [allCols, setAllCols] = useState(false);
  // 목록에서 지운(끝난) 과제는 시청표에서도 감춰요. 엑셀로 받기에는 모두 들어가요
  const closedN = raw ? raw.lectures.filter((l) => l.closed_at).length : 0;
  const data = raw && !allCols ? { ...raw, lectures: raw.lectures.filter((l) => !l.closed_at) } : raw;
  // 끝냄: 강의를 다 보고, 숙제가 있으면 숙제까지 냄
  const fin = (l, c) => !!(c && c.completed_at && (!l.hw_n || c.hw));
  useEffect(() => {
    api('/api/admin/settings').then((r) => setThr(r.settings.complete_threshold)).catch(() => {});
    const t = setInterval(() => reload(true), 30000);
    return () => clearInterval(t);
  }, [cls.id]);
  if (loading && !data) return html`<${Skel} h=${300} />`;
  if (!data) return null;
  const showAll = closedN > 0 && html`<label class="wt-all"><input type="checkbox" checked=${allCols} onChange=${(e) => setAllCols(e.target.checked)} />목록에서 지운 과제도 보기 (${closedN})</label>`;
  if (!data.lectures.length) return html`<div class="panel"><${Empty} icon="clipboard" title=${closedN ? '진행 중인 과제가 없어요' : '이 반에 낸 과제가 없어요'} action=${closedN ? showAll : html`<${Btn} kind="soft" icon="send" onClick=${() => openAssign({ classId: cls.id, onDone: () => reload(true) })}>과제 내기</${Btn}>`}>완성된 강의를 과제로 내면 시청 기록이 쌓여요.</${Empty}></div>`;
  if (!data.students.length) return html`<div class="panel"><${Empty} icon="userPlus" title="이 반에 학생이 없어요" /></div>`;
  return html`<div class="panel" style="overflow:hidden">
    <div class="row wrap" style="padding:14px 18px;border-bottom:1px solid var(--line-2)"><div class="legend">
      <span><i class="cell done"></i>${thr}% 이상 봄</span><span><i class="cell part"></i>보는 중</span><span><i class="cell none"></i>안 봄</span><span><i class="cell none late"></i>마감 지남</span></div>
      <span class="spacer"></span>${showAll}<span class="faint hide-m" style="font-size:12.5px">30초마다 새로 고쳐져요</span>
      <a class="btn secondary sm" href=${`/api/admin/watch.csv?class_id=${cls.id}`}><${Icon} name="download" size="sm" />엑셀로 받기</a></div>
    <div class="table-wrap" style="max-height:70vh"><table class="matrix">
      <thead><tr><th class="sticky">학생</th>${data.lectures.map((l) => {
        const done = data.students.filter((s) => fin(l, data.cells[s.id] && data.cells[s.id][l.id])).length;
        return html`<th class=${`lh ${l.closed_at ? 'closed' : ''}`}><div class="clamp2">${l.title}</div><div class="due">${l.closed_at ? '목록에서 지움' : l.due_at ? `${fmtDate(l.due_at)}까지` : '마감 없음'}</div><div class="sum num">${done}/${data.students.length} 끝냄</div></th>`;
      })}</tr></thead>
      <tbody>${data.students.map((s) => {
        const row = data.cells[s.id] || {};
        const doneN = data.lectures.filter((l) => fin(l, row[l.id])).length;
        return html`<tr><td class="sticky" style="cursor:pointer" onClick=${() => setStu(s)}><div style="font-weight:700">${s.name}</div>
          <div class="faint" style="font-size:12px">${doneN}/${data.lectures.length} 끝냄, ${s.last_login_at ? `접속 ${ago(s.last_login_at)}` : '접속 전'}</div></td>
          ${data.lectures.map((l) => {
            const c = row[l.id];
            const late = l.due_at && l.due_at * 1000 < Date.now() && !(c && c.completed_at);
            const k = !c || !c.percent ? 'none' : c.completed_at ? 'done' : 'part';
            return html`<td class="c"><span class=${`cell ${k} ${late ? 'late' : ''}`} onClick=${() => setCell({ s, l, c })}>
              ${k === 'done' ? html`<${Icon} name="check" size="sm" />` : null}${c && c.percent ? `${c.percent}%` : '–'}</span>
              ${l.quiz_n > 0 && html`<span class=${`qcell num ${c && c.quiz ? '' : 'none'}`} title="확인 문제">${c && c.quiz ? `${c.quiz.score}/${c.quiz.total}` : '문제 –'}</span>`}
              ${l.hw_n > 0 && html`<span class=${`qcell hcell num ${c && c.hw ? '' : 'none'}`} title="숙제">${c && c.hw ? `숙제 ${c.hw.score}/${c.hw.total}` : '숙제 –'}</span>`}</td>`;
          })}</tr>`;
      })}</tbody></table></div>
    ${cell && html`<${Modal} title=${cell.s.name} onClose=${() => setCell(null)}>
      <div class="stack" style="padding-bottom:14px"><div class="muted">${cell.l.title}</div>
        <div class="row" style="gap:18px"><${Ring} value=${cell.c ? cell.c.percent : 0} size=${84} stroke=${8} />
          <div class="stack" style="gap:4px"><div><b>${cell.c && cell.c.completed_at ? '다 봤어요' : cell.c && cell.c.percent ? '보는 중이에요' : '아직 안 봤어요'}</b></div>
            ${cell.c && html`<div class="muted" style="font-size:14px">본 시간 ${fmtDur(cell.c.watched)} / ${fmtDur(cell.l.duration)}</div>
              <div class="muted" style="font-size:14px">마지막 시청 ${fmtDate(cell.c.updated_at, true)}</div><div class="muted" style="font-size:14px">재생 ${cell.c.views || 1}번</div>`}
            ${cell.c && cell.c.completed_at && html`<div class="muted" style="font-size:14px">완료 ${fmtDate(cell.c.completed_at, true)}</div>`}
            ${cell.l.quiz_n > 0 && html`<div style="font-size:14px">${cell.c && cell.c.quiz ? html`확인 문제 <b class="num">${cell.c.quiz.score}/${cell.c.quiz.total}</b> <span class="muted">(${fmtDate(cell.c.quiz.created_at, true)})</span>` : html`<span class="muted">확인 문제는 아직 안 풀었어요</span>`}</div>`}
            ${cell.l.hw_n > 0 && html`<div style="font-size:14px">${cell.c && cell.c.hw ? html`숙제 <b class="num">${cell.c.hw.score}/${cell.c.hw.total}</b> <span class="muted">(${fmtDate(cell.c.hw.created_at, true)})</span>` : html`<span class="muted">숙제는 아직 안 냈어요</span>`}</div>`}
            <button class="btn link" style="font-size:13.5px;justify-content:flex-start" onClick=${() => go(`/lecture/${cell.l.id}`)}>강의 화면에서 답안 보기</button></div></div></div></${Modal}>`}
    ${stu && html`<${StudentProgressModal} student=${stu} onClose=${() => setStu(null)} />`}
  </div>`;
}

function StudentProgressModal({ student, onClose }) {
  const { data } = useAsync(() => api(`/api/admin/students/${student.id}/progress`), [student.id]);
  return html`<${Modal} title=${student.name} onClose=${onClose} wide>
    ${!data ? html`<${Skel} h=${120} />` : html`<div class="stack" style="padding-bottom:16px">
      <div class="muted">${data.student.class_name || '반 없음'}, 아이디 ${data.student.login_id}, ${data.student.last_login_at ? `마지막 접속 ${ago(data.student.last_login_at)}` : '아직 접속 안 함'}</div>
      ${data.lectures.length ? html`<ul class="list">${data.lectures.map((l) => {
        const d = dueLabel(l.due_at);
        return html`<li><div class="row" style="gap:12px"><div style="flex:1;min-width:0"><div class="ellipsis" style="font-weight:700">${l.title}</div>
          <div class="row" style="margin-top:6px;gap:10px"><div style="flex:1"><${Bar} value=${l.percent} tone=${l.completed_at ? '' : 'seen'} /></div><b class="num" style="font-size:13px">${l.percent}%</b></div>
          <div class="faint" style="font-size:12px;margin-top:3px">${l.updated_at ? `마지막 ${ago(l.updated_at)}` : '안 봄'}${l.due_at ? `, ${fmtDate(l.due_at)}까지` : ''}${l.quiz_n > 0 ? `, 확인 문제 ${l.quiz_score !== null ? `${l.quiz_score}/${l.quiz_total}` : '안 풂'}` : ''}${l.hw_n > 0 ? `, 숙제 ${l.hw_score !== null ? `${l.hw_score}/${l.hw_total}` : '안 냄'}` : ''}</div></div>
          ${l.completed_at ? html`<span class="chip ivy"><${Icon} name="check" size="sm" />완료</span>` : d && html`<span class=${`chip ${d.tone}`}>${d.text}</span>`}</div></li>`;
      })}</ul>` : html`<${Empty} title="받은 과제가 없어요" />`}</div>`}
  </${Modal}>`;
}

function ClassModal({ cls, onClose, onDone, onDelete }) {
  const [name, setName] = useState(cls.name || '');
  const [note, setNote] = useState(cls.note || '');
  const [color, setColor] = useState(cls.color || COLORS[0]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (cls.id) {
        await api(`/api/admin/classes/${cls.id}`, { method: 'PUT', body: { name, note, color } });
        onDone();
      } else {
        const r = await api('/api/admin/classes', { method: 'POST', body: { name, note, color } });
        onDone(r.id);
      }
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${cls.id ? '반 고치기' : '반 만들기'} onClose=${onClose} footer=${html`
    ${cls.id && html`<${Btn} kind="danger" icon="trash" cls="hide-m" onClick=${async () => { if (await onDelete(cls)) onClose(); }} style="margin-right:auto">반 지우기</${Btn}>`}
    <${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} disabled=${!name.trim()} onClick=${save}>${cls.id ? '저장' : '만들기'}</${Btn}>`}>
    <div class="stack"><${Field} label="반 이름"><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="예: 고1 A반" /></${Field}>
      <${Field} label="메모 (선택)"><input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="예: 월수금 7시" /></${Field}>
      <div class="field"><label>색</label><div class="row" style="gap:10px">${COLORS.map((c) => html`<button type="button" onClick=${() => setColor(c)} aria-label=${`색 ${c}`} aria-pressed=${color === c}
        style=${`width:30px;height:30px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 2px ${color === c ? c : 'transparent'};cursor:pointer`}></button>`)}</div></div>
      ${cls.id && html`<div class="hide-d"><${Btn} kind="danger" icon="trash" block onClick=${async () => { if (await onDelete(cls)) onClose(); }}>반 지우기</${Btn}></div>`}</div>
  </${Modal}>`;
}

function AddStudents({ classes, defaultClass, onClose, onDone }) {
  const [mode, setMode] = useState('one');
  const [cid, setCid] = useState(defaultClass || '');
  const [one, setOne] = useState({ name: '', call_name: '', login_id: '', password: '', school: '', grade: '' });
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = bulk.split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((r) => r[0]).map(([name, login_id, password]) => ({ name, login_id, password, class_id: cid || null }));
  const save = async () => {
    setBusy(true);
    try {
      const body = mode === 'one' ? { ...one, class_id: cid || null } : { students: rows };
      const r = await api('/api/admin/students', { method: 'POST', body });
      onDone(r.created);
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="학생 넣기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} disabled=${mode === 'one' ? !one.name.trim() : !rows.length} onClick=${save}>${mode === 'one' ? '넣기' : `${rows.length}명 넣기`}</${Btn}>`}>
    <div class="stack">
      <${Seg} full value=${mode} onChange=${setMode} options=${[['one', '한 명씩'], ['bulk', '여러 명 한꺼번에']]} />
      <${Field} label="반"><select value=${cid} onChange=${(e) => setCid(e.target.value)}><option value="">반 없음</option>${classes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></${Field}>
      ${mode === 'one' ? html`<div class="grid2"><${Field} label="이름"><input value=${one.name} onInput=${(e) => setOne({ ...one, name: e.target.value })} placeholder="예: 김하준" /></${Field}>
          <${Field} label="강의에서 부를 이름 (선택)" hint=${`비우면 '${callPreview(one.name)}'`}><input value=${one.call_name} onInput=${(e) => setOne({ ...one, call_name: e.target.value })} placeholder="예: 하준아" /></${Field}></div>
        <div class="grid2"><${Field} label="아이디 (선택)" hint="비우면 자동으로 만들어요"><input value=${one.login_id} onInput=${(e) => setOne({ ...one, login_id: e.target.value })} autocapitalize="off" /></${Field}>
          <${Field} label="비밀번호 (선택)" hint="비우면 4자리 숫자"><input value=${one.password} onInput=${(e) => setOne({ ...one, password: e.target.value })} /></${Field}></div>
        <div class="grid2"><${Field} label="학교 (선택)"><input value=${one.school} onInput=${(e) => setOne({ ...one, school: e.target.value })} placeholder="예: 한빛고" /></${Field}>
          <${Field} label="학년 (선택)"><input value=${one.grade} onInput=${(e) => setOne({ ...one, grade: e.target.value })} placeholder="예: 1학년" /></${Field}></div>`
      : html`<${Field} label="학생 목록" hint="한 줄에 한 명: 이름, 아이디, 비밀번호 (아이디와 비밀번호는 비워도 돼요). 엑셀에서 복사해 붙여도 돼요.">
        <textarea rows="8" value=${bulk} onInput=${(e) => setBulk(e.target.value)} placeholder=${'김하준\n이서연, seoyeon\n박지호, jiho, 2580'}></textarea></${Field}>`}
    </div></${Modal}>`;
}

function EditStudent({ s, classes, onClose, onDone }) {
  const [f, setF] = useState({ name: s.name, call_name: s.call_name || '', login_id: s.login_id, class_id: s.class_id || '', school: s.school || '', grade: s.grade || '', memo: s.memo || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/students/${s.id}`, { method: 'PUT', body: { ...f, class_id: f.class_id || null } });
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="학생 고치기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} onClick=${save}>저장</${Btn}>`}>
    <div class="stack"><div class="grid2"><${Field} label="이름"><input value=${f.name} onInput=${set('name')} /></${Field}><${Field} label="아이디"><input value=${f.login_id} onInput=${set('login_id')} autocapitalize="off" /></${Field}></div>
      <${Field} label="강의에서 부를 이름" hint=${`비우면 '${callPreview(f.name)}'처럼 불러요. 별명이나 '하준 학생'처럼 적어도 돼요.`}><input value=${f.call_name} onInput=${set('call_name')} placeholder=${callPreview(f.name)} /></${Field}>
      <${Field} label="반"><select value=${f.class_id} onChange=${set('class_id')}><option value="">반 없음</option>${classes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></${Field}>
      <div class="grid2"><${Field} label="학교"><input value=${f.school} onInput=${set('school')} /></${Field}><${Field} label="학년"><input value=${f.grade} onInput=${set('grade')} /></${Field}></div>
      <${Field} label="메모"><input value=${f.memo} onInput=${set('memo')} /></${Field}></div></${Modal}>`;
}

function CredsModal({ creds, info, onClose }) {
  const url = location.origin;
  const text = creds.map((c) => `[${info.academy_name}] ${c.name} 학생 온라인 강의실 안내\n주소: ${url}\n아이디: ${c.login_id}\n비밀번호: ${c.password}\n휴대폰에서 주소를 열고 '홈 화면에 추가'를 누르면 앱처럼 쓸 수 있어요.`).join('\n\n');
  return html`<${Modal} title="로그인 정보" onClose=${onClose} footer=${html`<${Btn} icon="copy" onClick=${() => copyText(text)}>안내문 복사</${Btn}><${Btn} kind="primary" onClick=${onClose}>확인</${Btn}>`}>
    <div class="stack" style="padding-bottom:6px"><div class="notice amber"><${Icon} name="key" /><div>비밀번호는 지금만 보여요. 학생에게 전해 주거나 안내문을 복사해 두세요.</div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>이름</th><th>아이디</th><th>비밀번호</th></tr></thead>
        <tbody>${creds.map((c) => html`<tr><td style="font-weight:700">${c.name}</td><td class="num">${c.login_id}</td><td class="num" style="font-weight:800;letter-spacing:1px">${c.password}</td></tr>`)}</tbody></table></div></div></${Modal}>`;
}

// ================================================================ 설정
const SET_NAV = [['academy', 'school', '학원 정보'], ['board', 'type', '판서 스타일'], ['engine', 'cpu', '제작 엔진'], ['preview', 'phone', '학생 화면 보기'], ['account', 'user', '내 계정']];

function SettingsPage({ section, rc, info, me, onInfo, onLogout }) {
  const sec = SET_NAV.some((x) => x[0] === section) ? section : 'academy';
  let body;
  if (sec === 'board') body = html`<${BoardStyle} />`;
  else if (sec === 'engine') body = html`<${SettingsEngine} />`;
  else if (sec === 'preview') body = html`<${Preview} info=${info} />`;
  else if (sec === 'account') body = html`<${SettingsAccount} me=${me} info=${info} rc0=${!!rc} onLogout=${onLogout} />`;
  else body = html`<${SettingsAcademy} onInfo=${onInfo} />`;
  return html`<div class=${`page ${sec === 'board' ? 'wide' : ''}`}>
    <div class="set-layout">
      <nav class="set-nav" aria-label="설정 메뉴">${SET_NAV.map(([k, ic, label]) => html`<a href=${`#/settings${k === 'academy' ? '' : `/${k}`}`} class=${sec === k ? 'on' : ''} aria-current=${sec === k ? 'page' : undefined}><${Icon} name=${ic} size="sm" />${label}</a>`)}</nav>
      <div class="set-body">${body}</div>
    </div>
  </div>`;
}

function SettingsAcademy({ onInfo }) {
  const { data, reload } = useAsync(() => api('/api/admin/settings'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (data) setF({ ...data.settings });
  }, [data]);
  if (!f) return html`<${Skel} h=${30} w="40%" mb=${20} /><${Skel} h=${240} />`;
  const s = data.settings;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dirty = ['academy_name', 'app_name', 'header_text', 'academy_phone', 'complete_threshold', 'prevent_skip', 'default_minutes', 'default_tone'].some((k) => String(f[k] ?? '') !== String(s[k] ?? ''));
  const save = async () => {
    setBusy('save');
    try {
      await api('/api/admin/settings', { method: 'PUT', body: f });
      toast('저장했어요');
      reload(true);
      if (onInfo) onInfo();
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const upLogo = async (file) => {
    if (!file) return;
    setBusy('logo');
    try {
      await api('/api/admin/logo', { method: 'PUT', body: file, raw: true, headers: { 'Content-Type': file.type } });
      toast('로고를 바꿨어요');
      reload(true);
      if (onInfo) onInfo();
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  return html`<div class="ph"><div><h1>학원 정보</h1><div class="sub">학원 이름, 시청 규칙, 강의 기본값을 정해요.</div></div>
      <div class="actions"><${Btn} kind="primary" icon="save" busy=${busy === 'save'} disabled=${!dirty} onClick=${save}>저장</${Btn}></div></div>
    <div class="stack lg">
      <section class="panel"><div class="panel-h"><h2>학원</h2></div><div class="panel-b stack">
        <div class="row" style="gap:16px"><div class="logo-box chalkboard">${s.logo_url ? html`<img src=${s.logo_url} alt="학원 로고" />` : html`<${Icon} name="penLine" size="xl" />`}</div>
          <div class="stack" style="gap:6px"><div style="font-weight:700">로고</div><div class="row" style="gap:8px">
            <label class="btn secondary sm" style="cursor:pointer">${busy === 'logo' ? '올리는 중…' : '바꾸기'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr" onChange=${(e) => upLogo(e.target.files[0])} /></label>
            ${s.logo_url && html`<${Btn} kind="ghost" size="sm" onClick=${async () => { await api('/api/admin/logo', { method: 'DELETE' }); reload(true); if (onInfo) onInfo(); }}>지우기</${Btn}>`}</div>
            <div class="faint" style="font-size:12.5px">앱 아이콘 자리와 판서 영상·PDF 워터마크에 써요. 정사각형 그림이 좋아요.</div></div></div>
        <div class="grid2"><${Field} label="학원 이름"><input value=${f.academy_name} onInput=${set('academy_name')} /></${Field}>
          <${Field} label="앱 이름" hint="학생 앱 위쪽과 로그인 화면에 보여요"><input value=${f.app_name} onInput=${set('app_name')} /></${Field}></div>
        <div class="grid2"><${Field} label="판서 머리글 (선택)" hint="비우면 강의 출처가 들어가요"><input value=${f.header_text} onInput=${set('header_text')} placeholder="예: 고1 내신 대비반" /></${Field}>
          <${Field} label="학원 전화번호 (선택)" hint="출력용 숙제지 아래쪽에 들어가요"><input value=${f.academy_phone || ''} onInput=${set('academy_phone')} placeholder="예: 031-000-0000" inputmode="tel" /></${Field}></div>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>시청 규칙</h2></div><div class="panel-b stack">
        <div class="stack sm"><div class="label">완료로 칠 기준</div><${Seg} value=${Number(f.complete_threshold)} onChange=${(v) => setF({ ...f, complete_threshold: v })} options=${[[80, '80%'], [90, '90%'], [95, '95%'], [100, '100%']]} />
          <div class="faint" style="font-size:12.5px">학생이 실제로 재생한 구간만 세요. 빨리 넘긴 구간은 빠져요.</div></div>
        <${Switch} checked=${!!f.prevent_skip} onChange=${(v) => setF({ ...f, prevent_skip: v })} title="처음 볼 때 건너뛰기 막기" desc="아직 안 본 곳으로 넘기지 못하게 해요. 다 본 강의는 자유롭게 넘길 수 있어요." />
      </div></section>
      <section class="panel"><div class="panel-h"><h2>새 강의 기본값</h2></div><div class="panel-b stack">
        <div class="stack sm"><div class="label">강의 길이</div><${Seg} value=${Number(f.default_minutes)} onChange=${(v) => setF({ ...f, default_minutes: v })} options=${[[10, '10분'], [15, '15분'], [20, '20분']]} /></div>
        <div class="stack sm"><div class="label">말투</div><${Seg} value=${f.default_tone} onChange=${(v) => setF({ ...f, default_tone: v })} options=${TONE_OPTS} /></div>
      </div></section>
      ${dirty && html`<div class="bottom-bar"><span class="muted" style="align-self:center;font-size:13px;margin-right:auto">저장하지 않은 변경이 있어요</span><${Btn} kind="primary" icon="save" busy=${busy === 'save'} onClick=${save}>저장</${Btn}></div>`}
    </div>`;
}

function SettingsEngine() {
  const { data, reload } = useAsync(() => api('/api/admin/settings'), []);
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    const t = setInterval(() => reload(true), 20000);
    return () => clearInterval(t);
  }, []);
  if (!data) return html`<${Skel} h=${30} w="40%" mb=${20} /><${Skel} h=${240} />`;
  const s = data.settings;
  const on = engineOnline(s.engine_last_seen);
  const makeCode = async () => {
    if (s.engine_connected && !(await confirmBox({ title: '연결 코드를 새로 만들까요?', body: '지금 연결된 제작 엔진은 새 코드를 넣기 전까지 작동하지 않아요.', ok: '새로 만들기' }))) return;
    try {
      const r = await api('/api/admin/engine-token', { method: 'POST', body: {} });
      setCode(r.code);
      reload(true);
    } catch (e) {
      toastErr(e);
    }
  };
  const getInstaller = async () => {
    if (s.engine_connected && !(await confirmBox({ title: '설치 파일을 새로 받을까요?', body: '새 설치 파일을 받으면 지금 연결된 엔진은 새 설치 파일로 다시 설치하기 전까지 작동하지 않아요.', ok: '받기' }))) return;
    setBusy('inst');
    try {
      const r = await fetch('/api/admin/engine-installer', { method: 'POST', headers: { 'X-Ivy': '1' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error('설치 파일을 만들지 못했어요.');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'IvyEngine-Setup.bat';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2000);
      toast('설치 파일을 받았어요. 학원 PC에서 실행해 주세요');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const info = s.engine_info || {};
  return html`<div class="ph"><div><h1>제작 엔진</h1><div class="sub">학원 PC의 제작 엔진이 대본, 목소리, 판서 영상, 자막을 만들어요.</div></div></div>
    <div class="stack lg">
      <div class="eng-card chalkboard">
        <div class="ei"><${Icon} name="cpu" size="lg" /></div>
        <div style="flex:1;min-width:0"><div class="et">${on ? '켜져 있어요' : s.engine_connected ? '꺼져 있어요' : '아직 연결 전이에요'}</div>
          <div class="ed">${on ? `${info.host || '학원 PC'}에서 ${info.status || '대기 중'}` : s.engine_connected ? `마지막 연결 ${ago(s.engine_last_seen)}. 학원 PC에서 제작 엔진을 켜 주세요.` : '아래 순서대로 학원 PC에 설치해 주세요.'}</div></div>
        <span class=${`eng-dot ${on ? 'on' : s.engine_connected ? 'off' : ''}`}></span>
      </div>
      ${s.engine_info && html`<div class="eng-info"><span><i>PC</i>${info.host || '학원 PC'}</span><span><i>버전</i>${info.version || '-'}</span><span><i>마지막 연결</i>${ago(s.engine_last_seen)}</span></div>`}
      <section class="panel"><div class="panel-h"><h2>${s.engine_connected ? '다른 PC에 설치하거나 다시 설치하기' : '설치하기'}</h2></div><div class="panel-b stack">
        <ol class="how">
          <li>학원 PC(윈도우)에서 이 사이트에 로그인해요.</li>
          <li><b>엔진 설치 파일 받기</b>를 눌러 받은 파일을 실행해요. 파란 경고 창이 뜨면 <b>추가 정보 → 실행</b>을 눌러요.</li>
          <li>설치가 끝나면 엔진 설정 화면이 열려요. Claude API 키와 선생님 목소리를 골라 저장해요.</li>
        </ol>
        <p class="muted" style="margin:0;font-size:13.5px">그다음부터는 엔진이 스스로 새 버전으로 바뀌어요.</p>
        <div class="row wrap" style="gap:8px"><${Btn} kind="primary" icon="monitorDown" busy=${busy === 'inst'} onClick=${getInstaller}>엔진 설치 파일 받기</${Btn}>
          ${code ? null : html`<${Btn} kind="ghost" size="sm" icon="link" onClick=${makeCode}>연결 코드만 만들기</${Btn}>`}</div>
        ${s.engine_connected && html`<div class="faint" style="font-size:12.5px">설치 파일을 새로 받으면 예전 연결은 끊기고 새 연결로 바뀌어요. 설치 파일 안에 연결 정보가 있으니 다른 사람에게 보내지 마세요.</div>`}
        ${code && html`<div class="stack sm"><div class="code">${code}</div><div class="row" style="gap:8px"><${Btn} kind="primary" size="sm" icon="copy" onClick=${() => copyText(code)}>코드 복사</${Btn}><span class="faint" style="font-size:12.5px">이 코드는 지금만 보여요.</span></div></div>`}
      </div></section>
    </div>`;
}

function SettingsAccount({ me, info, rc0, onLogout }) {
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const { data: rc, reload } = useAsync(() => api('/api/admin/recovery'), []);
  const [rcOpen, setRcOpen] = useState(rc0);
  useEffect(() => {
    if (rc0) setRcOpen(true);
  }, [rc0]);
  const changePw = async () => {
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
  const closeRc = () => {
    setRcOpen(false);
    if (rc0) go('/settings/account');
  };
  const made = rc && rc.made_at ? fmtDate(rc.made_at).replace(/ \(.\)$/, '') : '';
  return html`<div class="ph"><div><h1>내 계정</h1><div class="sub">${me.name}, 아이디 ${me.login_id}</div></div>
      <div class="actions"><${Btn} icon="logout" onClick=${onLogout}>로그아웃</${Btn}></div></div>
    <div class="stack lg">
      <section class="panel"><div class="panel-h"><h2>비밀번호 바꾸기</h2></div><div class="panel-b stack">
        <div class="grid2"><${Field} label="지금 비밀번호"><input type="password" value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} autocomplete="current-password" /></${Field}>
          <${Field} label="새 비밀번호" hint="8자 이상"><input type="password" value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} autocomplete="new-password" /></${Field}></div>
        <div><${Btn} kind="primary" icon="lock" busy=${busy} disabled=${!pw.current || pw.next.length < 8} onClick=${changePw}>비밀번호 바꾸기</${Btn}></div>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>비밀번호를 잊었을 때</h2></div><div class="panel-b" style="padding-top:0;padding-bottom:0">
        <ul class="rc-list">
          <li><div class="ri"><${Icon} name="key" /></div>
            <div class="rt"><b>복구 코드</b><p>로그인 화면에서 ‘아이디나 비밀번호를 잊었어요’를 누르고 이 코드를 넣으면, 아이디를 확인하고 새 비밀번호를 정할 수 있어요.</p></div>
            <div class="ra">${!rc ? html`<${Skel} h=${24} w="96px" mb=${0} />` : rc.ready ? html`<span class="chip ivy"><span class="dot"></span>${made}에 만듦</span>` : html`<span class="chip rose"><span class="dot"></span>아직 없어요</span>`}
              <${Btn} size="sm" kind=${rc && !rc.ready ? 'primary' : 'secondary'} icon="key" onClick=${() => setRcOpen(true)}>${rc && rc.ready ? '새로 만들기' : '만들기'}</${Btn}></div></li>
          <li><div class="ri"><${Icon} name="shield" /></div>
            <div class="rt"><b>Cloudflare 비상 코드</b><p>복구 코드까지 잃어버렸을 때 쓰는 마지막 열쇠예요. Cloudflare 의 ivyclass 설정에 SETUP_CODE 비밀값(8자 이상)을 넣으면 그 값으로도 되찾을 수 있어요. 필요할 때 그 자리에서 넣어도 돼요.</p></div>
            <div class="ra">${rc && (rc.master ? html`<span class="chip ivy"><span class="dot"></span>넣어 둠</span>` : html`<span class="chip">안 넣음</span>`)}</div></li>
          <li><div class="ri"><${Icon} name="lock" /></div>
            <div class="rt"><b>브라우저에 저장</b><p>로그인할 때 브라우저가 비밀번호를 저장할지 물으면 ‘저장’을 눌러 두세요. 다음부터 아이디와 비밀번호가 저절로 채워져요.</p></div></li>
        </ul>
      </div></section>
    </div>
    ${rcOpen && rc && html`<${RecoveryModal} me=${me} info=${info} had=${rc.ready} onClose=${closeRc} onDone=${() => reload(true)} />`}`;
}

// 복구 코드 만들기: 지금 비밀번호를 확인하고, 새 코드를 한 번만 보여 줘요
function RecoveryModal({ me, info, had, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [replaced, setReplaced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [caps, onKey] = useCapsLock();
  const inp = useRef(null);
  useEffect(() => {
    if (inp.current) inp.current.focus();
  }, []);
  const make = async (e) => {
    if (e) e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/admin/recovery', { method: 'POST', body: { password: pw } });
      setReplaced(had);
      setCode(r.code);
      onDone();
    } catch (er) {
      setErr(er.message);
    }
    setBusy(false);
  };
  if (code) {
    return html`<${Modal} title="새 복구 코드" onClose=${onClose} footer=${html`<${Btn} kind="primary" onClick=${onClose}>보관했어요</${Btn}>`}>
      <div class="stack" style="padding-bottom:6px">
        <div class="notice amber"><${Icon} name="key" /><div>이 코드는 지금만 보여요. 휴대폰으로 사진을 찍거나 종이에 적어 집에 두세요.${replaced ? ' 예전 복구 코드는 이제 못 써요.' : ''}</div></div>
        <${RecoveryCard} code=${code} loginId=${me.login_id} academy=${info.academy_name} />
      </div></${Modal}>`;
  }
  return html`<${Modal} title=${had ? '복구 코드 새로 만들기' : '복구 코드 만들기'} onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" icon="key" busy=${busy} disabled=${!pw} onClick=${make}>만들기</${Btn}>`}>
    <form class="stack" style="padding-bottom:6px" onSubmit=${make}>
      ${had && html`<div class="notice amber"><${Icon} name="alert" /><div>새로 만들면 지금 가진 복구 코드는 바로 못 써요.</div></div>`}
      <${Field} label="지금 비밀번호" hint="본인인지 확인할게요" error=${err}><input ref=${inp} type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} onKeyDown=${onKey} onKeyUp=${onKey} autocomplete="current-password" />
        <${KeyWarn} value=${pw} caps=${caps} /></${Field}>
    </form></${Modal}>`;
}

function Preview({ info }) {
  const { data } = useAsync(() => api('/api/admin/preview/students'), []);
  const [uid, setUid] = useState('');
  useEffect(() => {
    if (data && data.students[0] && !uid) setUid(String(data.students[0].id));
  }, [data]);
  return html`<div class="ph"><div><h1>학생 화면 보기</h1><div class="sub">학생 앱에서 어떻게 보이는지 확인해요. 여기서 영상을 봐도 시청 기록은 남지 않아요.</div></div>
      <div class="actions">${data && data.students.length > 0 && html`<div class="field" style="width:240px"><select value=${uid} onChange=${(e) => setUid(e.target.value)} aria-label="학생 고르기">
        ${data.students.map((s) => html`<option value=${s.id}>${s.name}${s.class_name ? ` (${s.class_name})` : ''}</option>`)}</select></div>`}</div></div>
    ${data && !data.students.length ? html`<div class="panel"><${Empty} icon="users" title="학생이 없어요" action=${html`<${Btn} kind="soft" onClick=${() => go(`/classes?add=${Date.now()}`)}>학생 넣기</${Btn}>`} /></div>`
      : uid && html`<div style="display:flex;justify-content:center"><div class="phone"><div class="scr"><${StudentApp} info=${info} preview=${Number(uid)} key=${uid} /></div></div></div>`}`;
}

// 판서 스타일
const STYLE_COLORS = [
  ['subject', '주어·목적어'],
  ['verb', '동사'],
  ['modifier', '수식어 박스·괄호'],
  ['connector', '연결어 동그라미'],
  ['note', '위쪽 메모'],
  ['highlight', '형광펜'],
  ['accent', '번호·제목 줄'],
];

function BoardStyle() {
  const { data } = useAsync(() => api('/api/admin/settings'), []);
  const [st, setSt] = useState(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (data) {
      const v = normalizeStyle(data.settings.board_style);
      setSt(v);
      setSaved(JSON.stringify(v));
    }
  }, [data]);
  const drawKey = st ? JSON.stringify({ ...st, rules: '' }) : '';
  useEffect(() => {
    if (!st || !ref.current) return;
    let b = null;
    const t = setTimeout(() => {
      ref.current.innerHTML = '';
      b = mountBoard(ref.current, DEMO_SCRIPT, { mode: 'preview', academy: data.settings.academy_name, header: '판서 스타일 미리보기', style: st });
      b.ready.then(() => {
        b.resetTo(99);
        b.setScroll(0);
      });
    }, 120);
    return () => {
      clearTimeout(t);
      if (b) b.destroy();
    };
  }, [drawKey]);
  if (!st) return html`<${Skel} h=${30} w="40%" mb=${20} /><${Skel} h=${360} />`;
  const set = (patch) => setSt({ ...st, ...patch });
  const setColor = (k, v) => setSt({ ...st, colors: { ...st.colors, [k]: v } });
  const preset = (key) => {
    const p = STYLE_PRESETS[key].style;
    setSt(normalizeStyle({ ...DEFAULT_STYLE, ...p, colors: { ...DEFAULT_STYLE.colors, ...(p.colors || {}) }, rules: st.rules }));
  };
  const dirty = JSON.stringify(st) !== saved;
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { board_style: st } });
      setSaved(JSON.stringify(st));
      toast('판서 스타일을 저장했어요');
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<div class="ph"><div><h1>판서 스타일</h1><div class="sub">고르면 판서가 바로 바뀌어요. 저장하면 이제부터 만드는 영상과 판서노트에 들어가요.</div></div>
      <div class="actions"><${Btn} kind="primary" icon="save" busy=${busy} disabled=${!dirty} onClick=${save}>저장</${Btn}></div></div>
    <div class="style-grid">
      <div class="stack lg">
        <section class="panel pad stack">
          <div class="label">빠르게 고르기</div>
          <div class="row wrap" style="gap:8px">${Object.entries(STYLE_PRESETS).map(([k, p]) => html`<button class="btn secondary sm" onClick=${() => preset(k)}>${p.label}</button>`)}</div>
          <div class="stack sm"><div class="label">손글씨</div><${Seg} full value=${st.hand} onChange=${(v) => set({ hand: v })} options=${[['gaegu', '둥근 손글씨'], ['pen', '펜 손글씨'], ['print', '정자체']]} /></div>
          <div class="stack sm"><div class="label">영어 본문 글꼴</div><${Seg} full value=${st.en_font} onChange=${(v) => set({ en_font: v })} options=${[['serif', '명조 (교재 느낌)'], ['sans', '고딕']]} /></div>
          <div class="stack sm"><div class="label">동사</div><${Seg} full value=${st.verb_mark} onChange=${(v) => set({ verb_mark: v })} options=${[['circle', '동그라미'], ['under', '밑줄']]} /></div>
          <div class="stack sm"><div class="label">구·절 묶기 (준동사구, 명사절, 문두 부사, 수식어)</div><${Seg} full value=${st.modifier} onChange=${(v) => set({ modifier: v })} options=${[['paren', '괄호 ( )'], ['paren2', '구 ( ), 절 [ ]'], ['box', '둥근 박스']]} /></div>
          <div class="stack sm"><div class="label">절과 절을 잇는 등위접속사</div><${Seg} full value=${st.conj_mark} onChange=${(v) => set({ conj_mark: v })} options=${[['triangle', '세모'], ['circle', '동그라미'], ['none', '표시 안 함']]} /></div>
          <div class="stack sm"><div class="label">성분 이름표</div><${Seg} full value=${st.labels} onChange=${(v) => set({ labels: v })} options=${[['en', 'S V O C'], ['ko', '주 동 목 보'], ['none', '쓰지 않기']]} /></div>
          <div class="stack sm"><div class="label">해석</div><${Seg} full value=${st.ko} onChange=${(v) => set({ ko: v })} options=${[['always', '처음부터 보이기'], ['step', '그 문장 설명할 때 나타나기']]} /></div>
          ${st.verb_mark === 'circle' && html`<${Switch} checked=${st.sc_circle} onChange=${(v) => set({ sc_circle: v })} title="2형식은 동사와 보어를 한 동그라미로" desc="'~다'로 해석하는 대로 묶어요. 보어가 3단어까지일 때만 묶어요" />`}
          <${Switch} checked=${st.long_paren} onChange=${(v) => set({ long_paren: v })} title=${st.sc_circle ? '3단어 이상 주어·목적어는 괄호' : '3단어 이상 주어·목적어·보어는 괄호'}
            desc=${st.sc_circle ? '밑줄 대신 구로 보고 괄호로 묶어요. 2형식 보어는 3단어가 넘으면 괄호' : '밑줄 대신 구로 보고 괄호로 묶어요'} />
          ${st.modifier === 'box' && html`<${Switch} checked=${st.fill} onChange=${(v) => set({ fill: v })} title="박스 안 연하게 칠하기" desc="끄면 테두리만 그려요" />`}
        </section>
        <section class="panel pad">
          <div class="label" style="margin-bottom:10px">색</div>
          <div class="color-grid">${STYLE_COLORS.map(([k, label]) => html`<label class="color-item"><input type="color" value=${st.colors[k]} onInput=${(e) => setColor(k, e.target.value)} /><span>${label}</span>
            ${st.colors[k] !== DEFAULT_STYLE.colors[k] && html`<button class="btn ghost sm" style="margin-left:auto;height:28px;padding:0 8px" onClick=${(e) => { e.preventDefault(); setColor(k, DEFAULT_STYLE.colors[k]); }}>기본</button>`}</label>`)}</div>
        </section>
        <section class="panel pad stack">
          <div class="row"><div style="flex:1"><div style="font-weight:750">내 판서 규칙</div><div class="muted" style="font-size:13.5px;margin-top:2px">AI가 대본과 판서를 쓸 때 이 규칙을 따라요. 새로 만드는 강의부터 적용돼요.</div></div>
            ${st.rules !== DEFAULT_STYLE.rules && html`<${Btn} kind="ghost" size="sm" onClick=${() => set({ rules: DEFAULT_STYLE.rules })}>처음 규칙으로</${Btn}>`}</div>
          <textarea class="input" style="height:340px;padding:12px;line-height:1.6;font-size:14px" value=${st.rules} onInput=${(e) => set({ rules: e.target.value })}
            placeholder=${'예)\n- 관계사절은 꼭 박스로 묶고 선행사에 화살표\n- 연결어(However, Yet 등)는 빠짐없이 동그라미\n- 수일치가 나오면 동사 위에 "수일치" 메모\n- 끊어 읽기 슬래시는 문장마다 2~3개'}></textarea>
        </section>
        <div class="notice"><${Icon} name="info" /><div style="font-size:13.5px">이미 만든 영상은 그대로예요. 바꾼 스타일로 다시 만들려면 강의 화면에서 <b>대본 고쳐서 다시 만들기 → 저장하고 영상 만들기</b>를 눌러 주세요.</div></div>
      </div>
      <div class="style-preview"><div class="board-frame"><div ref=${ref}></div><div class="bn-hint">판서 위에서 휠을 굴리면 아래 메모와 핵심 단어도 볼 수 있어요</div></div></div>
    </div>`;
}
