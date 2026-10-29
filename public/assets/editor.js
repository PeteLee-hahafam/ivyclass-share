// 강의 편집: 잘라내기, 목차, 영상 위에 그리기, 자막, AI 요약
// 영상 파일은 그대로 두고 편집 정보만 저장해요. 학생 앱이 그 정보대로 건너뛰고, 그리고, 자막을 보여 줘요.
import { html, useState, useEffect, useRef, api, Icon, Btn, Field, Seg, Switch, Empty, Skel, toast, toastErr, confirmBox, go, useAsync } from './ui.js';
import { Player, parseVtt, toVtt, fmtT, videoRect, drawStroke } from './player.js';

const PENS = [['#e5372b', '빨간펜'], ['#2457d6', '파란펜'], ['#1e8a5a', '초록펜'], ['#1c2440', '검정'], ['#ffd400', '노랑']];
const WIDTHS = [[4, '가늘게'], [7, '보통'], [12, '굵게']];
const HOLDS = [[5, '5초'], [10, '10초'], [0, '끝까지']];
const r2 = (x) => Math.round(Number(x) * 100) / 100;

function parseSrt(text) {
  return parseVtt(`WEBVTT\n\n${String(text || '').replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2')}`);
}

// 영상 위에 손으로 그리는 판
function DrawLayer({ getVideo, pen, onStroke }) {
  const ref = useRef(null);
  const cv = useRef(null);
  const cur = useRef(null);
  const box = () => {
    const el = ref.current;
    const W = el.clientWidth;
    const H = el.clientHeight;
    return { W, H, r: videoRect(getVideo(), W, H) };
  };
  const toPt = (e) => {
    const b = ref.current.getBoundingClientRect();
    const { r } = box();
    const x = Math.round(((e.clientX - b.left - r.x) / r.w) * 1000);
    const y = Math.round(((e.clientY - b.top - r.y) / r.h) * 1000);
    return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y))];
  };
  const paint = () => {
    const c = cv.current;
    const { W, H, r } = box();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (cur.current && cur.current.p.length >= 4) drawStroke(g, cur.current, r);
  };
  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    ref.current.setPointerCapture(e.pointerId);
    const v = getVideo();
    cur.current = { ...pen, t: r2(v ? v.currentTime : 0), p: toPt(e) };
    paint();
  };
  const move = (e) => {
    const s = cur.current;
    if (!s || s.p.length > 3000) return;
    const [x, y] = toPt(e);
    const lx = s.p[s.p.length - 2];
    const ly = s.p[s.p.length - 1];
    if (Math.hypot(x - lx, y - ly) >= 3) {
      s.p.push(x, y);
      paint();
    }
  };
  const up = () => {
    const s = cur.current;
    cur.current = null;
    if (s) {
      if (s.p.length === 2) s.p.push(s.p[0] + 1, s.p[1] + 1);
      onStroke(s);
    }
    paint();
  };
  return html`<div class="ed-draw" ref=${ref} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}><canvas ref=${cv}></canvas></div>`;
}

// 편집 시간 막대: 잘라낸 곳, 목차, 그림 자리, 지금 위치
function EdLine({ dur, t, edit, pending, onSeek }) {
  const ref = useRef(null);
  const pc = (x) => `${Math.max(0, Math.min(100, (x / (dur || 1)) * 100))}%`;
  const groups = [...new Set((edit.strokes || []).map((s) => Math.round(s.t * 10) / 10))];
  const click = (e) => {
    const b = ref.current.getBoundingClientRect();
    onSeek(((e.clientX - b.left) / b.width) * dur);
  };
  return html`<div class="ed-line" ref=${ref} onClick=${click} role="slider" aria-label="편집 위치" aria-valuenow=${Math.round(t)} aria-valuemax=${Math.round(dur)}>
    ${(edit.cuts || []).map(([a, b]) => html`<i class="cut" style=${`left:${pc(a)};width:calc(${pc(b)} - ${pc(a)})`}></i>`)}
    ${pending !== null && html`<i class="cut pend" style=${`left:${pc(Math.min(pending, t))};width:calc(${pc(Math.max(pending, t))} - ${pc(Math.min(pending, t))})`}></i>`}
    ${(edit.chapters || []).map((c) => html`<b class="chap" style=${`left:${pc(c.t)}`} title=${c.title}></b>`)}
    ${groups.map((g) => html`<b class="ink" style=${`left:${pc(g)}`}></b>`)}
    <span class="head" style=${`left:${pc(t)}`}></span>
    <span class="ticks"><span>0:00</span><span>${fmtT(dur / 2)}</span><span>${fmtT(dur)}</span></span>
  </div>`;
}

function TaskState({ task, label }) {
  if (!task) return null;
  if (task.status === 'queued') return html`<div class="notice"><${Icon} name="hourglass" /><div><b>${label} 차례를 기다리고 있어요.</b><div style="font-size:13px">학원 PC의 제작 엔진이 켜져 있으면 곧 시작해요.</div></div></div>`;
  if (task.status === 'running') return html`<div class="task-run"><div class="row between" style="font-size:13.5px"><b>${task.progress_msg || `${label} 만드는 중`}</b><span class="num muted">${task.progress || 0}%</span></div><div class="hl-track"><i style=${`width:${task.progress || 0}%`}></i></div></div>`;
  if (task.status === 'failed') return html`<div class="notice rose"><${Icon} name="alert" /><div><b>${label}을 만들지 못했어요.</b><div style="font-size:13px">${task.error || ''}</div></div></div>`;
  return null;
}

export function Editor({ id }) {
  const { data, loading, reload } = useAsync(() => api(`/api/admin/lectures/${id}`), [id]);
  const [edit, setEdit] = useState(null);
  const [saved, setSaved] = useState('');
  const [tab, setTab] = useState('cut');
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [pending, setPending] = useState(null);
  const [skip, setSkip] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [pen, setPen] = useState({ c: '#e5372b', w: 7, k: 'pen', d: 10 });
  const [chTitle, setChTitle] = useState('');
  const [cues, setCues] = useState(null);
  const [cuesDirty, setCuesDirty] = useState(false);
  const [subUrl, setSubUrl] = useState(null);
  const [sm, setSm] = useState(undefined);
  const [smDirty, setSmDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const pl = useRef(null);
  const cueBox = useRef(null);

  // 처음 한 번만 서버 내용으로 채워요 (고치는 중에 새로 고쳐져도 지우지 않게)
  useEffect(() => {
    if (!data) return;
    if (edit === null) {
      const e = { cuts: data.lecture.edit.cuts || [], chapters: data.lecture.edit.chapters || [], strokes: data.lecture.edit.strokes || [] };
      setEdit(e);
      setSaved(JSON.stringify(e));
    }
    if ((sm === undefined || (!sm && data.lecture.summary)) && !smDirty) setSm(data.lecture.summary);
    const u = data.files.subtitle || null;
    if (u !== subUrl && !cuesDirty) {
      setSubUrl(u);
      if (u) fetch(u, { credentials: 'same-origin' }).then((r) => r.text()).then((x) => setCues(parseVtt(x))).catch(() => setCues([]));
      else setCues([]);
    }
  }, [data]);

  const tasks = (data && data.tasks) || [];
  const last = (k) => tasks.find((x) => x.kind === k);
  const active = tasks.some((x) => x.status === 'queued' || x.status === 'running');
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => reload(true), 4000);
    return () => clearInterval(iv);
  }, [active]);
  useEffect(() => {
    const iv = setInterval(() => {
      const v = pl.current && pl.current.video;
      if (v) {
        setT(v.currentTime);
        if (v.duration && Number.isFinite(v.duration)) setDur(v.duration);
      }
    }, 200);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (drawing && pl.current) pl.current.pause();
  }, [drawing]);
  // 지금 말하는 자막 줄로 따라가요
  useEffect(() => {
    if (tab !== 'sub' || !cueBox.current || !cues) return;
    const k = cues.findIndex((c) => t >= c.s && t < c.e);
    const el = k >= 0 && cueBox.current.querySelector(`[data-k="${k}"]`);
    if (el && document.activeElement && document.activeElement.tagName !== 'INPUT') el.scrollIntoView({ block: 'nearest' });
  }, [Math.floor(t * 2), tab]);

  if (loading && !data) return html`<div class="page"><${Skel} h=${30} w="40%" mb=${20} /><${Skel} h=${420} /></div>`;
  if (!data || !edit) return html`<div class="page"><${Empty} title="강의를 찾을 수 없어요" action=${html`<${Btn} onClick=${() => go('/lectures')}>강의 목록으로</${Btn}>`} /></div>`;
  const lec = data.lecture;
  if (!lec.has_video) return html`<div class="page"><${Empty} icon="video" title="영상이 아직 없어요" action=${html`<${Btn} onClick=${() => go(`/lecture/${id}`)}>강의로 돌아가기</${Btn}>`}>영상이 만들어지거나 올라가면 편집할 수 있어요.</${Empty}></div>`;

  const dirty = JSON.stringify(edit) !== saved;
  const seek = (x) => pl.current && pl.current.seek(Math.max(0, x));
  const now = () => r2((pl.current && pl.current.video && pl.current.video.currentTime) || 0);
  const upd = (patch) => setEdit({ ...edit, ...patch });

  const saveEdit = async () => {
    setBusy('save');
    try {
      const r = await api(`/api/admin/lectures/${id}/edit`, { method: 'PUT', body: edit });
      setEdit(r.edit);
      setSaved(JSON.stringify(r.edit));
      toast('편집을 저장했어요. 학생 앱에 바로 반영돼요');
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const runTask = async (kind, again) => {
    if (again && !(await confirmBox({ title: kind === 'transcribe' ? '자막을 다시 만들까요?' : 'AI 요약을 다시 만들까요?', body: '지금 내용은 새로 만든 것으로 바뀌어요.', ok: '다시 만들기' }))) return;
    try {
      await api(`/api/admin/lectures/${id}/tasks`, { method: 'POST', body: { kind } });
      toast('제작 엔진에 요청했어요');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
  };

  // ---------------------------------------------------------------- 자르기
  const cutStart = () => setPending(now());
  const cutEnd = () => {
    const a = Math.min(pending, now());
    const b = Math.max(pending, now());
    setPending(null);
    if (b - a < 0.5) return toast('0.5초 이상 골라 주세요', 'err');
    upd({ cuts: [...edit.cuts, [r2(a), r2(b)]].sort((x, y) => x[0] - y[0]) });
  };
  const cutTab = html`<div class="stack">
    <p class="muted ed-p">영상 파일은 그대로 두고 학생 앱에서만 건너뛰어요. 잘라낸 곳은 시청률에서도 빠져요.</p>
    ${pending === null
      ? html`<${Btn} kind="primary" icon="scissors" onClick=${cutStart}>지금 위치(${fmtT(t)})부터 자르기</${Btn}>`
      : html`<div class="row wrap" style="gap:8px"><${Btn} kind="primary" icon="scissors" onClick=${cutEnd}>${fmtT(pending)}부터 ${fmtT(t)}까지 자르기</${Btn}><${Btn} kind="ghost" onClick=${() => setPending(null)}>취소</${Btn}></div>
        <div class="faint" style="font-size:13px">영상을 움직여 잘라낼 끝 지점을 고른 다음 눌러 주세요.</div>`}
    <${Switch} checked=${skip} onChange=${setSkip} title="잘라낸 곳 건너뛰며 보기" desc="학생이 보는 것처럼 미리 볼 수 있어요" />
    ${edit.cuts.length ? html`<ul class="ed-list">${edit.cuts.map(([a, b], i) => html`<li><button class="tm num" onClick=${() => seek(a)}>${fmtT(a)} ~ ${fmtT(b)}</button><span class="faint">${Math.round(b - a)}초</span><span class="spacer"></span>
        <button class="btn ghost icon sm" title="빼기" onClick=${() => upd({ cuts: edit.cuts.filter((_, j) => j !== i) })}><${Icon} name="x" size="sm" /></button></li>`)}</ul>`
      : html`<div class="ed-empty">잘라낸 곳이 없어요. 말이 끊긴 곳이나 필요 없는 부분을 골라 보세요.</div>`}
  </div>`;

  // ---------------------------------------------------------------- 목차
  const addChapter = () => {
    const title = chTitle.trim() || `목차 ${edit.chapters.length + 1}`;
    upd({ chapters: [...edit.chapters, { t: now(), title }].sort((a, b) => a.t - b.t) });
    setChTitle('');
  };
  const smChapters = (sm && sm.chapters) || [];
  const chapTab = html`<div class="stack">
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><input value=${chTitle} onInput=${(e) => setChTitle(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && addChapter()} placeholder="예: 관계대명사 what" /></div>
      <${Btn} kind="primary" icon="flag" onClick=${addChapter}>${fmtT(t)}에 넣기</${Btn}></div>
    ${smChapters.length > 0 && JSON.stringify(smChapters) !== JSON.stringify(edit.chapters) && html`<${Btn} icon="sparkles" onClick=${() => upd({ chapters: smChapters })}>AI가 만든 목차 ${smChapters.length}개 가져오기</${Btn}>`}
    ${edit.chapters.length ? html`<ul class="ed-list">${edit.chapters.map((c, i) => html`<li><button class="tm num" onClick=${() => seek(c.t)}>${fmtT(c.t)}</button>
        <input class="input sm" value=${c.title} onInput=${(e) => upd({ chapters: edit.chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
        <button class="btn ghost icon sm" title="빼기" onClick=${() => upd({ chapters: edit.chapters.filter((_, j) => j !== i) })}><${Icon} name="x" size="sm" /></button></li>`)}</ul>`
      : html`<div class="ed-empty">목차가 있으면 학생이 원하는 부분을 다시 찾아보기 쉬워요.</div>`}
  </div>`;

  // ---------------------------------------------------------------- 그리기
  const groups = [];
  for (const s of edit.strokes) {
    const g = groups.find((x) => Math.abs(x.t - s.t) < 0.05);
    if (g) g.list.push(s);
    else groups.push({ t: s.t, d: s.d, list: [s] });
  }
  const drawTab = html`<div class="stack">
    <${Switch} checked=${drawing} onChange=${setDrawing} title="영상 위에 그리기" desc="켜면 영상이 멈추고, 화면에 바로 그릴 수 있어요. 학생은 그 순간부터 그림을 봐요." />
    <div class=${`stack ${drawing ? '' : 'dim'}`} style="gap:12px">
      <${Seg} full value=${pen.k} onChange=${(k) => setPen({ ...pen, k, w: k === 'hl' ? 30 : 7, c: k === 'hl' ? '#ffd400' : pen.c === '#ffd400' ? '#e5372b' : pen.c })} options=${[['pen', '펜'], ['hl', '형광펜']]} />
      <div class="swatches">${PENS.map(([c, label]) => html`<button class=${pen.c === c ? 'on' : ''} style=${`--sw:${c}`} title=${label} aria-label=${label} onClick=${() => setPen({ ...pen, c })}></button>`)}</div>
      ${pen.k === 'pen' && html`<${Seg} full value=${pen.w} onChange=${(w) => setPen({ ...pen, w })} options=${WIDTHS} />`}
      <div><div class="label" style="margin-bottom:6px">그림이 보이는 시간</div><${Seg} full value=${pen.d} onChange=${(d) => setPen({ ...pen, d })} options=${HOLDS} /></div>
      <div class="row" style="gap:8px"><${Btn} size="sm" icon="undo" disabled=${!edit.strokes.length} onClick=${() => upd({ strokes: edit.strokes.slice(0, -1) })}>되돌리기</${Btn}></div>
    </div>
    ${groups.length ? html`<ul class="ed-list">${groups.map((g) => html`<li><button class="tm num" onClick=${() => seek(g.t)}>${fmtT(g.t)}</button><span>그림 ${g.list.length}개</span><span class="faint">${g.d > 0 ? `${g.d}초 동안` : '끝까지'}</span><span class="spacer"></span>
        <button class="btn ghost icon sm" title="이 그림 지우기" onClick=${() => upd({ strokes: edit.strokes.filter((s) => Math.abs(s.t - g.t) >= 0.05) })}><${Icon} name="eraser" size="sm" /></button></li>`)}</ul>`
      : html`<div class="ed-empty">중요한 곳에 동그라미, 밑줄, 화살표를 그려 보세요.</div>`}
  </div>`;

  // ---------------------------------------------------------------- 자막
  const tr = last('transcribe');
  const saveCues = async () => {
    setBusy('sub');
    try {
      await api(`/api/admin/lectures/${id}/subtitle`, { method: 'PUT', body: toVtt(cues), raw: true, headers: { 'Content-Type': 'text/vtt' } });
      setCuesDirty(false);
      toast('자막을 저장했어요');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const loadSubFile = async (f) => {
    if (!f) return;
    const text = await f.text();
    const list = /-->/.test(text) && !/^\s*WEBVTT/.test(text) ? parseSrt(text) : parseVtt(text);
    if (!list.length) return toast('자막 파일을 읽지 못했어요', 'err');
    setCues(list);
    setCuesDirty(true);
  };
  const curCue = cues ? cues.findIndex((c) => t >= c.s && t < c.e) : -1;
  const subTab = html`<div class="stack">
    <${TaskState} task=${tr && (tr.status !== 'done' ? tr : null)} label="자막" />
    ${cues && cues.length
      ? html`<div class="row wrap" style="gap:8px"><${Btn} kind="primary" size="sm" icon="save" busy=${busy === 'sub'} disabled=${!cuesDirty} onClick=${saveCues}>자막 저장</${Btn}>
          <${Btn} size="sm" icon="refresh" onClick=${() => runTask('transcribe', true)}>다시 만들기</${Btn}>
          <span class="faint" style="font-size:12.5px">${cues.length}줄${cuesDirty ? ', 저장 안 함' : ''}</span></div>
        <div class="cue-list" ref=${cueBox}>${cues.map((c, k) => html`<div class=${`cue ${k === curCue ? 'on' : ''}`} data-k=${k}>
          <button class="tm num" onClick=${() => seek(c.s + 0.01)}>${fmtT(c.s)}</button>
          <input class="input sm" value=${c.text} onInput=${(e) => { setCues(cues.map((x, j) => (j === k ? { ...x, text: e.target.value } : x))); setCuesDirty(true); }} />
          <button class="btn ghost icon sm" title="이 줄 빼기" onClick=${() => { setCues(cues.filter((_, j) => j !== k)); setCuesDirty(true); }}><${Icon} name="x" size="sm" /></button></div>`)}</div>`
      : html`<p class="muted ed-p">학원 PC가 영상의 말을 받아 적어 자막을 만들어요. 돈이 들지 않고, 15분 강의는 보통 5~10분 걸려요.</p>
        <div class="row wrap" style="gap:8px"><${Btn} kind="primary" icon="captions" disabled=${tr && ['queued', 'running'].includes(tr.status)} onClick=${() => runTask('transcribe')}>자동 자막 만들기</${Btn}>
          <label class="btn secondary" style="cursor:pointer"><${Icon} name="upload" />자막 파일 올리기<input type="file" accept=".vtt,.srt,text/vtt" class="sr" onChange=${(e) => loadSubFile(e.target.files[0])} /></label></div>`}
  </div>`;

  // ---------------------------------------------------------------- AI 요약
  const su = last('summarize');
  const saveSm = async () => {
    setBusy('sm');
    try {
      const r = await api(`/api/admin/lectures/${id}/summary`, { method: 'PUT', body: { summary: sm } });
      setSm(r.summary);
      setSmDirty(false);
      toast('요약을 저장했어요');
    } catch (e) {
      toastErr(e);
    }
    setBusy('');
  };
  const setSmF = (patch) => {
    setSm({ ...sm, ...patch });
    setSmDirty(true);
  };
  const canSum = lec.has_transcript || lec.has_script || !!lec.passage;
  const smTab = html`<div class="stack">
    <${TaskState} task=${su && (su.status !== 'done' ? su : null)} label="AI 요약" />
    ${sm
      ? html`<${Field} label="한 줄 요약"><input value=${sm.one_line || ''} onInput=${(e) => setSmF({ one_line: e.target.value })} /></${Field}>
        <${Field} label="핵심 정리" hint="한 줄에 하나씩"><textarea rows="5" value=${(sm.points || []).join('\n')} onInput=${(e) => setSmF({ points: e.target.value.split('\n') })}></textarea></${Field}>
        <${Field} label="단어" hint="한 줄에 하나씩: 단어 = 뜻"><textarea rows="4" value=${(sm.vocab || []).map((v) => `${v.en} = ${v.ko}`).join('\n')}
          onInput=${(e) => setSmF({ vocab: e.target.value.split('\n').map((l) => { const [en, ...ko] = l.split('='); return { en: (en || '').trim(), ko: ko.join('=').trim() }; }) })}></textarea></${Field}>
        ${(sm.quiz || []).length > 0 && html`<div class="label">스스로 풀어 보기 ${sm.quiz.length}개</div><ul class="ed-list">${sm.quiz.map((q, i) => html`<li style="align-items:flex-start"><span class="num faint">${i + 1}</span><span style="flex:1">${q.q}<div class="faint" style="font-size:12.5px">정답: ${q.choices[q.answer] || ''}</div></span>
          <button class="btn ghost icon sm" title="빼기" onClick=${() => setSmF({ quiz: sm.quiz.filter((_, j) => j !== i) })}><${Icon} name="x" size="sm" /></button></li>`)}</ul>`}
        <div class="row wrap" style="gap:8px"><${Btn} kind="primary" size="sm" icon="save" busy=${busy === 'sm'} disabled=${!smDirty} onClick=${saveSm}>요약 저장</${Btn}>
          <${Btn} size="sm" icon="refresh" onClick=${() => runTask('summarize', true)}>다시 만들기</${Btn}></div>
        <div class="faint" style="font-size:12.5px">학생 앱 강의 아래에 요약과 스스로 풀어 보는 문제가 보여요. 복습 노트 PDF는 다시 만들기를 해야 새로 바뀌어요.</div>`
      : html`<p class="muted ed-p">Claude가 강의 내용을 읽고 한 줄 요약, 핵심 정리, 목차, 단어, 스스로 풀어 보는 문제를 만들어요. 올린 강의는 복습 노트 PDF도 함께 만들어요.</p>
        <${Btn} kind="primary" icon="sparkles" disabled=${!canSum || (su && ['queued', 'running'].includes(su.status))} onClick=${() => runTask('summarize')}>AI 요약 만들기</${Btn}>
        ${!canSum && html`<div class="faint" style="font-size:13px">자막을 먼저 만들어 주세요. 요약은 자막 내용으로 만들어요.</div>`}`}
  </div>`;

  const TABS = [['cut', 'scissors', '자르기'], ['chap', 'flag', '목차'], ['draw', 'penLine', '그리기'], ['sub', 'captions', '자막'], ['sum', 'sparkles', 'AI 요약']];
  return html`<div class="page wide">
    <button class="crumb" onClick=${() => go(`/lecture/${id}`)}><${Icon} name="chevronLeft" size="sm" />${lec.title}</button>
    <div class="ph"><div><h1>강의 편집</h1><div class="sub">자르기, 목차, 그림은 아래 저장을 눌러야 학생 앱에 반영돼요.</div></div></div>
    <div class="editor">
      <div class="ed-main">
        <${Player} src=${`/media/lecture/${id}/video`} poster=${lec.has_thumb ? `/media/lecture/${id}/thumb` : undefined}
          duration=${lec.duration} cuts=${edit.cuts} chapters=${edit.chapters} strokes=${edit.strokes} skipCuts=${skip} instant cueList=${cues || []}
          cls=${drawing ? 'drawing' : ''} onApi=${(a) => (pl.current = a)}
          overlay=${drawing && html`<${DrawLayer} getVideo=${() => pl.current && pl.current.video} pen=${pen} onStroke=${(s) => upd({ strokes: [...edit.strokes, s] })} />`} />
        <${EdLine} dur=${dur || lec.duration || 0} t=${t} edit=${edit} pending=${pending} onSeek=${seek} />
        ${drawing && html`<div class="ed-drawhint"><${Icon} name="penLine" size="sm" />${fmtT(t)} 장면에 그리고 있어요. 다 그렸으면 그리기를 끄세요.</div>`}
      </div>
      <div class="panel ed-side">
        <div class="ed-tabs" role="tablist">${TABS.map(([k, ic, label]) => html`<button role="tab" aria-selected=${tab === k} class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}><${Icon} name=${ic} size="sm" />${label}</button>`)}</div>
        <div class="ed-body">${tab === 'cut' ? cutTab : tab === 'chap' ? chapTab : tab === 'draw' ? drawTab : tab === 'sub' ? subTab : smTab}</div>
      </div>
    </div>
    <div class="bottom-bar">
      ${dirty && html`<span class="muted" style="align-self:center;font-size:13px;margin-right:auto">자르기, 목차, 그림에 저장하지 않은 변경이 있어요</span>`}
      <${Btn} onClick=${() => go(`/lecture/${id}`)}>닫기</${Btn}>
      <${Btn} kind="primary" icon="save" busy=${busy === 'save'} disabled=${!dirty} onClick=${saveEdit}>저장</${Btn}>
    </div>
  </div>`;
}
