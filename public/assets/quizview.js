// 확인 문제, 숙제, 모의고사를 푸는 화면. 학생이 푸는 화면과 선생님이 문제·답안을 보는 화면이 같은 부품을 써요.
import { html, useState, useEffect, api, Icon, Btn, Empty, Skel, toast, toastErr, confirmBox, fmtDate } from './ui.js';

export const AREA = {
  vocab: '어휘', grammar: '문법', translate: '해석', content: '내용', variant: '변형',
  // 문제 은행(숙제, 모의고사, 숙제지)의 변형 문제 유형
  topic: '주제', title: '제목', gist: '요지', detail: '내용 일치', refer: '지칭', blank: '빈칸', order: '순서', insert: '문장 위치', irrelevant: '무관한 문장', summary: '요약문',
};
export const CIRC = ['①', '②', '③', '④', '⑤'];
export const MARKS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ'];
const KIND = { word: '단어 쓰기', fix: '어법 고치기', form: '형태 바꾸기', blank: '빈칸 채우기', refer: '가리키는 말' };

export const isOk = (r) => r === 1 || r === 2;

// 문제 속 영어: __밑줄__, _____ 빈칸
export function QuizText({ s }) {
  const parts = String(s || '').split(/(__[^_]+?__|_{3,})/g);
  return parts.map((p) => {
    if (/^__[^_]+__$/.test(p)) return html`<u>${p.slice(2, -2)}</u>`;
    if (/^_{3,}$/.test(p)) return html`<span class="blank" aria-label="빈칸"></span>`;
    return p;
  });
}

const hasHangul = (s) => /[가-힣]/.test(String(s || ''));

export function answered(it, a) {
  if (a === undefined || a === null) return false;
  if (it.type === 'mc') return Number.isInteger(a);
  if (it.kind === 'fix') return !!(a && a.m && String(a.t || '').trim());
  return !!String(a).trim();
}

// 보기가 번호나 기호뿐이면(밑줄 친 ①~⑤ 중 고르기, 문장 위치) 번호를 두 번 쓰지 않아요
export const markOnly = (c) => /^[①-⑤ⓐ-ⓔ]$/.test(String(c || '').trim());
const choiceText = (it, k) => (markOnly(it.choices[k]) ? it.choices[k] : `${CIRC[k] || ''} ${it.choices[k] || ''}`);

function showAnswer(it, a) {
  if (a === undefined || a === null || a === '') return '안 썼어요';
  if (it.type === 'mc') return choiceText(it, a);
  if (it.kind === 'fix') return `${a.m || '?'} ${a.t || ''}`.trim();
  return String(a);
}
function rightAnswer(it) {
  if (it.type === 'mc') return choiceText(it, it.answer);
  if (it.kind === 'fix') return `${it.mark} ${it.answer}`;
  return it.answer;
}

// 문항 하나. mode: solve(풀기), review(낸 뒤 해설), key(선생님 문제 보기)
export function QuizItem({ it, i, mode, value, onChange, result, stat }) {
  const review = mode !== 'solve';
  const ok = isOk(result);
  const done = mode === 'solve' && answered(it, value);
  const mark = (k) => {
    if (!review) return '';
    if (k === it.answer) return 'ok';
    if (mode === 'review' && k === value) return 'no';
    return 'dim';
  };
  return html`<article class=${`qi ${done ? 'on' : ''} ${mode === 'review' ? (ok ? 'is-ok' : 'is-no') : ''}`} id=${`q-${i + 1}`}>
    <div class="qi-h"><b class="qn num">${i + 1}</b><span class="qa">${AREA[it.area] || ''}${it.type === 'sa' ? `, ${KIND[it.kind] || '서술형'}` : ''}</span>
      <span class="spacer"></span>
      ${mode === 'review' && html`<span class=${`chip ${ok ? 'ivy' : 'rose'}`}><${Icon} name=${ok ? 'check' : 'x'} size="sm" />${ok ? '맞았어요' : '틀렸어요'}</span>`}
      ${mode === 'key' && stat && html`<span class=${`chip ${stat.rate < 0.6 ? 'rose' : ''}`}>정답률 ${Math.round(stat.rate * 100)}%</span>`}</div>
    <p class="qs">${it.q}</p>
    ${it.text && html`<div class=${`qt ${hasHangul(it.text) && !/[a-z]{3,}/i.test(it.text) ? 'ko' : ''}`}><${QuizText} s=${it.text} /></div>`}
    ${it.type === 'mc'
      ? html`<div class="qo" role="group" aria-label=${`${i + 1}번 보기`}>${it.choices.map((c, k) => html`<button type="button" class=${mark(k)} aria-pressed=${!review && value === k}
          disabled=${review} onClick=${() => onChange && onChange(k)}>${markOnly(c) ? null : html`<span class="c">${CIRC[k]}</span>`}<span class=${hasHangul(c) ? '' : 'en'}>${c}</span></button>`)}</div>`
      : !review
        ? html`<div class="qsa">
            ${it.kind === 'fix' && html`<div class="qmarks" role="group" aria-label="틀린 곳 기호">${MARKS.map((m) => html`<button type="button" aria-pressed=${!!(value && value.m === m)}
              onClick=${() => onChange({ m, t: (value && value.t) || '' })}>${m}</button>`)}</div>`}
            <input type="text" lang="en" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label=${`${i + 1}번 답`}
              placeholder=${it.kind === 'fix' ? '바르게 고친 말' : '답을 쓰세요'}
              value=${it.kind === 'fix' ? (value && value.t) || '' : value || ''}
              onInput=${(e) => onChange(it.kind === 'fix' ? { m: (value && value.m) || '', t: e.target.value } : e.target.value)} />
            ${it.hint && html`<div class="qhint">${it.hint}</div>`}</div>`
        : null}
    ${review && html`<div class=${`qres ${mode === 'review' ? (ok ? 'ok' : 'no') : ''}`}>
      ${mode === 'review' && it.type === 'sa' && html`<div><span class="k">내 답</span><b class="v">${showAnswer(it, value)}</b></div>`}
      ${(it.type === 'sa' || mode === 'key') && html`<div><span class="k">정답</span><b>${rightAnswer(it)}</b>${(it.accept || []).length > 0 && html`<span class="muted">, 이것도 맞아요: ${it.accept.join(', ')}</span>`}</div>`}
      ${mode === 'review' && it.type === 'mc' && !ok && html`<div><span class="k">내 답</span>${value === null || value === undefined ? '안 골랐어요' : choiceText(it, value)}</div>`}
      ${result === 2 && html`<div class="muted" style="font-size:12.5px">선생님이 맞은 것으로 바꿨어요.</div>`}
      ${result === 3 && html`<div class="muted" style="font-size:12.5px">선생님이 틀린 것으로 바꿨어요.</div>`}
      ${it.why && html`<p class="why">${it.why}${it.ref ? html` <span class="faint">(${it.ref})</span>` : ''}</p>`}</div>`}
  </article>`;
}

// 영역별 맞힌 수
export function areaScore(items, results) {
  const out = {};
  items.forEach((it, i) => {
    const a = (out[it.area] = out[it.area] || [0, 0]);
    a[1]++;
    if (isOk(results[i])) a[0]++;
  });
  return out;
}

function draftKey(id, ver, preview, kind = 'quiz') {
  return `ivy-${kind}-${id}-${ver}${preview ? '-pv' : ''}`;
}
function loadDraft(k, n) {
  try {
    const a = JSON.parse(localStorage.getItem(k) || 'null');
    return Array.isArray(a) && a.length === n ? a : Array(n).fill(null);
  } catch {
    return Array(n).fill(null);
  }
}
function saveDraft(k, a) {
  try {
    localStorage.setItem(k, JSON.stringify(a));
  } catch {
    /* 저장이 막힌 브라우저면 그냥 둬요 */
  }
}
function dropDraft(k) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* 그냥 둬요 */
  }
}

// ------------------------------------------------------------ 학생이 푸는 화면 (확인 문제, 숙제, 시험: 한 번 내요)
const KINDS = {
  quiz: { url: (id) => `/api/student/lectures/${id}/quiz`, back: (id) => `/watch/${id}`, backText: '강의로 돌아가기', title: '확인 문제', lead: (n, mc, sa) => `강의를 듣고 푸는 ${n}문항이에요. ${sa ? `객관식 ${mc}개, 서술형 ${sa}개예요. ` : '모두 객관식이에요. '}다 풀고 맨 아래에서 답안을 내면 바로 채점돼요.` },
  hw: { url: (id) => `/api/student/lectures/${id}/homework`, back: (id) => `/watch/${id}`, backText: '강의로 돌아가기', title: '숙제', lead: (n, mc, sa) => `숙제 ${n}문항이에요. ${sa ? `객관식 ${mc}개, 서술형 ${sa}개예요. 서술형은 영어로 쓰세요. ` : ''}다 풀고 맨 아래에서 답안을 내면 바로 채점돼요.` },
  // 시험: 선생님이 골라 낸 문제 (홈에서 들어와요)
  exam: { url: (id) => `/api/student/exams/${id}`, back: () => '/', backText: '홈으로', title: '시험', lead: (n, mc, sa) => `시험 ${n}문항이에요. ${sa ? `객관식 ${mc}개, 서술형 ${sa}개예요. 서술형은 영어로 쓰세요. ` : ''}다 풀고 맨 아래에서 답안을 내면 바로 채점돼요. 한 번만 낼 수 있어요.` },
};

export function StudentQuiz({ id, q, nav, preview, kind = 'quiz' }) {
  const K = KINDS[kind] || KINDS.quiz;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ans, setAns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const load = () =>
    api(`${K.url(id)}${q}`)
      .then((d) => {
        setData(d);
        setAns(d.attempt ? d.attempt.answers : loadDraft(draftKey(id, d.quiz.ver, preview, kind), d.quiz.items.length));
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [id]);
  const back = () => nav(K.back(id));
  const top = html`<header class="s-top"><button class="vback" onClick=${back} aria-label=${K.backText}><${Icon} name="chevronLeft" /></button>
    <div class="brand-s">${K.title}</div><span class="spacer"></span>
    ${data && !data.attempt && data.quiz.items.length > 0 && html`<span class="qz-count num">${ans.filter((a, i) => answered(data.quiz.items[i], a)).length}/${data.quiz.items.length}</span>`}</header>`;
  if (err) return html`${top}<div class="s-body"><${Empty} icon="alert" title=${`${K.title}${kind === 'exam' ? '을' : '를'} 열 수 없어요`} action=${html`<${Btn} onClick=${back}>${K.backText}</${Btn}>`}>${err.message}</${Empty}></div>`;
  if (!data) return html`${top}<div class="s-body"><${Skel} h=${70} mb=${16} /><${Skel} h=${160} /><${Skel} h=${160} /></div>`;
  const items = data.quiz.items;
  const a = data.attempt;
  const set = (i, v) => {
    const next = ans.slice();
    next[i] = v;
    setAns(next);
    saveDraft(draftKey(id, data.quiz.ver, preview, kind), next);
  };
  const submit = async () => {
    const left = items.filter((it, i) => !answered(it, ans[i])).length;
    const okGo = await confirmBox(
      left
        ? { title: `아직 안 푼 문제가 ${left}개 있어요`, body: '빈 문제는 틀린 것으로 채점돼요. 그래도 답안을 낼까요?', ok: '답안 내기' }
        : { title: '답안을 낼까요?', body: '내고 나면 고칠 수 없어요. 바로 점수와 해설을 볼 수 있어요.', ok: '답안 내기' },
    );
    if (!okGo) return;
    setBusy(true);
    try {
      const r = await api(`${K.url(id)}${q}`, { method: 'POST', body: { ver: data.quiz.ver, answers: ans } });
      dropDraft(draftKey(id, data.quiz.ver, preview, kind));
      setData({ ...data, ...r, quiz: r.quiz, attempt: r.attempt });
      setAns(r.attempt.answers);
      if (r.preview) toast('미리보기라서 점수는 남지 않아요');
      window.scrollTo(0, 0);
      const scr = document.querySelector('.scr');
      if (scr) scr.scrollTop = 0;
    } catch (e) {
      if (e && (e.code === 'quiz_changed' || e.code === 'closed')) load();
      toastErr(e);
    }
    setBusy(false);
  };
  // 시험: 선생님이 풀기를 마감했거나, 정답을 아직 안 열어 줬을 때
  if (kind === 'exam' && !a && data.closed) {
    return html`<div class="qz-page">${top}<div class="s-body"><div class="qz-title">${data.title}</div>
      <div class="card" style="margin-top:12px"><${Empty} icon="clock" title="시험이 끝났어요">선생님이 풀기를 마감해서 더 낼 수 없어요.</${Empty}></div></div>
      <div class="qz-bar"><${Btn} block onClick=${back}>${K.backText}</${Btn}></div></div>`;
  }
  if (kind === 'exam' && a && data.reveal === false) {
    return html`<div class="qz-page">${top}<div class="s-body"><div class="qz-title">${data.title}</div>
      <div class="card qz-score"><div class="row" style="gap:16px;align-items:center">
        <div class="qz-big num">${a.score}<small>/${a.total}</small></div>
        <div style="flex:1;min-width:0"><b>${a.score === a.total ? '모두 맞혔어요!' : a.score >= a.total * 0.8 ? '잘했어요!' : '수고했어요'}</b>
          <div class="faint" style="font-size:12.5px">${fmtDate(a.created_at, true)}에 ${a.paper ? '선생님이 종이 답안으로 채점했어요' : '냈어요'}</div></div></div>
        <p class="qz-lead" style="margin:12px 0 0">정답과 해설은 선생님이 열어 주면 여기서 볼 수 있어요.</p></div></div>
      <div class="qz-bar"><${Btn} block onClick=${back}>${K.backText}</${Btn}></div></div>`;
  }
  const mcN = items.filter((x) => x.type === 'mc').length;
  const saN = items.length - mcN;
  const group = (list, title) => {
    const shown = list.filter(({ i }) => !(a && onlyWrong && isOk(a.results[i])));
    if (!shown.length) return null;
    return html`<section class="qz-sec"><div class="sec-h">${title}</div>${shown.map(({ it, i }) => html`<${QuizItem} it=${it} i=${i} mode=${a ? 'review' : 'solve'}
      value=${ans[i]} result=${a ? a.results[i] : null} onChange=${(v) => set(i, v)} />`)}</section>`;
  };
  const withIdx = items.map((it, i) => ({ it, i }));
  const wrong = a ? a.results.filter((r) => !isOk(r)).length : 0;
  const by = a ? areaScore(items, a.results) : null;
  return html`<div class="qz-page">${top}
    <div class="s-body">
      <div class="qz-title">${data.title}</div>
      ${a ? html`<div class="card qz-score">
          <div class="row" style="gap:16px;align-items:center">
            <div class="qz-big num">${a.score}<small>/${a.total}</small></div>
            <div style="flex:1;min-width:0"><b>${a.score === a.total ? '모두 맞혔어요!' : a.score >= a.total * 0.8 ? '잘했어요!' : '틀린 문제를 해설과 함께 다시 봐요'}</b>
              <div class="faint" style="font-size:12.5px">${fmtDate(a.created_at, true)}에 ${a.paper ? '선생님이 종이 답안으로 채점했어요' : '냈어요'}</div></div></div>
          <div class="qz-areas">${Object.entries(by).map(([k, [o, t]]) => html`<span><i>${AREA[k] || k}</i><b class="num">${o}/${t}</b></span>`)}</div>
          ${wrong > 0 && html`<label class="qz-only"><input type="checkbox" checked=${onlyWrong} onChange=${(e) => setOnlyWrong(e.target.checked)} />틀린 문제만 보기 (${wrong}개)</label>`}
        </div>`
        : html`<p class="qz-lead">${K.lead(items.length, mcN, saN)}${data.due_at ? ` ${fmtDate(data.due_at)}까지 내요.` : ''}</p>`}
      ${group(withIdx.filter(({ it }) => it.type === 'mc'), saN ? `객관식 ${mcN}문항` : `${mcN}문항`)}
      ${group(withIdx.filter(({ it }) => it.type === 'sa'), `서술형 ${saN}문항`)}
    </div>
    ${a ? html`<div class="qz-bar"><${Btn} block onClick=${back}>${K.backText}</${Btn}></div>`
      : html`<div class="qz-bar"><span class="num qz-left">${ans.filter((x, i) => answered(items[i], x)).length}/${items.length} 풀었어요</span>
        <${Btn} kind="primary" icon="send" busy=${busy} onClick=${submit}>답안 내기</${Btn}></div>`}
  </div>`;
}

// 강의 화면의 확인 문제 칸
export function QuizEntry({ id, quiz, result, completed, nav }) {
  if (!quiz) return null;
  return html`<div class="card qz-entry">
    <div class="row between" style="gap:12px">
      <div style="min-width:0"><div class="label"><${Icon} name="circleHelp" size="sm" /> 확인 문제</div>
        ${result ? html`<div class="qz-mid num">${result.score}<small>/${result.total}</small></div><div class="faint" style="font-size:12.5px">${fmtDate(result.created_at)}에 풀었어요</div>`
          : html`<div style="font-weight:700;margin-top:2px">${quiz.sa ? `${quiz.n}문항, 객관식 ${quiz.mc}개와 서술형 ${quiz.sa}개` : `객관식 ${quiz.n}문항, 풀면 바로 채점돼요`}</div>
            <div class="faint" style="font-size:12.5px">${completed ? '강의에서 배운 내용을 확인해요.' : '강의를 끝까지 보고 풀면 좋아요.'}</div>`}</div>
      <${Btn} kind=${result || !completed ? 'secondary' : 'primary'} size="sm" icon=${result ? 'eye' : 'pencil'} onClick=${() => nav(`/quiz/${id}`)}>${result ? '결과 보기' : '풀기'}</${Btn}>
    </div></div>`;
}

// 강의 화면의 숙제 칸
export function HomeworkEntry({ id, hw, result, nav }) {
  if (!hw) return null;
  return html`<div class="card qz-entry">
    <div class="row between" style="gap:12px">
      <div style="min-width:0"><div class="label"><${Icon} name="clipboard" size="sm" /> 숙제</div>
        ${result ? html`<div class="qz-mid num">${result.score}<small>/${result.total}</small></div><div class="faint" style="font-size:12.5px">${fmtDate(result.created_at)}에 냈어요</div>`
          : html`<div style="font-weight:700;margin-top:2px">${hw.sa ? `${hw.n}문항, 객관식 ${hw.mc}개와 서술형 ${hw.sa}개` : `객관식 ${hw.n}문항`}</div>
            <div class="faint" style="font-size:12.5px">확인 문제와 다른 문제예요. 시간 날 때 풀어요.</div>`}</div>
      <${Btn} kind="secondary" size="sm" icon=${result ? 'eye' : 'pencil'} onClick=${() => nav(`/hw/${id}`)}>${result ? '결과 보기' : '풀기'}</${Btn}>
    </div></div>`;
}

// 강의 화면의 모의고사 칸
export function MockEntry({ id, mock, nav }) {
  if (!mock) return null;
  return html`<div class="card qz-entry">
    <div class="row between" style="gap:12px">
      <div style="min-width:0"><div class="label"><${Icon} name="refresh" size="sm" /> 모의고사</div>
        <div style="font-weight:700;margin-top:2px">${mock.n}문항, 풀 때마다 다른 문제</div>
        <div class="faint" style="font-size:12.5px">${mock.times ? `${mock.times}번 풀었어요. 최고 ${mock.best}점, 지난번 ${mock.last.score}/${mock.last.total}` : '이 지문으로 내신 변형 문제를 풀어 봐요.'}</div></div>
      <${Btn} kind="secondary" size="sm" icon="pencil" onClick=${() => nav(`/mock/${id}`)}>${mock.times ? '또 풀기' : '풀기'}</${Btn}>
    </div></div>`;
}

// ------------------------------------------------------------ 모의고사: 풀 때마다 은행에서 새로 뽑아요
// 전에 푼 문제가 섞였을 때 까닭 (새 문제를 만드는 중인지, 문제를 거의 다 풀었는지)
function repeatNote(a, n) {
  const all = a.repeat >= n;
  if (a.making) return all ? '새 문제를 만들고 있어서 이번에는 전에 푼 문제로 나왔어요. 조금 뒤에 다시 풀면 새 문제가 나와요.' : `새 문제를 만들고 있어서 이번에는 전에 푼 문제가 ${a.repeat}개 섞여 있어요.`;
  return all ? '이 지문의 문제를 다 풀어서 이번에는 전에 푼 문제로 나왔어요. 다시 풀며 복습해 봐요.' : `이 지문의 문제를 거의 다 풀어서 전에 푼 문제가 ${a.repeat}개 섞여 있어요.`;
}

export function StudentMock({ id, q, nav, preview }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ans, setAns] = useState([]);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const top0 = () => {
    window.scrollTo(0, 0);
    const scr = document.querySelector('.scr');
    if (scr) scr.scrollTop = 0;
  };
  const dk = (a) => draftKey(id, a.id, preview, 'mock');
  const load = () =>
    api(`/api/student/lectures/${id}/mock${q}`)
      .then((d) => {
        setData(d);
        setRes(null);
        setAns(d.attempt ? loadDraft(dk(d.attempt), d.attempt.quiz.items.length) : []);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [id]);
  const back = () => nav(`/watch/${id}`);
  const a = data && data.attempt;
  const items = a ? (res ? res.quiz.items : a.quiz.items) : [];
  const top = html`<header class="s-top"><button class="vback" onClick=${back} aria-label="강의로 돌아가기"><${Icon} name="chevronLeft" /></button>
    <div class="brand-s">모의고사</div><span class="spacer"></span>
    ${a && !res && html`<span class="qz-count num">${ans.filter((x, i) => answered(items[i], x)).length}/${items.length}</span>`}</header>`;
  if (err) return html`<div class="qz-page">${top}<div class="s-body"><${Empty} icon="alert" title="모의고사를 열 수 없어요" action=${html`<${Btn} onClick=${back}>강의로 돌아가기</${Btn}>`}>${err.message}</${Empty}></div></div>`;
  if (!data) return html`<div class="qz-page">${top}<div class="s-body"><${Skel} h=${70} mb=${16} /><${Skel} h=${160} /></div></div>`;
  const start = async () => {
    setBusy(true);
    try {
      const d = await api(`/api/student/lectures/${id}/mock${q}`, { method: 'POST', body: {} });
      setData({ ...data, ...d });
      setRes(null);
      setOnlyWrong(false);
      setAns(Array(d.attempt.quiz.items.length).fill(null));
      top0();
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  };
  const set = (i, v) => {
    const next = ans.slice();
    next[i] = v;
    setAns(next);
    saveDraft(dk(a), next);
  };
  const submit = async () => {
    const left = items.filter((it, i) => !answered(it, ans[i])).length;
    const okGo = await confirmBox(
      left ? { title: `아직 안 푼 문제가 ${left}개 있어요`, body: '빈 문제는 틀린 것으로 채점돼요. 그래도 답안을 낼까요?', ok: '답안 내기' } : { title: '답안을 낼까요?', body: '내면 바로 점수와 해설을 볼 수 있어요.', ok: '답안 내기' },
    );
    if (!okGo) return;
    setBusy(true);
    try {
      const r = await api(`/api/student/mock/${a.id}${q}`, { method: 'POST', body: { answers: ans, ids: a.ids, lecture_id: Number(id) } });
      dropDraft(dk(a));
      setRes(r);
      setAns(r.attempt.answers);
      if (r.preview) toast('미리보기라서 점수는 남지 않아요');
      const h = { id: r.attempt.id, score: r.attempt.score, total: r.attempt.total, submitted_at: r.attempt.created_at };
      setData({ ...data, history: r.preview ? data.history : [h, ...(data.history || [])] });
      top0();
    } catch (e) {
      toastErr(e);
      if (e && e.code === 'already') load();
    }
    setBusy(false);
  };
  const hist = data.history || [];
  const best = hist.reduce((b, h) => Math.max(b, h.score), 0);
  if (!a) {
    return html`<div class="qz-page">${top}<div class="s-body">
      <div class="qz-title">${data.title}</div>
      <div class="card qz-score">
        <b>지문 하나로 내신 변형 문제 10문항을 풀어요</b>
        <p class="qz-lead" style="margin:6px 0 0">주제, 요지, 어법, 어휘, 빈칸, 순서, 문장 위치처럼 시험에 나오는 유형이 섞여 나와요. 풀 때마다 다른 문제가 나와서 여러 번 풀어도 돼요.</p>
        ${hist.length > 0 && html`<div class="qz-areas"><span><i>푼 횟수</i><b class="num">${hist.length}번</b></span><span><i>최고</i><b class="num">${best}점</b></span><span><i>지난번</i><b class="num">${hist[0].score}/${hist[0].total}</b></span></div>`}
      </div>
      ${hist.length > 0 && html`<div class="label" style="margin:18px 0 8px">지난 기록</div><div class="card" style="padding:4px 16px">${hist.slice(0, 8).map((h) => html`<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line-2)"><span class="faint num" style="font-size:13px">${fmtDate(h.submitted_at, true)}</span><b class="num">${h.score}/${h.total}</b></div>`)}</div>`}
    </div>
    <div class="qz-bar"><${Btn} kind="primary" block icon="pencil" busy=${busy} onClick=${start}>${hist.length ? '새 문제로 풀기' : '모의고사 풀기'}</${Btn}></div></div>`;
  }
  const r = res && res.attempt;
  const withIdx = items.map((it, i) => ({ it, i })).filter(({ i }) => !(r && onlyWrong && isOk(r.results[i])));
  const wrong = r ? r.results.filter((x) => !isOk(x)).length : 0;
  const by = r ? areaScore(items, r.results) : null;
  return html`<div class="qz-page">${top}
    <div class="s-body">
      <div class="qz-title">${data.title}</div>
      ${r ? html`<div class="card qz-score">
          <div class="row" style="gap:16px;align-items:center">
            <div class="qz-big num">${r.score}<small>/${r.total}</small></div>
            <div style="flex:1;min-width:0"><b>${r.score === r.total ? '모두 맞혔어요!' : r.score >= r.total * 0.8 ? '잘했어요!' : '틀린 문제를 해설과 함께 다시 봐요'}</b>
              <div class="faint" style="font-size:12.5px">${hist.length ? `${hist.length}번째 모의고사예요` : ''}</div></div></div>
          <div class="qz-areas">${Object.entries(by).map(([k, [o, t]]) => html`<span><i>${AREA[k] || k}</i><b class="num">${o}/${t}</b></span>`)}</div>
          ${wrong > 0 && html`<label class="qz-only"><input type="checkbox" checked=${onlyWrong} onChange=${(e) => setOnlyWrong(e.target.checked)} />틀린 문제만 보기 (${wrong}개)</label>`}
        </div>`
        : html`<p class="qz-lead">모의고사 ${items.length}문항이에요. 다 풀고 맨 아래에서 답안을 내면 바로 채점돼요.</p>
          ${a.repeat > 0 && html`<div class="notice" style="margin-bottom:14px"><${Icon} name="info" /><div style="font-size:13.5px">${repeatNote(a, items.length)}</div></div>`}`}
      <section class="qz-sec">${withIdx.map(({ it, i }) => html`<${QuizItem} it=${it} i=${i} mode=${r ? 'review' : 'solve'} value=${ans[i]} result=${r ? r.results[i] : null} onChange=${(v) => set(i, v)} />`)}</section>
    </div>
    ${r ? html`<div class="qz-bar"><${Btn} onClick=${back}>강의로</${Btn}><${Btn} kind="primary" icon="refresh" busy=${busy} onClick=${start}>새 문제로 또 풀기</${Btn}></div>`
      : html`<div class="qz-bar"><span class="num qz-left">${ans.filter((x, i) => answered(items[i], x)).length}/${items.length} 풀었어요</span>
        <${Btn} kind="primary" icon="send" busy=${busy} onClick=${submit}>답안 내기</${Btn}></div>`}
  </div>`;
}
