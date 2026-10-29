// 선생님 강의 화면의 문제 은행 카드: 숙제(사이트에서 풀기, 출력용 숙제지), 모의고사, 문제 자료와 올린 사진
import { html, useState, useEffect, api, Icon, Btn, Modal, Skel, toast, toastErr, confirmBox, fmtDate, fmtBytes, useAsync } from './ui.js';
import { QuizItem, AREA, isOk } from './quizview.js';

// ------------------------------------------------------------ 자료 파일 올리기 (사진은 긴 변 2000px JPG로 줄여서)
const MAX_SIDE = 2000;
export async function prepFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: PDF가 너무 커요 (20MB까지).`);
    return { blob: file, type: 'application/pdf', name: file.name };
  }
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error(`${file.name}: 사진(JPG, PNG)이나 PDF만 올릴 수 있어요. 한글(HWP) 파일은 PDF로 저장해서 올려 주세요.`);
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: 사진을 열 수 없어요. JPG나 PNG로 올려 주세요.`);
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.86));
  return { blob, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

export async function uploadMaterial(file, { purpose = 'passage', lectureId = null } = {}) {
  const f = await prepFile(file);
  const qs = new URLSearchParams({ purpose, name: f.name });
  if (lectureId) qs.set('lecture_id', String(lectureId));
  const r = await api(`/api/admin/materials?${qs}`, { method: 'PUT', body: f.blob, raw: true, headers: { 'Content-Type': f.type } });
  return r.material;
}

// ------------------------------------------------------------ 문제 은행을 채우는 엔진 작업 표시
function BankTask({ task, what = '문제 은행을 채우는 중' }) {
  if (!task) return null;
  if (task.status === 'queued' || task.status === 'running') {
    return html`<div class="task-run"><div class="row between" style="font-size:13.5px"><b>${task.status === 'queued' ? `${what}: 차례를 기다리는 중` : task.progress_msg || what}</b><span class="num muted">${task.progress || 0}%</span></div>
      <div class="hl-track"><i style=${`width:${task.progress || 0}%`}></i></div>
      ${task.status === 'queued' && html`<div class="faint" style="font-size:12.5px;margin-top:6px">학원 PC의 제작 엔진이 1.3.0 이상이어야 만들어요. 엔진은 저절로 업데이트돼요.</div>`}</div>`;
  }
  if (task.status === 'failed') return html`<div class="notice rose"><${Icon} name="alert" /><div style="font-size:13.5px">문제를 만들지 못했어요: ${task.error || ''}</div></div>`;
  return null;
}
const working = (t) => !!(t && (t.status === 'queued' || t.status === 'running'));

function usePoll(on, reload, ms = 4000) {
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => reload(true), ms);
    return () => clearInterval(t);
  }, [on]);
}

async function moreQuestions(lec, reload, seeded) {
  try {
    const r = await api(`/api/admin/lectures/${lec.id}/bank`, { method: 'POST', body: {} });
    toast(r.already ? '이미 만들고 있어요' : seeded ? '문제 자료를 본보기로 새 문제를 만들기 시작했어요' : '새 문제를 만들기 시작했어요');
    reload(true);
  } catch (e) {
    toastErr(e);
  }
}

// ------------------------------------------------------------ 학생 답안 보기 (숙제: 서술형은 맞음·틀림을 바꿀 수 있어요)
export function AnswerModal({ quiz, a, base, onClose, onChanged }) {
  const [res, setRes] = useState(a.results);
  const [score, setScore] = useState(a.score);
  const setOk = async (i, ok) => {
    try {
      const r = await api(`${base}/${a.id}`, { method: 'PUT', body: { i, ok } });
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
      await api(`${base}/${a.id}`, { method: 'DELETE' });
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

function KeyModal({ title, quiz, right, n, onClose, footer }) {
  return html`<${Modal} title=${title} onClose=${onClose} wide footer=${footer || html`<span class="spacer"></span><button class="btn primary" onClick=${onClose}>닫기</button>`}>
    <div class="qk-list">${quiz.items.map((it, i) => html`<${QuizItem} it=${it} i=${i} mode="key" stat=${n && right ? { rate: right[i] / n } : null} />`)}</div>
  </${Modal}>`;
}

// ------------------------------------------------------------ 숙제: 사이트에서 풀기 + 출력용 숙제지
export function HomeworkCard({ lec }) {
  const { data, reload } = useAsync(() => api(`/api/admin/lectures/${lec.id}/homework`), [lec.id]);
  const prints = useAsync(() => api(`/api/admin/lectures/${lec.id}/prints`), [lec.id]);
  const [busy, setBusy] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [stu, setStu] = useState(null);
  const task = data && data.task;
  usePoll(working(task), (q) => {
    reload(q);
    prints.reload(q);
  });
  const hw = data && data.homework;
  const atts = (data && data.attempts) || [];
  const pend = (data && data.pending) || [];
  const avg = atts.length ? atts.reduce((t, a) => t + a.score, 0) / atts.length : 0;
  const redraw = async () => {
    if (hw && !(await confirmBox({ title: '숙제를 다른 문제로 다시 뽑을까요?', body: '학생들은 새 숙제를 다시 풀어요. 지금까지 낸 숙제 점수는 목록에서 빠져요.', ok: '다시 뽑기' }))) return;
    setBusy('draw');
    try {
      await api(`/api/admin/lectures/${lec.id}/homework`, { method: 'POST', body: {} });
      toast('숙제를 새로 뽑았어요');
      reload(true);
    } catch (e) {
      toastErr(e);
      reload(true);
    }
    setBusy('');
  };
  const makePrint = async () => {
    setBusy('print');
    const w = window.open('', '_blank');
    try {
      const r = await api(`/api/admin/lectures/${lec.id}/prints`, { method: 'POST', body: {} });
      if (w) w.location.href = `/print.html#${r.id}`;
      else window.location.href = `/print.html#${r.id}`;
      prints.reload(true);
      reload(true);
    } catch (e) {
      if (w) w.close();
      toastErr(e);
      reload(true);
    }
    setBusy('');
  };
  const delPrint = async (p) => {
    if (!(await confirmBox({ title: '이 숙제지를 목록에서 지울까요?', body: '지워도 그 문제들은 다른 숙제지에 다시 나오지 않아요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/admin/prints/${p.id}`, { method: 'DELETE' });
      prints.reload(true);
    } catch (e) {
      toastErr(e);
    }
  };
  const head = html`<div class="panel-h"><h2>숙제</h2>${hw && html`<span class="count">${hw.items.length}문항</span>`}<span class="spacer"></span>
    ${hw && html`<${Btn} size="sm" icon="eye" onClick=${() => setShowKey(true)}>문제 보기</${Btn}>`}</div>`;
  if (!data) return html`<section class="panel">${head}<div class="panel-b"><${Skel} h=${60} /></div></section>`;
  const plist = (prints.data && prints.data.prints) || [];
  return html`<section class="panel">${head}
    <div class="panel-b stack">
      <${BankTask} task=${task} />
      ${!hw && !working(task) && html`<div class="row wrap" style="gap:12px"><p class="muted" style="margin:0;flex:1;min-width:220px;font-size:14px">확인 문제와 다른 문제로 숙제를 내요. 강의가 완성되면 엔진이 이 지문으로 내신 변형 문제를 만들어 문제 은행에 쌓고, 거기서 객관식 10문항과 서술형 5문항을 뽑아요.</p>
        <${Btn} kind="soft" icon="sparkles" busy=${busy === 'draw'} onClick=${redraw}>숙제 뽑기</${Btn}></div>`}
      ${hw && html`<div class="qk-stats">
          <div><span>낸 학생</span><b class="num">${atts.length}명</b></div>
          <div><span>평균</span><b class="num">${atts.length ? `${avg.toFixed(1)}점` : '-'}</b></div>
          <div><span>아직 안 낸 학생</span><b class="num">${pend.length}명</b></div></div>
        ${atts.length > 0 ? html`<ul class="rows qk-rows">${atts.map((a) => html`<li class="row" style="cursor:pointer" onClick=${() => setStu(a)}>
            <div style="flex:1;min-width:0"><b>${a.name}</b> <span class="faint" style="font-size:12.5px">${a.class_name || ''}</span></div>
            <span class="faint num" style="font-size:12.5px">${fmtDate(a.created_at)}</span><b class="num qk-sc">${a.score}/${a.total}</b></li>`)}</ul>`
          : html`<p class="muted" style="margin:0;font-size:14px">아직 낸 학생이 없어요. 과제로 낸 반 학생들은 강의 화면의 숙제 칸에서 풀어요.</p>`}
        ${pend.length > 0 && html`<p class="faint" style="margin:0;font-size:13px">안 낸 학생: ${pend.slice(0, 30).map((x) => x.name).join(', ')}${pend.length > 30 ? ` 외 ${pend.length - 30}명` : ''}</p>`}
        <div class="row" style="justify-content:flex-end"><${Btn} kind="ghost" size="sm" icon="refresh" busy=${busy === 'draw'} onClick=${redraw}>다른 문제로 다시 뽑기</${Btn}></div>`}
      <div class="print-box">
        <div class="row between wrap" style="gap:10px"><div style="min-width:0"><b>출력용 숙제지</b><div class="faint" style="font-size:13px">사이트 숙제와 다른 문제로 객관식 20, 서술형 5문항을 뽑아 시험지 모양으로 인쇄해요. 답안지와 정답과 해설도 함께 나와요.</div></div>
          <${Btn} kind="soft" icon="printer" busy=${busy === 'print'} onClick=${makePrint}>숙제지 만들기</${Btn}></div>
        ${plist.length > 0 && html`<ul class="rows" style="margin-top:6px">${plist.map((p, k) => html`<li class="row">
          <div style="flex:1;min-width:0"><b>숙제지 ${plist.length - k}</b> <span class="faint num" style="font-size:12.5px">${fmtDate(p.created_at, true)}, ${p.n}문항</span></div>
          <a class="btn ghost sm" href=${`/print.html#${p.id}`} target="_blank" rel="noopener"><${Icon} name="printer" size="sm" />열기</a>
          <button class="btn ghost icon sm" aria-label="지우기" onClick=${() => delPrint(p)}><${Icon} name="trash" size="sm" /></button></li>`)}</ul>`}
      </div>
    </div>
    ${showKey && hw && html`<${KeyModal} title=${`숙제, ${hw.items.length}문항`} quiz=${hw} right=${data.right} n=${atts.length} onClose=${() => setShowKey(false)} />`}
    ${stu && hw && html`<${AnswerModal} quiz=${hw} a=${stu} base="/api/admin/hw-attempts" onClose=${() => setStu(null)} onChanged=${() => reload(true)} />`}
  </section>`;
}

// ------------------------------------------------------------ 모의고사와 문제 은행
export function MockCard({ lec }) {
  const bank = useAsync(() => api(`/api/admin/lectures/${lec.id}/bank`), [lec.id]);
  const mock = useAsync(() => api(`/api/admin/lectures/${lec.id}/mock`), [lec.id]);
  const [show, setShow] = useState(false);
  const task = bank.data && bank.data.task;
  usePoll(working(task), (q) => bank.reload(q));
  const c = bank.data && bank.data.counts;
  const m = mock.data;
  return html`<section class="panel"><div class="panel-h"><h2>모의고사</h2>${c && html`<span class="count">문제 은행 ${c.mc + c.sa}문항</span>`}<span class="spacer"></span>
      ${c && c.mc + c.sa > 0 && html`<${Btn} size="sm" icon="library" onClick=${() => setShow(true)}>문제 은행 보기</${Btn}>`}</div>
    <div class="panel-b stack">
      ${!bank.data ? html`<${Skel} h=${50} />` : html`
        <p class="muted" style="margin:0;font-size:14px">학생이 강의 화면에서 모의고사를 풀 때마다 문제 은행에서 객관식 10문항을 새로 뽑아요. 학생마다 안 본 문제부터 유형이 고루 섞이게 나오고, 안 본 문제가 모자라 가면 엔진이 새 문제를 더 만들어요. 출력한 숙제지에 쓴 문제는 모의고사에 나오지 않아요.</p>
        <${BankTask} task=${task} />
        <div class="qk-stats">
          <div><span>모의고사에 나오는 문제</span><b class="num">${m ? `${m.pool}문항` : '-'}</b></div>
          <div><span>푼 횟수</span><b class="num">${m ? `${m.attempts}번` : '-'}</b></div>
          <div><span>평균</span><b class="num">${m && m.attempts ? `${Math.round(m.avg * 100)}%` : '-'}</b></div></div>
        ${m && m.students.length > 0 && html`<ul class="rows qk-rows">${m.students.slice(0, 40).map((s) => html`<li class="row">
          <div style="flex:1;min-width:0"><b>${s.name}</b> <span class="faint" style="font-size:12.5px">${s.class_name || ''}</span></div>
          <span class="faint num" style="font-size:12.5px">${s.n}번, 최고 ${Math.round(s.best * 100)}%</span><b class="num qk-sc">${s.last}</b></li>`)}</ul>`}
        <div class="row wrap" style="justify-content:flex-end;gap:6px">${c && c.mc + c.sa > 0 && html`<a class="btn ghost sm" href=${`#/exams/new?l=${lec.id}`}><${Icon} name="clipboardCheck" size="sm" />골라서 시험 만들기</a>`}
          <${Btn} kind="ghost" size="sm" icon="sparkles" disabled=${working(task)} onClick=${() => moreQuestions(lec, bank.reload)}>문제 더 만들기</${Btn}></div>`}
    </div>
    ${show && html`<${BankModal} lec=${lec} onClose=${() => { setShow(false); bank.reload(true); }} />`}
  </section>`;
}

const USED = { hw: '숙제', print: '숙제지', exam: '시험', mock: '모의고사' };
function BankModal({ lec, onClose }) {
  const { data, reload } = useAsync(() => api(`/api/admin/lectures/${lec.id}/bank`), [lec.id]);
  const [only, setOnly] = useState('all');
  const toggle = async (it) => {
    try {
      await api(`/api/admin/bank/${it.bank_id}`, { method: 'PUT', body: { hidden: !it.hidden } });
      reload(true);
    } catch (e) {
      toastErr(e);
    }
  };
  const items = data ? data.items.filter((x) => only === 'all' || (only === 'sa' ? x.type === 'sa' : x.type === 'mc')) : [];
  return html`<${Modal} title="문제 은행" onClose=${onClose} wide footer=${html`<span class="muted" style="font-size:13px">억지스러운 문제는 '빼기'를 누르면 숙제, 숙제지, 시험 만들기, 모의고사에 다시 나오지 않아요.</span><span class="spacer"></span><button class="btn primary" onClick=${onClose}>닫기</button>`}>
    ${!data ? html`<${Skel} h=${200} />` : html`
      <div class="row" style="gap:6px;margin-bottom:12px">${[['all', `모두 ${data.items.length}`], ['mc', `객관식 ${data.items.filter((x) => x.type === 'mc').length}`], ['sa', `서술형 ${data.items.filter((x) => x.type === 'sa').length}`]].map(([k, t]) => html`<button class=${`chip ${only === k ? 'ivy' : ''}`} onClick=${() => setOnly(k)}>${t}</button>`)}</div>
      <div class="qk-list">${items.map((it, i) => html`<div class=${`bank-it ${it.hidden ? 'off' : ''}`}>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:-4px;font-size:12.5px">
          <span class="chip">${it.type === 'mc' ? AREA[it.area] || it.area : '서술형'}</span>
          ${it.source === 'seed' && html`<span class="chip">자료 본보기</span>`}
          ${(it.used || []).map((u) => html`<span class="chip amber">${USED[u]}</span>`)}
          <span class="faint">검사 ${it.score || '-'}점</span><span class="spacer"></span>
          <${Btn} size="sm" kind="ghost" icon=${it.hidden ? 'refresh' : 'x'} onClick=${() => toggle(it)}>${it.hidden ? '다시 넣기' : '빼기'}</${Btn}></div>
        <${QuizItem} it=${it} i=${i} mode="key" /></div>`)}</div>`}
  </${Modal}>`;
}

// ------------------------------------------------------------ 문제 자료와 올린 사진
export function MaterialsCard({ lec }) {
  const { data, reload } = useAsync(() => api(`/api/admin/materials?lecture_id=${lec.id}`), [lec.id]);
  const bank = useAsync(() => api(`/api/admin/lectures/${lec.id}/bank`), [lec.id]);
  const [busy, setBusy] = useState('');
  const [paste, setPaste] = useState(false);
  const task = bank.data && bank.data.task;
  usePoll(working(task), (q) => bank.reload(q));
  const list = (data && data.materials) || [];
  const seeds = list.filter((x) => x.purpose === 'seed');
  const photos = list.filter((x) => x.purpose === 'passage');
  const upload = async (files) => {
    if (!files || !files.length) return;
    setBusy('up');
    let n = 0;
    for (const f of [...files].slice(0, 12)) {
      try {
        await uploadMaterial(f, { purpose: 'seed', lectureId: lec.id });
        n++;
      } catch (e) {
        toastErr(e);
      }
    }
    if (n) toast(`문제 자료 ${n}개를 올렸어요`);
    setBusy('');
    reload(true);
  };
  const del = async (x) => {
    if (!(await confirmBox({ title: `"${x.name}"을 지울까요?`, body: '올린 자료가 사이트에서 지워져요. 이미 만든 문제는 그대로 남아요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/admin/materials/${x.id}`, { method: 'DELETE' });
      toast('지웠어요');
      reload(true);
    } catch (e) {
      toastErr(e);
    }
  };
  const row = (x) => html`<li class="row">
    <span class="mat-ic"><${Icon} name=${x.has_file ? (x.mime === 'application/pdf' ? 'fileText' : 'image') : 'clipboard'} size="sm" /></span>
    <div style="flex:1;min-width:0"><div class="ellipsis" style="font-weight:650">${x.name}</div><div class="faint num" style="font-size:12px">${fmtDate(x.created_at)}${x.size ? `, ${x.has_file ? fmtBytes(x.size) : `${x.size.toLocaleString()}자`}` : ''}</div></div>
    ${x.has_file && html`<a class="btn ghost icon sm" href=${`/api/admin/materials/${x.id}/file`} target="_blank" rel="noopener" aria-label="열기"><${Icon} name="eye" size="sm" /></a>`}
    <button class="btn ghost icon sm" aria-label="지우기" onClick=${() => del(x)}><${Icon} name="trash" size="sm" /></button></li>`;
  return html`<section class="panel"><div class="panel-h"><h2>문제 자료</h2>${seeds.length > 0 && html`<span class="count">${seeds.length}개</span>`}</div>
    <div class="panel-b stack">
      <p class="muted" style="margin:0;font-size:13.5px">기출이나 직접 만든 문제를 넣어 두면, 엔진이 그 유형과 말투를 본보기로 이 지문의 새 문제를 계속 만들어요. 한글(HWP) 파일은 PDF로 저장해서 올려 주세요.</p>
      ${seeds.length > 0 && html`<ul class="rows">${seeds.map(row)}</ul>`}
      <div class="row wrap" style="gap:8px">
        <label class="btn secondary sm" style="cursor:pointer"><${Icon} name="upload" size="sm" />${busy === 'up' ? '올리는 중…' : 'PDF, 사진 올리기'}<input type="file" multiple accept="application/pdf,image/*" class="sr" disabled=${busy === 'up'} onChange=${(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
        <${Btn} size="sm" icon="clipboard" onClick=${() => setPaste(true)}>글 붙여 넣기</${Btn}>
        ${seeds.length > 0 && html`<${Btn} kind="soft" size="sm" icon="sparkles" disabled=${working(task)} onClick=${() => moreQuestions(lec, bank.reload, true)}>이 자료로 문제 더 만들기</${Btn}>`}
      </div>
      <${BankTask} task=${task} />
      ${photos.length > 0 && html`<div><div class="label" style="margin:6px 0 4px">강의를 만들 때 올린 사진</div><ul class="rows">${photos.map(row)}</ul></div>`}
    </div>
    ${paste && html`<${PasteModal} lec=${lec} onClose=${() => setPaste(false)} onDone=${() => { setPaste(false); reload(true); }} />`}
  </section>`;
}

function PasteModal({ lec, onClose, onDone }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/admin/materials', { method: 'POST', body: { purpose: 'seed', lecture_id: lec.id, text, name: name.trim() || '붙여 넣은 문제' } });
      toast('문제 자료를 넣었어요');
      onDone();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  return html`<${Modal} title="문제 자료 붙여 넣기" onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>닫기</button><span class="spacer"></span><${Btn} kind="primary" icon="check" busy=${busy} disabled=${text.trim().length < 20} onClick=${save}>넣기</${Btn}>`}>
    <div class="stack sm">
      <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="자료 이름 (예: 2025 1학기 기말 기출)" />
      <textarea class="input" rows="12" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="문제와 보기, 정답을 그대로 붙여 넣어 주세요. 정답이 없어도 괜찮아요."></textarea>
    </div>
  </${Modal}>`;
}
