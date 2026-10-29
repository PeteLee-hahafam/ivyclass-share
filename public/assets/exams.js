// 시험: 강의의 확인 문제와 문제 은행에서 골라 시험지를 만들고, 인쇄하거나 반에 내요.
// 학생 앱에서 풀면 바로 채점하고, 종이로 본 시험은 선생님이 학생 답을 넣으면 같은 방법으로 채점해요.
// 주소: #/exams 시험 목록, #/exams/new 시험 만들기(?l=강의 ?from=복사할 시험), #/exams/:id 시험 하나, #/exams/:id/edit 문제 고치기
// 반 화면의 '성적' 탭(ClassScores)도 여기 있어요.
import { html, useState, useEffect, useRef, api, Icon, Btn, Field, Switch, Modal, Empty, Skel, toast, toastErr, confirmBox, fmtDate, dueLabel, go, useAsync, matches } from './ui.js';
import { QuizItem, AREA, CIRC, MARKS } from './quizview.js';
import { AnswerModal } from './bankcards.js';
import { DuePicker, ymd, daysLater, endOfDay } from './due.js';

const LEVELS = [['mid1', '중1'], ['mid2', '중2'], ['mid3', '중3'], ['high1', '고1'], ['high2', '고2'], ['high3', '고3']];
const LEVEL_NAME = Object.fromEntries(LEVELS);
const levelOf = (l) => (l && l.options && LEVEL_NAME[l.options.level] ? l.options.level : '');
const KIND_NAME = { quiz: '확인 문제', hw: '숙제', exam: '시험' };
const USED = { hw: '숙제', print: '숙제지', exam: '시험', mock: '모의고사' };
const SA_KIND = { word: '단어 쓰기', fix: '어법 고치기', form: '형태 바꾸기', blank: '빈칸 채우기', refer: '가리키는 말' };
const BANK_PAGE = 40;

const pctOf = (s, t) => (t ? Math.round((s / t) * 100) : 0);
const toneOf = (p) => (p >= 80 ? 'good' : p < 60 ? 'low' : '');
const typeText = (c) => [c.mc ? `객관식 ${c.mc}` : '', c.sa ? `서술형 ${c.sa}` : ''].filter(Boolean).join(', ') || '문제 없음';
const areaText = (it) => (it.type === 'sa' ? `서술형, ${SA_KIND[it.kind] || '단답'}` : AREA[it.area] || '객관식');
const srcText = (src) => (!src ? '' : `${src.t || '지운 강의'}, ${src.k === 'quiz' ? `확인 문제 ${src.n}번` : '문제 은행'}`);
const printExam = (hash) => window.open(`/print.html#${hash}`, '_blank');

// 문제 한 줄 아래에 보일 짧은 설명 (같은 지문 문제는 물음이 같아서 보기로 구별해요)
function hintLine(it) {
  if (it.type === 'sa') return `정답: ${it.kind === 'fix' ? `${it.mark} ` : ''}${it.answer}`;
  return (it.choices || []).map((c, k) => (/^[①-⑤ⓐ-ⓔ]$/.test(String(c).trim()) ? c : `${CIRC[k]} ${c}`)).join('  ');
}

// ================================================================ 시험 목록
export function ExamsPage() {
  const { data, loading } = useAsync(() => api('/api/admin/exams'), []);
  const list = data ? data.exams : [];
  return html`<div class="page">
    <button class="crumb" onClick=${() => go('/lectures')}><${Icon} name="chevronLeft" size="sm" />강의</button>
    <div class="ph"><div><h1>시험</h1><div class="sub">확인 문제와 문제 은행에서 골라 만든 시험이에요. 인쇄해서 종이로 보거나, 반에 내서 학생 앱에서 풀게 해요.</div></div>
      <div class="actions"><a class="btn primary" href="#/exams/new"><${Icon} name="plus" />시험 만들기</a></div></div>
    ${loading && !data ? html`<${Skel} h=${84} /><${Skel} h=${84} />`
      : list.length ? html`<section class="panel"><ul class="rows">${list.map((e) => html`<li class="click ex-row" onClick=${() => go(`/exams/${e.id}`)}>
          <div class="ex-main">
            <b class="ex-t">${e.title}</b>
            <div class="faint ex-sub">${typeText(e)}, ${fmtDate(e.created_at)} 만듦${e.lectures.length ? `, ${e.lectures.map((l) => l.title).filter(Boolean).slice(0, 2).join(', ')}${e.lectures.length > 2 ? ` 외 ${e.lectures.length - 2}개` : ''}` : ''}</div>
            <div class="ex-cls">${e.classes.length ? e.classes.map((c) => html`<span class="cls-tag" style=${c.color ? `--c:${c.color}` : ''}>${c.name}${c.closed_at ? ' (풀기 마감)' : ''}</span>`) : html`<span class="chip">반에 내기 전</span>`}</div>
          </div>
          <div class="ex-num">${e.attempts ? html`<b class="num">${Math.round((e.avg || 0) * 100)}%</b><span class="faint">${e.attempts}명 평균</span>` : html`<span class="faint">아직 푼 학생 없음</span>`}</div></li>`)}</ul></section>`
      : html`<div class="panel"><${Empty} icon="clipboardCheck" title="아직 만든 시험이 없어요" action=${html`<a class="btn soft" href="#/exams/new"><${Icon} name="plus" />시험 만들기</a>`}>강의의 확인 문제와 문제 은행에서 문제를 골라 시험지를 만들어요.</${Empty}></div>`}
  </div>`;
}

// ================================================================ 시험 만들기, 문제 고치기
// 고른 문제 하나: key 는 같은 문제를 두 번 고르지 않게, pick 은 서버에 보낼 것, ord 는 강의 안에서의 차례
const quizEntry = (p, it) => ({ key: `q:${p.lecture.id}:${p.quiz.ver}:${it.no}`, pick: { k: 'quiz', l: p.lecture.id, n: it.no, v: p.quiz.ver }, item: it, l: p.lecture.id, t: p.lecture.title, src: 'quiz', ord: it.no });
const bankEntry = (p, it) => ({ key: `b:${it.bank_id}`, pick: { k: 'bank', l: p.lecture.id, id: it.bank_id }, item: it, l: p.lecture.id, t: p.lecture.title, src: 'bank', ord: it.bank_id });
function snapEntry(examId, it) {
  const s = it.src || {};
  const key = s.k === 'bank' ? `b:${s.id}` : s.k === 'quiz' ? `q:${s.l}:${s.v}:${s.n}` : `x:${examId}:${it.no}`;
  return { key, pick: { k: 'exam', e: examId, n: it.no }, item: it, l: s.l || 0, t: s.t || '', src: s.k || 'exam', ord: s.k === 'quiz' ? s.n : s.k === 'bank' ? s.id : 1e9 + it.no };
}

// 유형(서술형은 종류)마다 줄을 세워 돌아가며 하나씩 (골고루 채우기)
function interleave(list) {
  const lanes = new Map();
  for (const e of list) {
    const k = e.item.type === 'sa' ? `sa:${e.item.kind}` : e.item.area;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(e);
  }
  const out = [];
  const ls = [...lanes.values()];
  while (ls.some((l) => l.length)) for (const l of ls) if (l.length) out.push(l.shift());
  return out;
}

export function ExamBuilder({ editId, fromId, lectureId }) {
  const baseId = editId || fromId;
  const [title, setTitle] = useState('');
  const [reveal, setReveal] = useState(true);
  const [lecs, setLecs] = useState(lectureId ? [Number(lectureId)] : []);
  const [pools, setPools] = useState({});
  const [sel, setSel] = useState([]);
  const [ready, setReady] = useState(!baseId);
  const [locked, setLocked] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [want, setWant] = useState({ mc: 20, sa: 5 });
  const asked = useRef(new Set());

  useEffect(() => {
    if (!baseId) return;
    api(`/api/admin/exams/${baseId}`)
      .then((d) => {
        const e = d.exam;
        setTitle(editId ? e.title : `${e.title} (복사)`);
        setReveal(e.reveal);
        setLecs(e.lecture_ids);
        setSel(e.items.map((it) => snapEntry(e.id, it)));
        if (editId && d.attempts.length) setLocked(true);
        setReady(true);
      })
      .catch((err) => {
        toastErr(err);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    for (const id of lecs) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api(`/api/admin/lectures/${id}/pool`)
        .then((p) => setPools((o) => ({ ...o, [id]: p })))
        .catch(() => setPools((o) => ({ ...o, [id]: { error: true } })));
    }
  }, [lecs.join(',')]);

  const keys = new Set(sel.map((x) => x.key));
  const toggle = (e) => setSel((s) => (s.some((x) => x.key === e.key) ? s.filter((x) => x.key !== e.key) : [...s, e]));
  const addMany = (list) => setSel((s) => {
    const have = new Set(s.map((x) => x.key));
    return [...s, ...list.filter((e) => !have.has(e.key))];
  });
  const removeKeys = (ks) => setSel((s) => s.filter((x) => !ks.has(x.key)));
  const li = (l) => {
    const i = lecs.indexOf(l);
    return i < 0 ? 999 : i;
  };
  const sk = (e) => (e.src === 'quiz' ? 0 : e.src === 'bank' ? 1 : 2);
  const ordered = sel.slice().sort((a, b) => (a.item.type === b.item.type ? 0 : a.item.type === 'mc' ? -1 : 1) || li(a.l) - li(b.l) || sk(a) - sk(b) || a.ord - b.ord);
  const mcN = sel.filter((x) => x.item.type === 'mc').length;
  const saN = sel.length - mcN;
  const firstPool = lecs.length ? pools[lecs[0]] : null;
  const now = new Date();
  const defTitle = lecs.length === 1 && firstPool && firstPool.lecture ? `${firstPool.lecture.title} 시험` : `${now.getMonth() + 1}월 ${now.getDate()}일 시험`;

  const addLectures = (ids) => {
    const fresh = ids.filter((x) => !lecs.includes(x));
    if (fresh.length) setLecs([...lecs, ...fresh]);
  };
  const dropLecture = (id) => {
    const mine = new Set(sel.filter((x) => x.l === id).map((x) => x.key));
    setLecs(lecs.filter((x) => x !== id));
    if (mine.size) {
      removeKeys(mine);
      toast(`그 강의에서 고른 문제 ${mine.size}개도 뺐어요`);
    }
  };
  // 골고루 채우기: 모자란 만큼 강의마다 돌아가며, 유형이 섞이게. 안 쓴 은행 문제, 확인 문제, 숙제나 모의고사에 쓴 은행 문제 차례예요
  const autoFill = () => {
    const pickType = (type, n) => {
      if (n <= 0) return [];
      const lanes = lecs.map((id) => {
        const p = pools[id];
        if (!p || p.error) return [];
        const bank = (p.bank || []).filter((it) => it.type === type);
        const fresh = bank.filter((it) => !(it.used || []).length).map((it) => bankEntry(p, it));
        const quiz = (p.quiz ? p.quiz.items : []).filter((it) => it.type === type).map((it) => quizEntry(p, it));
        const used = bank.filter((it) => (it.used || []).length && !it.used.some((u) => u === 'print' || u === 'exam')).map((it) => bankEntry(p, it));
        return [...interleave(fresh), ...interleave(quiz), ...interleave(used)].filter((e) => !keys.has(e.key));
      });
      const out = [];
      let i = 0;
      while (out.length < n && lanes.some((l) => l.length)) {
        const l = lanes[i % lanes.length];
        if (l.length) out.push(l.shift());
        i++;
      }
      return out;
    };
    const got = [...pickType('mc', want.mc - mcN), ...pickType('sa', want.sa - saN)];
    if (!got.length) return toast(mcN >= want.mc && saN >= want.sa ? '이미 그만큼 골랐어요' : '더 고를 문제가 없어요', mcN >= want.mc && saN >= want.sa ? 'ok' : 'err');
    addMany(got);
    toast(`문제 ${got.length}개를 더 골랐어요`);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: title.trim() || defTitle, reveal, picks: ordered.map((e) => e.pick) };
      if (editId) {
        const r = await api(`/api/admin/exams/${editId}`, { method: 'PUT', body });
        toast(r.dropped ? `저장했어요. 바뀐 문제 ${r.dropped}개는 빠졌어요` : '고친 문제를 저장했어요');
        go(`/exams/${editId}`);
      } else {
        const r = await api('/api/admin/exams', { method: 'POST', body });
        toast(r.dropped ? `시험을 만들었어요. 바뀐 문제 ${r.dropped}개는 빠졌어요` : `시험을 만들었어요 (${r.n}문항)`);
        go(`/exams/${r.id}`);
      }
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const submitText = editId ? '고친 문제 저장' : '시험 만들기';
  if (!ready) return html`<div class="page"><${Skel} h=${30} w="40%" mb=${20} /><div class="exb"><${Skel} h=${320} /><${Skel} h=${260} /></div></div>`;
  return html`<div class="page">
    <button class="crumb" onClick=${() => go(editId ? `/exams/${editId}` : '/exams')}><${Icon} name="chevronLeft" size="sm" />${editId ? '시험' : '시험 목록'}</button>
    <div class="ph"><div><h1>${editId ? '문제 고치기' : '시험 만들기'}</h1><div class="sub">강의를 고르고, 그 강의의 확인 문제와 문제 은행에서 시험에 낼 문제를 골라요.</div></div></div>
    ${locked && html`<div class="notice amber" style="margin-bottom:18px"><${Icon} name="alert" /><div>이미 푼 학생이 있어서 문제를 바꿀 수 없어요. 시험 화면에서 '복사해서 새 시험 만들기'로 고쳐 주세요.</div></div>`}
    <div class="exb">
      <div class="stack lg" style="min-width:0">
        <section class="panel"><div class="panel-h"><h2>강의</h2>${lecs.length > 0 && html`<span class="count num">${lecs.length}개</span>`}<span class="spacer"></span>
            <${Btn} size="sm" icon="plus" onClick=${() => setPicker(true)}>강의 더하기</${Btn}></div>
          <div class="panel-b">${lecs.length ? html`<div class="exb-lecs">${lecs.map((id) => {
            const p = pools[id];
            const n = sel.filter((x) => x.l === id).length;
            return html`<span class="exb-lec"><span class="ellipsis">${p && p.lecture ? p.lecture.title : p && p.error ? '찾을 수 없는 강의' : '불러오는 중…'}</span>${n > 0 && html`<b class="num">${n}</b>`}
              <button class="btn ghost icon sm" aria-label="강의 빼기" title="강의 빼기" onClick=${() => dropLecture(id)}><${Icon} name="x" size="sm" /></button></span>`;
          })}</div>`
            : html`<p class="muted" style="margin:0;font-size:14px">시험에 낼 강의를 골라 주세요. 여러 강의를 섞어 한 시험으로 만들 수 있어요.</p>`}</div></section>
        ${lecs.map((id) => html`<${PoolCard} key=${id} pool=${pools[id]} keys=${keys} onToggle=${toggle} onAdd=${addMany} onRemove=${removeKeys} />`)}
      </div>
      <aside class="exb-side">
        <section class="panel exb-sum">
          <div class="panel-h"><h2>고른 문제</h2><span class="count num">${sel.length}문항</span></div>
          <div class="panel-b stack">
            <${Field} label="시험 이름"><input value=${title} maxlength="80" onInput=${(e) => setTitle(e.target.value)} placeholder=${defTitle} /></${Field}>
            <div class="exb-counts"><span>객관식 <b class="num">${mcN}</b></span><span>서술형 <b class="num">${saN}</b></span></div>
            ${sel.length ? html`<ol class="exb-list">${ordered.map((e, i) => html`<li>
                <span class="num n">${i + 1}</span><span class="ellipsis"><i>${areaText(e.item)}</i> ${e.item.q}</span>
                <button class="btn ghost icon sm" aria-label=${`${i + 1}번 빼기`} title="빼기" onClick=${() => toggle(e)}><${Icon} name="x" size="sm" /></button></li>`)}</ol>`
              : html`<p class="muted" style="margin:0;font-size:13.5px">왼쪽에서 문제를 고르면 여기에 모여요. 시험지에는 객관식이 앞에, 서술형이 뒤에 나와요.</p>`}
            ${lecs.length > 0 && html`<div class="exb-auto"><div class="label">골고루 채우기</div>
              <div class="row" style="gap:8px">
                <label class="exb-n">객관식<input class="input sm num" type="number" min="0" max="60" value=${want.mc} onInput=${(e) => setWant({ ...want, mc: Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0)) })} /></label>
                <label class="exb-n">서술형<input class="input sm num" type="number" min="0" max="20" value=${want.sa} onInput=${(e) => setWant({ ...want, sa: Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)) })} /></label>
                <${Btn} size="sm" icon="sparkles" onClick=${autoFill}>채우기</${Btn}></div>
              <div class="faint" style="font-size:12.5px">고른 강의에서 모자란 만큼 유형을 섞어 골라요. 숙제나 모의고사에 안 나온 문제부터예요.</div></div>`}
            <${Switch} checked=${reveal} onChange=${setReveal} title="학생이 낸 뒤 정답과 해설 보여 주기" desc="끄면 학생은 점수만 봐요. 시험 화면에서 언제든 바꿀 수 있어요." />
            <div class="hide-m"><${Btn} kind="primary" block icon="check" busy=${busy} disabled=${!sel.length || locked} onClick=${save}>${submitText}</${Btn}></div>
          </div>
        </section>
      </aside>
    </div>
    <div class="bottom-bar hide-d"><span class="muted num" style="align-self:center;margin-right:auto;font-size:13.5px">${sel.length}문항 고름</span>
      <${Btn} kind="primary" icon="check" busy=${busy} disabled=${!sel.length || locked} onClick=${save}>${submitText}</${Btn}></div>
    ${picker && html`<${LecturePicker} chosen=${lecs} onClose=${() => setPicker(false)} onDone=${(ids) => { addLectures(ids); setPicker(false); }} />`}
  </div>`;
}

// 강의 하나의 문제 (확인 문제, 문제 은행)
function PoolCard({ pool, keys, onToggle, onAdd, onRemove }) {
  const [tab, setTab] = useState(null);
  const [type, setType] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const [shown, setShown] = useState(BANK_PAGE);
  if (!pool) return html`<section class="panel"><div class="panel-b"><${Skel} h=${24} w="50%" /><${Skel} h=${120} /></div></section>`;
  if (pool.error) return html`<section class="panel"><div class="panel-b"><div class="notice rose"><${Icon} name="alert" /><div>강의를 찾을 수 없어요. 지워진 강의일 수 있어요.</div></div></div></section>`;
  const p = pool;
  const quiz = p.quiz ? p.quiz.items.map((it) => quizEntry(p, it)) : [];
  const bank = (p.bank || []).map((it) => bankEntry(p, it));
  const t = tab || (quiz.length ? 'quiz' : 'bank');
  const all = (t === 'quiz' ? quiz : bank).filter((e) => type === 'all' || e.item.type === type);
  const list = t === 'bank' ? all.slice(0, shown) : all;
  const allOn = all.length > 0 && all.every((e) => keys.has(e.key));
  const flip = (k) => {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOpen(n);
  };
  const lv = LEVEL_NAME[p.lecture.level];
  return html`<section class="panel pool">
    <div class="panel-h"><h2 class="ellipsis" style="min-width:0">${p.lecture.title}</h2>${lv && html`<span class="chip">${lv}</span>`}<span class="spacer"></span>
      <a class="btn ghost sm hide-m" href=${`#/lecture/${p.lecture.id}`}>강의 화면</a></div>
    <div class="panel-b stack sm">
      ${!quiz.length && !bank.length ? html`<p class="muted" style="margin:0;font-size:14px">이 강의에는 아직 확인 문제도 문제 은행도 없어요. 강의 목록 위 '한 번에 만들기'나 강의 화면에서 문제를 먼저 만들어 주세요.</p>` : html`
      <div class="pool-tools">
        <div class="seg" role="tablist" aria-label="문제 고르는 곳">${[['quiz', '확인 문제', quiz.length], ['bank', '문제 은행', bank.length]].map(([k, label, n]) => html`<button type="button" class=${t === k ? 'on' : ''} aria-pressed=${t === k} disabled=${!n} onClick=${() => { setTab(k); setShown(BANK_PAGE); }}>${label} <span class="num">${n}</span></button>`)}</div>
        <div class="seg" role="group" aria-label="문제 종류">${[['all', '모두'], ['mc', '객관식'], ['sa', '서술형']].map(([k, label]) => html`<button type="button" class=${type === k ? 'on' : ''} aria-pressed=${type === k} onClick=${() => setType(k)}>${label}</button>`)}</div>
        <span class="spacer"></span>
        ${all.length > 0 && html`<button class="btn ghost sm" onClick=${() => (allOn ? onRemove(new Set(all.map((e) => e.key))) : onAdd(all))}>${allOn ? `${all.length}개 모두 빼기` : `${all.length}개 모두 고르기`}</button>`}
      </div>
      ${t === 'bank' && html`<p class="faint" style="margin:0;font-size:12.5px">내신 변형 문제예요. 숙제, 숙제지, 시험, 모의고사에 쓴 문제는 표시가 붙어요. 시험에 쓴 문제는 숙제와 모의고사에 나오지 않아요.</p>`}
      ${list.length ? html`<ul class="pool-list">${list.map((e, i) => {
        const it = e.item;
        const on = keys.has(e.key);
        return html`<li class=${`pq ${on ? 'on' : ''}`}>
          <div class="pq-row">
            <label class="pq-h"><input type="checkbox" checked=${on} onChange=${() => onToggle(e)} />
              <span class="pq-n num">${t === 'quiz' ? it.no : i + 1}</span>
              <span class="pq-b"><span class="pq-q"><span class="chip">${areaText(it)}</span>${(it.used || []).map((u) => html`<span class="chip amber">${USED[u]}</span>`)}<span class="pq-s">${it.q}</span></span>
                <span class="pq-c ellipsis">${hintLine(it)}</span></span></label>
            <button class="btn ghost icon sm" aria-label="문제 자세히 보기" title="문제 자세히 보기" aria-expanded=${open.has(e.key)} onClick=${() => flip(e.key)}><${Icon} name=${open.has(e.key) ? 'chevronUp' : 'chevronDown'} size="sm" /></button>
          </div>
          ${open.has(e.key) && html`<div class="pq-full"><${QuizItem} it=${it} i=${t === 'quiz' ? it.no - 1 : i} mode="key" /></div>`}</li>`;
      })}</ul>${t === 'bank' && all.length > list.length && html`<button class="sec-link" onClick=${() => setShown(shown + BANK_PAGE)}>${all.length - list.length}개 더 보기<${Icon} name="chevronDown" size="sm" /></button>`}`
        : html`<p class="muted" style="margin:0;font-size:14px">${t === 'quiz' ? '확인 문제가 없어요.' : '이 종류의 문제가 없어요.'}</p>`}`}
    </div>
  </section>`;
}

function LecturePicker({ chosen, onClose, onDone }) {
  const { data } = useAsync(() => api('/api/admin/lectures?status=done'), []);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState([]);
  const all = data ? data.lectures.filter((l) => l.status === 'done') : [];
  const list = all.filter((l) => matches(l.title, q) || matches(l.source, q));
  const groups = [...LEVELS.map(([k, t]) => [t, list.filter((l) => levelOf(l) === k)]), ['학년 없음', list.filter((l) => !levelOf(l))]].filter(([, g]) => g.length);
  const toggle = (id) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id]);
  return html`<${Modal} title="강의 고르기" onClose=${onClose} wide
    footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><span class="spacer"></span><${Btn} kind="primary" icon="plus" disabled=${!pick.length} onClick=${() => onDone(pick)}>${pick.length > 1 ? `강의 ${pick.length}개 더하기` : '강의 더하기'}</${Btn}>`}>
    <div class="stack">
      <div class="search-in"><${Icon} name="search" size="sm" /><input class="input" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="제목, 출처로 찾기" aria-label="강의 찾기" /></div>
      ${!data ? html`<${Skel} h=${160} />` : !list.length ? html`<p class="muted">${all.length ? '찾는 강의가 없어요.' : '완성된 강의가 없어요.'}</p>`
        : groups.map(([g, ls]) => html`<div><div class="label" style="margin:2px 0 6px">${g}</div><ul class="lp-list">${ls.map((l) => {
          const has = chosen.includes(l.id);
          return html`<li><label class=${`lp ${pick.includes(l.id) ? 'on' : ''} ${has ? 'has' : ''}`}><input type="checkbox" checked=${has || pick.includes(l.id)} disabled=${has} onChange=${() => toggle(l.id)} />
            <span style="flex:1;min-width:0"><b class="ellipsis" style="display:block">${l.title}</b><span class="faint" style="font-size:12.5px">${[l.source, has ? '이미 골랐어요' : '', l.has_quiz ? '확인 문제 있음' : '확인 문제 없음', l.has_homework ? '숙제 있음' : ''].filter(Boolean).join(', ')}</span></span></label></li>`;
        })}</ul></div>`)}
    </div>
  </${Modal}>`;
}

// ================================================================ 시험 하나: 결과, 낸 반, 종이 답안, 설정
export function ExamDetail({ id }) {
  const { data, loading, reload } = useAsync(() => api(`/api/admin/exams/${id}`), [id]);
  const [give, setGive] = useState(false);
  const [paper, setPaper] = useState(null);
  const [stu, setStu] = useState(null);
  const [key, setKey] = useState(null);
  const [rename, setRename] = useState(false);
  const [dueC, setDueC] = useState(null);
  const [busy, setBusy] = useState('');
  if (loading && !data) return html`<div class="page"><${Skel} h=${30} w="50%" mb=${20} /><div class="detail"><${Skel} h=${300} /><${Skel} h=${220} /></div></div>`;
  if (!data) return html`<div class="page"><${Empty} title="시험을 찾을 수 없어요" action=${html`<${Btn} onClick=${() => go('/exams')}>시험 목록으로</${Btn}>`} /></div>`;
  const e = data.exam;
  const atts = data.attempts;
  const pend = data.pending;
  const n = e.items.length;
  const avg = atts.length ? atts.reduce((t, a) => t + a.score, 0) / atts.length : 0;
  const rates = e.items.map((_, i) => (atts.length ? data.right[i] / atts.length : null));
  const hard = atts.length >= 3 ? e.items.map((it, i) => ({ it, i, rate: rates[i] })).filter((x) => x.rate < 0.6).sort((a, b) => a.rate - b.rate).slice(0, 3) : [];
  const run = async (what, fn, okMsg) => {
    setBusy(what);
    try {
      await fn();
      if (okMsg) toast(okMsg);
      reload(true);
    } catch (err) {
      toastErr(err);
    }
    setBusy('');
  };
  const setClass = (c, body, msg) => run(`c${c.class_id}`, () => api(`/api/admin/exams/${e.id}/classes/${c.class_id}`, { method: 'PUT', body }), msg);
  const dropClass = async (c) => {
    if (!(await confirmBox({ title: `${c.name} 학생 앱에서 뺄까요?`, body: '학생 앱에서 이 시험이 사라져요. 이미 낸 답안과 점수는 남아요.', ok: '빼기', danger: true }))) return;
    run(`c${c.class_id}`, () => api(`/api/admin/exams/${e.id}/classes/${c.class_id}`, { method: 'DELETE' }), '학생 앱에서 뺐어요');
  };
  const del = async () => {
    if (!(await confirmBox({ title: '시험을 지울까요?', body: atts.length ? `푼 학생 ${atts.length}명의 답안과 점수까지 모두 지워지고 되돌릴 수 없어요.` : '시험지와 반에 낸 기록이 지워져요.', ok: '시험 지우기', danger: true }))) return;
    try {
      await api(`/api/admin/exams/${e.id}`, { method: 'DELETE' });
      toast('시험을 지웠어요');
      go('/exams');
    } catch (err) {
      toastErr(err);
    }
  };
  const lecTitles = [...new Set(e.items.map((it) => it.src && it.src.t).filter(Boolean))];
  return html`<div class="page">
    <button class="crumb" onClick=${() => go('/exams')}><${Icon} name="chevronLeft" size="sm" />시험 목록</button>
    <div class="lec-head">
      <div style="min-width:0;flex:1"><h1>${e.title}</h1>
        <div class="sub">${typeText(e)}, ${fmtDate(e.created_at)} 만듦${lecTitles.length ? `, ${lecTitles.slice(0, 3).join(', ')}${lecTitles.length > 3 ? ` 외 ${lecTitles.length - 3}개` : ''}` : ''}</div></div>
      <div class="actions">
        <${Btn} size="sm" icon="eye" onClick=${() => setKey({})}>문제와 정답</${Btn}>
        <${Btn} size="sm" icon="printer" onClick=${() => printExam(`e${e.id}`)}>인쇄</${Btn}>
        <${Btn} kind="primary" size="sm" icon="send" onClick=${() => setGive(true)}>반에 내기</${Btn}>
      </div>
    </div>
    <div class="detail">
      <div class="stack lg">
        <section class="panel"><div class="panel-h"><h2>결과</h2>${atts.length > 0 && html`<span class="count num">${atts.length}명</span>`}<span class="spacer"></span>
            <${Btn} kind="soft" size="sm" icon="pencil" onClick=${() => setPaper({})}>종이 답안 넣기</${Btn}></div>
          <div class="panel-b stack">
            <div class="qk-stats">
              <div><span>푼 학생</span><b class="num">${atts.length}명</b></div>
              <div><span>평균</span><b class="num">${atts.length ? `${avg.toFixed(1)}/${n}` : '-'}</b></div>
              <div><span>아직 안 푼 학생</span><b class="num">${pend.length}명</b></div></div>
            ${hard.length > 0 && html`<div class="qk-hard"><div class="label">많이 틀린 문제</div>${hard.map(({ it, i, rate }) => html`<button class="qk-h" onClick=${() => setKey({ focus: i })}>
              <b class="num">${i + 1}번</b><span class="ellipsis">${areaText(it)}, ${it.q}</span><span class="num rate">${Math.round(rate * 100)}%</span></button>`)}</div>`}
            ${atts.length ? html`<ul class="rows qk-rows">${atts.map((a) => html`<li class="row" style="cursor:pointer" onClick=${() => setStu(a)}>
                <div style="flex:1;min-width:0"><b>${a.name}</b> <span class="faint" style="font-size:12.5px">${a.class_name || '반 없음'}</span>${a.paper && html` <span class="chip">종이</span>`}</div>
                <span class="faint num hide-m" style="font-size:12.5px">${fmtDate(a.created_at)}</span><b class=${`num qk-sc sc-t ${toneOf(pctOf(a.score, a.total))}`}>${a.score}/${a.total}</b></li>`)}</ul>`
              : html`<p class="muted" style="margin:0;font-size:14px">아직 푼 학생이 없어요. 반에 내면 학생 앱에서 풀 수 있고, 종이로 본 시험은 '종이 답안 넣기'로 학생 답을 넣으면 채점돼요.</p>`}
            ${pend.length > 0 && html`<p class="faint" style="margin:0;font-size:13px">안 푼 학생: ${pend.slice(0, 30).map((x) => x.name).join(', ')}${pend.length > 30 ? ` 외 ${pend.length - 30}명` : ''}</p>`}
          </div></section>
        ${atts.length > 0 && html`<section class="panel"><div class="panel-h"><h2>문항별 정답률</h2><span class="spacer"></span><span class="faint" style="font-size:12.5px">누르면 문제를 봐요</span></div>
          <div class="panel-b"><div class="rate-grid">${e.items.map((it, i) => {
            const r = Math.round((rates[i] || 0) * 100);
            return html`<button class=${`rg ${toneOf(r)}`} title=${`${i + 1}번, ${areaText(it)}, 정답률 ${r}%`} onClick=${() => setKey({ focus: i })}><span class="num">${i + 1}</span><b class="num">${r}%</b></button>`;
          })}</div></div></section>`}
      </div>
      <div class="stack lg">
        <section class="panel"><div class="panel-h"><h2>낸 반</h2>${data.classes.length > 0 && html`<span class="count num">${data.classes.length}개</span>`}<span class="spacer"></span>
            ${data.classes.length > 0 && html`<${Btn} kind="ghost" size="sm" icon="plus" onClick=${() => setGive(true)}>반 더하기</${Btn}>`}</div>
          ${data.classes.length ? html`<ul class="rows">${data.classes.map((c) => {
            const d = dueLabel(c.due_at);
            const b = busy === `c${c.class_id}`;
            return html`<li class="ex-cl">
              <div class="row" style="gap:8px"><span class="cls-tag" style=${c.color ? `--c:${c.color}` : ''}>${c.name}</span><span class="spacer"></span>
                ${c.closed_at ? html`<span class="chip">풀기 마감</span>` : d ? html`<span class=${`chip ${d.tone}`}>${d.text}</span>` : html`<span class="chip">마감 없음</span>`}</div>
              <div class="muted num" style="font-size:13.5px">${c.done}/${c.students}명 풀었어요${c.avg != null ? `, 평균 ${Math.round(c.avg * 100)}%` : ''}</div>
              <div class="row ex-cl-acts">
                <button class="btn ghost sm" disabled=${b} onClick=${() => setDueC(c)}><${Icon} name="calendar" size="sm" />마감</button>
                <button class="btn ghost sm" disabled=${b} onClick=${() => setClass(c, { closed: !c.closed_at }, c.closed_at ? '다시 풀 수 있게 열었어요' : '풀기를 마감했어요. 점수는 그대로예요')}><${Icon} name=${c.closed_at ? 'undo' : 'lock'} size="sm" />${c.closed_at ? '다시 열기' : '풀기 마감'}</button>
                <button class="btn ghost sm" disabled=${b} onClick=${() => dropClass(c)}><${Icon} name="x" size="sm" />학생 앱에서 빼기</button></div></li>`;
          })}</ul>`
            : html`<${Empty} icon="send" title="아직 반에 내지 않았어요" action=${html`<${Btn} kind="soft" icon="send" onClick=${() => setGive(true)}>반에 내기</${Btn}>`}>반에 내면 학생 앱에 바로 나타나고, 풀면 바로 채점돼요.</${Empty}>`}</section>
        <section class="panel"><div class="panel-h"><h2>설정</h2></div><div class="panel-b" style="padding-top:0">
          <${Switch} checked=${e.reveal} onChange=${(v) => run('reveal', () => api(`/api/admin/exams/${e.id}`, { method: 'PUT', body: { reveal: v } }), v ? '학생이 정답과 해설을 볼 수 있어요' : '학생은 이제 점수만 봐요')}
            title="학생이 낸 뒤 정답과 해설 보여 주기" desc="끄면 학생은 점수만 봐요. 시험이 다 끝난 뒤에 켜도 돼요." /></div></section>
        <section class="panel"><div class="panel-h"><h2>관리</h2></div><div class="panel-b" style="padding-top:2px"><div class="mng">
          <button onClick=${() => setRename(true)}><${Icon} name="pencil" />이름 바꾸기</button>
          ${atts.length ? html`<button onClick=${() => go(`/exams/new?from=${e.id}`)}><${Icon} name="copy" />복사해서 새 시험 만들기</button>`
            : html`<button onClick=${() => go(`/exams/${e.id}/edit`)}><${Icon} name="listOrdered" />문제 고치기</button><button onClick=${() => go(`/exams/new?from=${e.id}`)}><${Icon} name="copy" />복사해서 새 시험 만들기</button>`}
          <button class="danger" onClick=${del}><${Icon} name="trash" />시험 지우기</button>
        </div></div></section>
      </div>
    </div>
    ${give && html`<${GiveModal} exam=${e} given=${data.classes} onClose=${() => setGive(false)} onDone=${() => reload(true)} />`}
    ${dueC && html`<${ExamDueModal} exam=${e} c=${dueC} onClose=${() => setDueC(null)} onDone=${() => reload(true)} />`}
    ${paper && html`<${PaperModal} exam=${e} data=${data} onClose=${() => setPaper(null)} onSaved=${() => reload(true)} />`}
    ${stu && html`<${AnswerModal} quiz=${e} a=${stu} base="/api/admin/exam-attempts" onClose=${() => setStu(null)} onChanged=${() => reload(true)} />`}
    ${key && html`<${ExamKeyModal} exam=${e} rates=${atts.length ? rates : null} focus=${key.focus} onClose=${() => setKey(null)} />`}
    ${rename && html`<${RenameModal} exam=${e} onClose=${() => setRename(false)} onDone=${() => reload(true)} />`}
  </div>`;
}

function ExamKeyModal({ exam, rates, focus, onClose }) {
  useEffect(() => {
    if (focus == null) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`q-${focus + 1}`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, []);
  return html`<${Modal} title=${`${exam.title}, ${exam.items.length}문항`} onClose=${onClose} wide
    footer=${html`<${Btn} icon="printer" onClick=${() => printExam(`e${exam.id}`)}>인쇄</${Btn}><span class="spacer"></span><button class="btn primary" onClick=${onClose}>닫기</button>`}>
    <div class="qk-list">${exam.items.map((it, i) => html`<div class="ek-it"><div class="faint ek-src">${srcText(it.src)}</div>
      <${QuizItem} it=${it} i=${i} mode="key" stat=${rates ? { rate: rates[i] } : null} /></div>`)}</div>
  </${Modal}>`;
}

function RenameModal({ exam, onClose, onDone }) {
  const [t, setT] = useState(exam.title);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/exams/${exam.id}`, { method: 'PUT', body: { title: t } });
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="시험 이름 바꾸기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} disabled=${!t.trim()} onClick=${save}>저장</${Btn}>`}>
    <${Field} label="시험 이름"><input value=${t} maxlength="80" onInput=${(e) => setT(e.target.value)} /></${Field}>
  </${Modal}>`;
}

// 반에 내기 (여러 반, 마감)
function GiveModal({ exam, given = [], presetClass, onClose, onDone }) {
  const [classes, setClasses] = useState(null);
  const [pick, setPick] = useState(presetClass ? [presetClass] : []);
  const [due, setDue] = useState(daysLater(3));
  const [noDue, setNoDue] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/admin/classes').then((r) => setClasses(r.classes)).catch(toastErr);
  }, []);
  const had = new Set(given.map((c) => c.class_id));
  const toggle = (cid) => setPick(pick.includes(cid) ? pick.filter((x) => x !== cid) : [...pick, cid]);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/exams/${exam.id}/classes`, { method: 'POST', body: { class_ids: pick, due_at: noDue || !due ? null : endOfDay(due) } });
      toast('시험을 냈어요. 학생 앱에 바로 나타나요');
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="반에 내기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" icon="send" busy=${busy} disabled=${!pick.length} onClick=${save}>${pick.length > 1 ? `${pick.length}개 반에 내기` : '반에 내기'}</${Btn}>`}>
    <div class="stack">
      <div class="muted">「${exam.title}」, ${typeText(exam)}</div>
      <div class="field"><label>반 (여러 개 고를 수 있어요)</label>
        ${classes === null ? html`<${Skel} h=${38} />` : classes.length ? html`<div class="pick-row">${classes.map((c) => html`<button type="button" class=${`pick ${pick.includes(c.id) ? 'on' : ''}`} aria-pressed=${pick.includes(c.id)} onClick=${() => toggle(c.id)}>
            <span class="cls-dot" style=${c.color ? `background:${c.color}` : ''}></span>${c.name}<small>${had.has(c.id) ? '이미 냄' : `${c.students}명`}</small></button>`)}</div>`
          : html`<div class="notice"><${Icon} name="info" /><div>반이 없어요. 반 화면에서 반을 먼저 만들어 주세요.</div></div>`}</div>
      <${DuePicker} due=${due} setDue=${setDue} noDue=${noDue} setNoDue=${setNoDue} quick=${[[0, '오늘'], [1, '내일'], [3, '3일 뒤'], [7, '1주 뒤']]} />
      <p class="faint" style="margin:0;font-size:13px">학생 앱 홈에 시험이 나타나요. 학생은 한 번만 낼 수 있고, 내면 바로 채점돼요. 이미 낸 반을 다시 고르면 마감만 바뀌어요.</p>
    </div>
  </${Modal}>`;
}

function ExamDueModal({ exam, c, onClose, onDone }) {
  const [due, setDue] = useState(c.due_at ? ymd(new Date(c.due_at * 1000)) : daysLater(3));
  const [noDue, setNoDue] = useState(!c.due_at);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/exams/${exam.id}/classes/${c.class_id}`, { method: 'PUT', body: { due_at: noDue || !due ? null : endOfDay(due) } });
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="마감 고치기" onClose=${onClose} footer=${html`<${Btn} onClick=${onClose}>취소</${Btn}><${Btn} kind="primary" busy=${busy} onClick=${save}>저장</${Btn}>`}>
    <div class="stack"><div class="muted">「${exam.title}」, ${c.name}</div>
      <${DuePicker} due=${due} setDue=${setDue} noDue=${noDue} setNoDue=${setNoDue} quick=${[[0, '오늘'], [1, '내일'], [3, '3일 뒤'], [7, '1주 뒤']]} />
      <p class="faint" style="margin:0;font-size:13px">마감이 지나도 학생은 늦게 낼 수 있어요. 더 못 내게 하려면 '풀기 마감'을 눌러 주세요.</p></div>
  </${Modal}>`;
}

// ---------------------------------------------------------------- 종이 답안 넣기
const CIRC_IN = { '①': 0, '②': 1, '③': 2, '④': 3, '⑤': 4 };
// "31524 15234" 처럼 이어서 쳐요. 0, -, . 은 안 쓴 답이에요
function parseMc(text, n) {
  const out = [];
  for (const ch of String(text || '')) {
    if (out.length >= n) break;
    if (/[1-5]/.test(ch)) out.push(Number(ch) - 1);
    else if (CIRC_IN[ch] !== undefined) out.push(CIRC_IN[ch]);
    else if (/[0\-.xX?_]/.test(ch)) out.push(null);
  }
  return out;
}
const mcText = (answers, n) => (answers || []).slice(0, n).map((a) => (Number.isInteger(a) ? String(a + 1) : '0')).join('');

function PaperModal({ exam, data, onClose, onSaved }) {
  const items = exam.items;
  const mcIdx = items.map((it, i) => (it.type === 'mc' ? i : -1)).filter((i) => i >= 0);
  const saIdx = items.map((it, i) => (it.type === 'sa' ? i : -1)).filter((i) => i >= 0);
  const { data: sd } = useAsync(() => api('/api/admin/students'), []);
  const [uid, setUid] = useState('');
  const [mc, setMc] = useState('');
  const [sa, setSa] = useState({});
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const mcRef = useRef(null);
  const byUser = new Map(data.attempts.map((a) => [a.user_id, a]));
  const givenIds = data.classes.map((c) => c.class_id);
  const students = sd ? sd.students : [];
  // 시험을 낸 반 학생 먼저, 반마다 이름 차례
  const groups = [];
  for (const cid of [...givenIds, ...new Set(students.map((s) => s.class_id || null).filter((x) => !givenIds.includes(x)))]) {
    const g = students.filter((s) => (s.class_id || null) === cid);
    if (g.length) groups.push([g[0].class_name || '반 없음', g]);
  }
  const flat = groups.flatMap(([, g]) => g);
  const cur = uid ? byUser.get(Number(uid)) : null;
  const choose = (v) => {
    setUid(v);
    const a = v ? byUser.get(Number(v)) : null;
    setMc(a ? mcText(mcIdx.map((i) => a.answers[i]), mcIdx.length) : '');
    const s = {};
    if (a) for (const i of saIdx) s[i] = a.answers[i] ?? null;
    setSa(s);
    setTimeout(() => mcRef.current && mcRef.current.focus(), 30);
  };
  useEffect(() => {
    if (!uid && sd && flat.length) {
      const first = flat.find((s) => givenIds.includes(s.class_id) && !byUser.has(s.id)) || flat.find((s) => !byUser.has(s.id));
      if (first) choose(String(first.id));
    }
  }, [sd]);
  const parsed = parseMc(mc, mcIdx.length);
  const okMc = parsed.filter((a, k) => a !== null && a === items[mcIdx[k]].answer).length;
  const save = async (next) => {
    if (!uid) return;
    setBusy(true);
    try {
      const answers = items.map((it, i) => {
        if (it.type === 'mc') {
          const k = mcIdx.indexOf(i);
          const v = parsed[k];
          return Number.isInteger(v) && v < it.choices.length ? v : null;
        }
        return sa[i] ?? null;
      });
      const r = await api(`/api/admin/exams/${exam.id}/attempts`, { method: 'POST', body: { user_id: Number(uid), answers } });
      const who = flat.find((s) => String(s.id) === String(uid));
      setLast({ name: who ? who.name : '', score: r.attempt.score, total: r.attempt.total });
      byUser.set(Number(uid), { ...r.attempt, user_id: Number(uid) });
      onSaved();
      if (next) {
        const pos = flat.findIndex((s) => String(s.id) === String(uid));
        const after = [...flat.slice(pos + 1), ...flat.slice(0, pos)].find((s) => !byUser.has(s.id) && (givenIds.includes(s.class_id) || s.class_id === (who && who.class_id)));
        if (after) choose(String(after.id));
        else {
          toast('넣을 학생을 다 넣었어요');
          setUid('');
        }
      }
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const setSaAns = (i, v) => setSa({ ...sa, [i]: v });
  return html`<${Modal} title="종이 답안 넣기" onClose=${onClose} wide
    footer=${html`<${Btn} onClick=${onClose}>닫기</${Btn}><span class="spacer"></span><${Btn} busy=${busy} disabled=${!uid} onClick=${() => save(false)}>저장</${Btn}><${Btn} kind="primary" icon="check" busy=${busy} disabled=${!uid} onClick=${() => save(true)}>저장하고 다음 학생</${Btn}>`}>
    <div class="stack">
      ${last && html`<div class="notice"><${Icon} name="checkCircle" /><div><b>${last.name}</b> 학생 답안을 저장했어요. ${last.score}/${last.total}점이에요.</div></div>`}
      <${Field} label="학생">${!sd ? html`<${Skel} h=${42} />` : html`<select value=${uid} onChange=${(e) => choose(e.target.value)}>
        <option value="">학생을 골라 주세요</option>
        ${groups.map(([g, ls]) => html`<optgroup label=${g}>${ls.map((s) => {
          const a = byUser.get(s.id);
          return html`<option value=${s.id}>${s.name}${a ? ` (${a.paper ? '종이' : '앱'} ${a.score}/${a.total})` : ''}</option>`;
        })}</optgroup>`)}</select>`}</${Field}>
      ${cur && html`<div class="notice amber"><${Icon} name="info" /><div>이미 ${cur.paper ? '넣은 종이 답안' : '학생 앱에서 낸 답안'}이 있어요 (${cur.score}/${cur.total}). 저장하면 이 답으로 바뀌어요.</div></div>`}
      ${mcIdx.length > 0 && html`<div class="field"><label>객관식 답 (1~${mcIdx.length}번)</label>
        <input ref=${mcRef} class="pp-mc num" inputmode="numeric" autocomplete="off" spellcheck="false" value=${mc} onInput=${(e) => setMc(e.target.value)}
          placeholder="답의 번호를 차례로 쳐요. 예: 31524 15234" aria-label="객관식 답" onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); save(true); } }} />
        <div class="hint">1~5를 이어서 치면 돼요. 띄어쓰기는 상관없고, 안 쓴 답은 0이나 - 로 쳐요. 맞은 답은 초록, 틀린 답은 빨강으로 보여요.</div>
        <div class="pp-grid">${mcIdx.map((i, k) => {
          const it = items[i];
          const v = parsed[k];
          const typed = k < parsed.length;
          const bad = typed && v !== null && v >= it.choices.length;
          const cls = !typed ? '' : v === null || bad ? 'no' : v === it.answer ? 'ok' : 'no';
          return html`<span class=${`pp-c ${cls}`} title=${`${k + 1}번 정답 ${CIRC[it.answer]}`}><i class="num">${k + 1}</i><b>${!typed ? '' : bad ? '?' : v === null ? '-' : CIRC[v]}</b></span>`;
        })}</div>
        <div class="muted num" style="font-size:13.5px">객관식 ${okMc}/${mcIdx.length} 맞음${parsed.length < mcIdx.length ? `, ${mcIdx.length - parsed.length}개 남음` : ''}</div></div>`}
      ${saIdx.length > 0 && html`<div class="field"><label>서술형 답</label>
        <div class="pp-sas">${saIdx.map((i) => {
          const it = items[i];
          const v = sa[i];
          return html`<div class="pp-sa">
            <div class="pp-sa-h"><b class="num">${i + 1}</b><span class="faint">${SA_KIND[it.kind] || '서술형'}</span><span class="spacer"></span><span class="faint pp-key">정답 ${it.kind === 'fix' ? `${it.mark} ` : ''}${it.answer}</span></div>
            <div class="row" style="gap:6px">
              ${it.kind === 'fix' && html`<select class="input sm pp-mark" value=${(v && v.m) || ''} onChange=${(e) => setSaAns(i, { m: e.target.value, t: (v && v.t) || '' })} aria-label=${`${i + 1}번 기호`}><option value="">기호</option>${MARKS.map((m) => html`<option value=${m}>${m}</option>`)}</select>`}
              <input class="input sm" lang="en" autocapitalize="off" autocomplete="off" spellcheck="false" style="flex:1;min-width:0" aria-label=${`${i + 1}번 답`}
                value=${it.kind === 'fix' ? (v && v.t) || '' : v || ''} placeholder="학생이 쓴 답"
                onInput=${(e) => setSaAns(i, it.kind === 'fix' ? { m: (v && v.m) || '', t: e.target.value } : e.target.value)} /></div></div>`;
        })}</div>
        <div class="hint">학생이 쓴 그대로 쳐 주세요. 철자까지 맞아야 정답이고, 채점이 이상하면 결과에서 학생을 눌러 맞음으로 바꿀 수 있어요.</div></div>`}
    </div>
  </${Modal}>`;
}

// ================================================================ 반 성적표 (반 → 성적)
export function ClassScores({ cls, ver }) {
  const { data, loading, reload } = useAsync(() => api(`/api/admin/classes/${cls.id}/scores`), [cls.id, ver]);
  const [cell, setCell] = useState(null);
  const [allCols, setAllCols] = useState(false);
  const [give, setGive] = useState(false);
  if (loading && !data) return html`<${Skel} h=${300} />`;
  if (!data) return null;
  const closedN = data.cols.filter((c) => c.closed).length;
  const cols = data.cols.filter((c) => allCols || !c.closed);
  const students = data.students;
  const cellOf = (s, c) => (data.cells[s.id] || {})[c.key];
  const meanPct = (list) => (list.length ? Math.round((list.reduce((t, x) => t + (x.total ? x.score / x.total : 0), 0) / list.length) * 100) : null);
  const showAll = closedN > 0 && html`<label class="wt-all"><input type="checkbox" checked=${allCols} onChange=${(e) => setAllCols(e.target.checked)} />목록에서 지운 과제도 보기 (${closedN})</label>`;
  const giveBtn = html`<${Btn} size="sm" icon="clipboardCheck" onClick=${() => setGive(true)}>시험 내기</${Btn}>`;
  let body;
  if (!students.length) body = html`<${Empty} icon="userPlus" title="이 반에 학생이 없어요" />`;
  else if (!cols.length) {
    body = html`<${Empty} icon="chart" title=${closedN ? '진행 중인 과제에 점수가 없어요' : '아직 모인 점수가 없어요'} action=${html`<div class="row wrap" style="justify-content:center;gap:8px">${showAll}<${Btn} kind="soft" icon="clipboardCheck" onClick=${() => setGive(true)}>시험 내기</${Btn}></div>`}>확인 문제나 숙제가 있는 강의를 과제로 내거나 시험을 내면, 학생들 점수가 여기에 모여요.</${Empty}>`;
  } else {
    body = html`<div class="table-wrap" style="max-height:70vh"><table class="matrix scores">
      <thead><tr><th class="sticky">학생</th><th class="sc-avg-h">평균</th>${cols.map((c) => {
        const got = students.map((s) => cellOf(s, c)).filter(Boolean);
        const avg = meanPct(got);
        return html`<th class=${`lh sc-h ${c.closed ? 'closed' : ''}`}><button class="sc-hb" onClick=${() => go(c.kind === 'exam' ? `/exams/${c.id}` : `/lecture/${c.id}`)} title=${`${c.title} 열기`}>
          <span class=${`sc-kind ${c.kind}`}>${KIND_NAME[c.kind]}</span><div class="clamp2">${c.title}</div>
          <div class="sum num">${got.length}/${students.length}명${avg !== null ? `, 평균 ${avg}%` : ''}</div></button></th>`;
      })}</tr></thead>
      <tbody>${students.map((s) => {
        const got = cols.map((c) => cellOf(s, c)).filter(Boolean);
        const avg = meanPct(got);
        return html`<tr><td class="sticky"><div style="font-weight:700">${s.name}</div><div class="faint" style="font-size:12px">${got.length}/${cols.length}개 풀었어요</div></td>
          <td class=${`sc-avg num ${avg !== null ? toneOf(avg) : ''}`}>${avg !== null ? `${avg}%` : '-'}</td>
          ${cols.map((c) => {
            const x = cellOf(s, c);
            if (!x) return html`<td class="c"><span class="sc-cell none">-</span></td>`;
            const p = pctOf(x.score, x.total);
            return html`<td class="c"><button class=${`sc-cell ${toneOf(p)}`} title=${`${s.name}, ${c.title} ${KIND_NAME[c.kind]}${x.paper ? ', 종이 답안' : ''}. 눌러서 답안 보기`} onClick=${() => setCell({ kind: c.kind, id: x.id })}>
              <b class="num">${x.score}/${x.total}</b><small class="num">${p}%${x.paper ? ', 종이' : ''}</small></button></td>`;
          })}</tr>`;
      })}</tbody></table></div>`;
  }
  return html`<div class="panel" style="overflow:hidden">
    <div class="row wrap sc-top">
      <div class="legend"><span><i class="sc-dot good"></i>80% 이상</span><span><i class="sc-dot low"></i>60% 아래</span><span class="hide-m">점수를 누르면 답안을 봐요</span></div>
      <span class="spacer"></span>${cols.length > 0 && showAll}${giveBtn}
      <a class="btn secondary sm" href=${`/api/admin/classes/${cls.id}/scores.csv`}><${Icon} name="download" size="sm" />엑셀로 받기</a></div>
    ${body}
    ${cell && html`<${AttemptModal} kind=${cell.kind} id=${cell.id} onClose=${() => setCell(null)} onChanged=${() => reload(true)} />`}
    ${give && html`<${ClassExamModal} cls=${cls} onClose=${() => setGive(false)} onDone=${() => reload(true)} />`}
  </div>`;
}

// 반 성적표에서 한 학생 답안 열기
const ATTEMPT_BASE = { quiz: '/api/admin/quiz-attempts', hw: '/api/admin/hw-attempts', exam: '/api/admin/exam-attempts' };
function AttemptModal({ kind, id, onClose, onChanged }) {
  const base = ATTEMPT_BASE[kind];
  const { data, error } = useAsync(() => api(`${base}/${id}`), [base, id]);
  useEffect(() => {
    if (error) {
      toastErr(error);
      onClose();
    }
  }, [error]);
  if (!data) return html`<${Modal} title="답안 불러오는 중" onClose=${onClose}><${Skel} h=${140} /></${Modal}>`;
  return html`<${AnswerModal} quiz=${data.quiz} a=${data.attempt} base=${base} onClose=${onClose} onChanged=${onChanged} />`;
}

// 반 화면에서 시험 내기: 만든 시험 하나를 골라 이 반에 내요
function ClassExamModal({ cls, onClose, onDone }) {
  const { data } = useAsync(() => api('/api/admin/exams'), []);
  const [pick, setPick] = useState(null);
  const [due, setDue] = useState(daysLater(3));
  const [noDue, setNoDue] = useState(true);
  const [busy, setBusy] = useState(false);
  const list = data ? data.exams : [];
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/exams/${pick}/classes`, { method: 'POST', body: { class_ids: [cls.id], due_at: noDue || !due ? null : endOfDay(due) } });
      toast(`${cls.name}에 시험을 냈어요. 학생 앱에 바로 나타나요`);
      onDone();
      onClose();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${`${cls.name}에 시험 내기`} onClose=${onClose}
    footer=${html`<a class="btn secondary" href="#/exams/new">새 시험 만들기</a><span class="spacer"></span><${Btn} kind="primary" icon="send" busy=${busy} disabled=${!pick} onClick=${save}>이 반에 내기</${Btn}>`}>
    <div class="stack">
      ${!data ? html`<${Skel} h=${120} />` : list.length ? html`<div class="stack sm">${list.slice(0, 30).map((e) => {
        const had = e.classes.some((c) => c.class_id === cls.id);
        return html`<button type="button" class=${`choice ${pick === e.id ? 'on' : ''}`} onClick=${() => setPick(e.id)}><span class="radio"></span>
          <span style="flex:1;min-width:0"><span class="ct ellipsis" style="display:block">${e.title}</span><span class="cd">${typeText(e)}, ${fmtDate(e.created_at)} 만듦</span></span>
          ${had && html`<span class="meta">이미 냄</span>`}</button>`;
      })}</div>`
        : html`<p class="muted" style="margin:0">아직 만든 시험이 없어요. '새 시험 만들기'로 강의의 확인 문제와 문제 은행에서 골라 만들어 주세요.</p>`}
      ${list.length > 0 && html`<${DuePicker} due=${due} setDue=${setDue} noDue=${noDue} setNoDue=${setNoDue} quick=${[[0, '오늘'], [1, '내일'], [3, '3일 뒤'], [7, '1주 뒤']]} />`}
    </div>
  </${Modal}>`;
}

