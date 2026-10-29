// 선생님 레벨테스트 화면: 반 → 레벨테스트
//   #/classes/lt        시험 링크 보내기, 결과 목록, 교재 목록
//   #/classes/lt/:번호  한 학생 결과: 영역별 레벨과 문항 기록, 라이팅 채점, 교재 고르기, 선생님 의견, 리포트 PDF
import { html, useState, useEffect, useRef, api, Icon, Btn, Field, Seg, Switch, Empty, Skel, Modal, toast, toastErr, confirmBox, fmtDate, ago, go, copyText, emit } from '../ui.js';

const CSS = ['/assets/lt/report.css', '/assets/lt/admin.css'];
function useCss() {
  for (const href of CSS) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}

const MODNAME = { voc: '어휘', gram: '문법', read: '리딩', listen: '듣기', write: '라이팅' };
const MOD_ORDER = ['voc', 'gram', 'read', 'listen', 'write'];
const ST = { running: ['보는 중', 'sky', true], scoring: ['라이팅 채점 중', 'amber', true], review: ['라이팅 직접 채점', 'rose', false], done: ['결과 나옴', 'ivy', false] };
const SHORT = ['초1 전', '초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const lvShort = (lv) => (lv == null ? '채점 전' : SHORT[Math.max(0, Math.min(12, lv))]);

function StChip({ status }) {
  const [t, tone, live] = ST[status] || [status, '', false];
  return html`<span class=${`chip ${tone}`}><span class=${`dot ${live ? 'pulse' : ''}`}></span>${t}</span>`;
}

function Html({ h, cls = '' }) {
  return html`<div class=${cls} dangerouslySetInnerHTML=${{ __html: h || '' }}></div>`;
}

const linkOf = (sel) => `${location.origin}/lt${sel.preset ? `?p=${sel.preset}` : `?m=${sel.mods.join(',')}`}`;
const minsOf = (mods, all) => {
  const ms = all.filter((m) => mods.includes(m.key));
  return [ms.reduce((a, m) => a + m.mins[0], 0), ms.reduce((a, m) => a + m.mins[1], 0)];
};

// ================================================================ 시험 링크와 결과 목록
export function LtHub({ info }) {
  useCss();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null); // { preset } 또는 { preset: '', mods: [...] }
  const [books, setBooks] = useState(false);
  const load = () =>
    api('/api/admin/lt')
      .then((r) => {
        setD(r);
        setErr(null);
        setSel((s) => s || (r.presets.some((p) => p.key === r.preset) ? { preset: r.preset, mods: r.presets.find((p) => p.key === r.preset).mods } : { preset: '', mods: String(r.preset || '').split(',').filter((k) => MOD_ORDER.includes(k)) }));
      })
      .catch(setErr);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (err && !d) return html`<div class="panel"><${Empty} title="불러오지 못했어요" action=${html`<${Btn} onClick=${load}>다시 시도</${Btn}>`}>${err.message}</${Empty}></div>`;
  if (!d || !sel) return html`<div><${Skel} h=${34} w="40%" mb=${20} /><${Skel} h=${220} /><${Skel} h=${260} /></div>`;

  const save = async (patch, msg) => {
    try {
      await api('/api/admin/lt', { method: 'PUT', body: patch });
      if (msg) toast(msg);
      load();
    } catch (e) {
      toastErr(e);
    }
  };
  const pick = (key) => {
    if (key === 'custom') {
      setSel({ preset: '', mods: sel.mods.length ? sel.mods : ['voc', 'read'] });
      save({ preset: (sel.mods.length ? sel.mods : ['voc', 'read']).join(',') });
      return;
    }
    const p = d.presets.find((x) => x.key === key);
    setSel({ preset: key, mods: p.mods });
    save({ preset: key });
  };
  const toggleMod = (k) => {
    const mods = sel.mods.includes(k) ? sel.mods.filter((x) => x !== k) : MOD_ORDER.filter((x) => x === k || sel.mods.includes(x));
    if (!mods.length) return;
    setSel({ preset: '', mods });
    save({ preset: mods.join(',') });
  };
  const url = linkOf(sel);
  const [m1, m2] = minsOf(sel.mods, d.mods);
  const modText = sel.mods.map((k) => MODNAME[k]).join(', ');
  const guide = [
    `[${info.academy_name}] 영어 레벨테스트 안내`,
    `아래 링크에서 영어 레벨테스트를 볼 수 있어요. (${modText}, 약 ${m1}~${m2}분)`,
    url,
    '휴대폰이나 컴퓨터로, 조용한 곳에서 학생 혼자 풀어 주세요. 결과는 선생님이 확인한 뒤 리포트로 보내 드려요.',
  ].join('\n');

  const S = d.sessions;
  const isScoring = (s) => s.status === 'scoring' || s.status === 'review';
  const counts = { all: S.length, new: S.filter((s) => s.finished_at && !s.seen).length, scoring: S.filter(isScoring).length, running: S.filter((s) => s.status === 'running').length };
  const shown = S.filter((s) => (filter === 'all' ? true : filter === 'new' ? s.finished_at && !s.seen : filter === 'scoring' ? isScoring(s) : s.status === filter));
  const segOpts = [['all', `전체 ${counts.all}`], ['new', `새 결과 ${counts.new}`], ['scoring', `채점 중 ${counts.scoring}`], ['running', `보는 중 ${counts.running}`]];

  return html`<div class="lt-admin">
    <div class="hub-h">
      <div style="min-width:0"><h1>레벨테스트</h1>
        <div class="sub">링크를 보내면 학생이 휴대폰이나 컴퓨터로 시험을 보고, 결과가 여기에 모여요.</div></div>
      <div class="actions"><${Btn} kind="ghost" size="sm" icon="book" onClick=${() => setBooks(true)}>교재 목록</${Btn}></div>
    </div>
    <section class="panel lt-link">
      <div class="panel-h"><h2>시험 링크</h2><span class="spacer"></span>
        <label class="lt-open"><span>${d.open ? '링크로 받는 중' : '받지 않는 중'}</span><input type="checkbox" class="lt-sw" checked=${d.open} onChange=${(e) => save({ open: e.target.checked }, e.target.checked ? '링크로 시험을 받아요' : '이제 링크로 시험을 시작할 수 없어요')} aria-label="링크로 시험 받기" /></label></div>
      <div class="panel-b">
        ${!d.open && html`<p class="lt-warn">지금은 링크를 열어도 시험을 시작할 수 없어요. 보던 학생은 끝까지 볼 수 있어요.</p>`}
        <div class="lt-pick"><span class="lb">볼 영역</span>
          <${Seg} value=${sel.preset || 'custom'} onChange=${pick} label="볼 영역" options=${[...d.presets.map((p) => [p.key, p.name]), ['custom', '직접 고르기']]} /></div>
        ${!sel.preset && html`<div class="lt-mods">${MOD_ORDER.map((k) => html`<button type="button" class=${`pick ${sel.mods.includes(k) ? 'on' : ''}`} aria-pressed=${sel.mods.includes(k)} onClick=${() => toggleMod(k)}>${MODNAME[k]}</button>`)}</div>`}
        <p class="lt-est">${modText}, 약 <b>${m1}~${m2}분</b>${sel.mods.includes('voc') ? '. 어휘를 먼저 보고 그 결과로 다른 영역의 첫 단계를 맞춰요' : ''}${sel.mods.includes('listen') ? '. 듣기는 소리가 나는 기기에서 봐야 해요' : ''}.</p>
        <div class="lt-url"><input class="input" readonly value=${url} onFocus=${(e) => e.target.select()} aria-label="시험 링크" />
          <${Btn} kind="primary" icon="copy" onClick=${() => copyText(url)}>링크 복사</${Btn}></div>
        <div class="lt-more">
          <${Btn} kind="ghost" size="sm" icon="messageSquare" onClick=${() => copyText(guide)}>안내 문구 복사</${Btn}>
          <a class="btn ghost sm" href=${url} target="_blank" rel="noopener"><${Icon} name="external" size="sm" />학생 화면 열어 보기</a>
        </div>
        <p class="lt-note">재원생이 강의실 앱에 로그인한 채로 열면 이름과 학년이 채워지고, 결과가 학생 계정에 이어져요. 학생 계정과 잇지 않은 결과는 6개월 뒤 저절로 지워져요.</p>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><h2>결과</h2><span class="spacer"></span><${Seg} value=${filter} onChange=${setFilter} label="결과 고르기" options=${segOpts} /></div>
      ${shown.length ? html`<ul class="rows">${shown.map((s) => html`<${LtRow} s=${s} />`)}</ul>`
        : html`<${Empty} icon="clipboard" title=${S.length ? '고른 결과가 없어요' : '아직 본 학생이 없어요'}>${S.length ? '다른 묶음을 골라 보세요.' : '위 링크를 학부모님께 보내면 결과가 여기에 모여요.'}</${Empty}>`}
    </section>
    ${books && html`<${BooksModal} d=${d} onClose=${() => setBooks(false)} onDone=${() => { setBooks(false); load(); }} />`}
  </div>`;
}

function LtRow({ s }) {
  const sm = s.summary;
  const fresh = s.finished_at && !s.seen;
  let line;
  if (s.status === 'running') line = html`<span class="faint">${s.mods.length}개 영역 중 ${Math.min(s.progress + 1, s.mods.length)}번째 보는 중, ${ago(s.updated_at)}</span>`;
  else if (sm && sm.overall) {
    line = html`<span>종합 <b class="lv">${lvShort(sm.overall.level)}</b></span><span class="faint">${s.mods.map((k) => `${MODNAME[k]} ${lvShort(sm.mods ? sm.mods[k] : null)}`).join(', ')}</span>`;
  } else line = html`<span class="faint">${s.mods.map((k) => MODNAME[k]).join(', ')}</span>`;
  return html`<li class="click lt-row" onClick=${() => go(`/classes/lt/${s.id}`)}>
    <div class="lt-r1">${fresh && html`<span class="lt-new" title="아직 안 본 결과"></span>`}<b>${s.name}</b><span class="chip grade">${s.grade_short}</span>
      ${s.user_id ? html`<span class="chip ivy" title=${s.user_name ? `학생 계정: ${s.user_name}` : ''}>재원생</span>` : html`<span class="chip">처음 온 학생</span>`}
      <span class="spacer"></span><${StChip} status=${s.status} /></div>
    <div class="lt-r2">${line}<span class="spacer"></span><span class="faint when">${fmtDate(s.finished_at || s.created_at, true)}</span></div>
  </li>`;
}

// ================================================================ 교재 목록 (결과에 맞는 교재를 고를 때 써요)
function BooksModal({ d, onClose, onDone }) {
  const [rows, setRows] = useState(() => d.books.map((b) => ({ ...b })));
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: k === 'from' || k === 'to' ? Number(v) : v } : r)));
  const save = async (books) => {
    setBusy(true);
    try {
      await api('/api/admin/lt', { method: 'PUT', body: { books } });
      toast(books ? '교재 목록을 저장했어요' : '예시 교재로 되돌렸어요');
      onDone();
    } catch (e) {
      toastErr(e);
      setBusy(false);
    }
  };
  const reset = async () => {
    if (await confirmBox({ title: '예시 교재로 되돌릴까요?', body: '지금 목록은 지워지고 처음에 들어 있던 예시 교재로 바뀌어요.', ok: '되돌리기' })) save(null);
  };
  return html`<${Modal} wide title="교재 목록" onClose=${onClose} footer=${html`
      ${!d.books_default && html`<button class="btn ghost" onClick=${reset} disabled=${busy}>예시로 되돌리기</button>`}<span class="spacer"></span>
      <button class="btn secondary" onClick=${onClose}>취소</button>
      <${Btn} kind="primary" busy=${busy} onClick=${() => save(rows.filter((r) => r.name.trim()))}>저장</${Btn}>`}>
    <p class="lt-note" style="margin-top:0">영역마다 맞는 단계를 정해 두면, 결과가 나올 때 레벨이 그 안에 드는 교재를 골라 리포트에 넣어요. 범위가 겹치면 가운데에 가까운 교재, 맞는 교재가 없으면 가장 가까운 교재를 골라요.${d.books_default ? ' 지금은 예시 교재가 들어 있어요. 학원 교재로 바꿔 주세요.' : ''}</p>
    <div class="table-wrap"><table class="t lt-books">
      <thead><tr><th>영역</th><th>교재 이름</th><th>맞는 단계</th><th>메모</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => html`<tr>
        <td><select class="input" value=${r.skill} onChange=${(e) => set(i, 'skill', e.target.value)} aria-label="영역">${MOD_ORDER.map((k) => html`<option value=${k}>${MODNAME[k]}</option>`)}</select></td>
        <td><input class="input" value=${r.name} maxlength="60" onInput=${(e) => set(i, 'name', e.target.value)} aria-label="교재 이름" /></td>
        <td class="rng"><select class="input" value=${r.from} onChange=${(e) => set(i, 'from', e.target.value)} aria-label="시작 단계">${d.grades.map((g) => html`<option value=${g.lv}>${g.short}</option>`)}</select><span>~</span>
          <select class="input" value=${r.to} onChange=${(e) => set(i, 'to', e.target.value)} aria-label="끝 단계">${d.grades.map((g) => html`<option value=${g.lv}>${g.short}</option>`)}</select></td>
        <td><input class="input" value=${r.note || ''} maxlength="60" onInput=${(e) => set(i, 'note', e.target.value)} aria-label="메모" /></td>
        <td><button class="btn ghost icon sm" onClick=${() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label=${`${r.name || '교재'} 지우기`}><${Icon} name="trash" size="sm" /></button></td>
      </tr>`)}</tbody></table></div>
    <${Btn} kind="soft" size="sm" icon="plus" onClick=${() => setRows((rs) => [...rs, { skill: 'read', name: '', from: 7, to: 9, note: '' }])}>교재 더하기</${Btn}>
  </${Modal}>`;
}

// ================================================================ 한 학생 결과
export function LtDetail({ id, info }) {
  useCss();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(null);
  const load = () =>
    api(`/api/admin/lt/${id}`)
      .then((r) => {
        setD(r);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    // 결과를 열면 '새 결과'에서 빠지니까 위쪽 메뉴 숫자도 새로 고쳐요
    load().then(() => emit('ivy:changed'));
  }, [id]);
  // 처음 연 탭을 기억해요 (점수를 고쳐도 다른 탭으로 넘어가지 않게). 라이팅을 채점해야 하면 라이팅부터
  useEffect(() => {
    if (!d || !d.done || tab) return;
    const keys = d.detail.mods.map((m) => m.key);
    setTab(keys.includes('write') && d.scoring && d.scoring.need ? 'write' : keys[0]);
  }, [d]);
  // 보는 중이거나 라이팅을 채점하는 중이면 저절로 새로 고쳐요
  useEffect(() => {
    if (!d || d.session.status === 'done') return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [d && d.session.status]);
  if (err && !d) {
    return html`<div class="panel"><${Empty} icon="clipboard" title=${err.status === 404 ? '결과를 찾을 수 없어요' : '불러오지 못했어요'} action=${html`<${Btn} onClick=${() => go('/classes/lt')}>레벨테스트로</${Btn}>`}>${err.message}</${Empty}></div>`;
  }
  if (!d) return html`<div><${Skel} h=${34} w="40%" mb=${20} /><${Skel} h=${180} /><${Skel} h=${300} /></div>`;
  const s = d.session;
  const put = async (body, msg) => {
    try {
      const r = await api(`/api/admin/lt/${id}`, { method: 'PUT', body });
      setD(r);
      if (msg) toast(msg);
      emit('ivy:changed');
      return true;
    } catch (e) {
      toastErr(e);
      return false;
    }
  };
  const del = async () => {
    if (!(await confirmBox({ title: `${s.name} 학생의 결과를 지울까요?`, body: '시험 답과 결과가 모두 지워지고 되돌릴 수 없어요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/admin/lt/${id}`, { method: 'DELETE' });
      toast('결과를 지웠어요');
      emit('ivy:changed');
      go('/classes/lt');
    } catch (e) {
      toastErr(e);
    }
  };
  const meta = [s.school, s.phone ? `학부모님 ${s.phone}` : '', `시작 ${fmtDate(s.created_at, true)}`].filter(Boolean).join(', ');
  const head = html`<div class="hub-h">
    <div style="min-width:0"><a class="lt-back" href="#/classes/lt"><${Icon} name="chevronLeft" size="sm" />레벨테스트</a>
      <h1>${s.name}<span class="chip grade">${s.grade_short}</span>${s.user_id ? html`<span class="chip ivy">재원생</span>` : html`<span class="chip">처음 온 학생</span>`}<${StChip} status=${s.status} /></h1>
      <div class="sub">${meta}</div></div>
    <div class="actions"><${Btn} kind="ghost" size="sm" icon="trash" onClick=${del}>지우기</${Btn}></div>
  </div>`;
  if (!d.done) {
    return html`<div class="lt-admin">${head}
      <section class="panel"><${Empty} icon="hourglass" title="아직 시험을 보는 중이에요">${s.mods.length}개 영역 중 ${Math.min(s.progress + 1, s.mods.length)}번째(${MODNAME[s.mods[Math.min(s.progress, s.mods.length - 1)]]})를 보고 있어요. 마지막 답은 ${ago(s.updated_at)}에 왔어요. 끝내지 않은 시험은 일주일 뒤 지워져요.</${Empty}></section>
    </div>`;
  }
  const x = d.detail;
  const order = x.mods.map((m) => m.key);
  const cur = tab && order.includes(tab) ? tab : order.includes('write') && d.scoring && d.scoring.need ? 'write' : order[0];
  return html`<div class="lt-admin">${head}
    <div class="lt-grid">
      <div class="lt-main">
        <section class="lt-hero">
          <div class="rp-hero">
            <div class="rp-lv"><small>종합 레벨</small><strong>${x.overall.short}</strong></div>
            <div class="rp-hero-t"><p class="rp-hl">${x.overall.name}</p><p class="rp-cmp">${x.overall.cmp}</p>
              <p class="rp-cefr">CEFR <b>${x.overall.cefr}</b>${x.overall.value != null ? html`<span class="faint">, 영역 가중 평균 ${x.overall.value}단계</span>` : ''}</p></div>
          </div>
          <div class="lt-idx"><${Html} h=${x.idx} /><p class="rp-idx-note">렉사일과 AR은 공식 점수가 아니라 책 고를 때 쓰는 참고 범위예요.</p></div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>영역별 레벨</h2></div>
          <div class="panel-b">
            <${Html} cls="lt-ladder" h=${x.ladder} />
            <ul class="rp-mods">${x.mods.map((m) => html`<li><b>${m.name}</b><span class="lv">${m.short}</span><span class="cf">${m.cefr}</span><span class="tx">${m.line}</span></li>`)}</ul>
            <p class="lt-note">푼 문항 ${x.time.n}개, 시간 초과 ${x.time.over}개${x.time.avg != null ? `, 평균으로 제한 시간의 ${x.time.avg}%를 썼어요` : ''}.${s.skipped.length ? ` ${s.skipped.map((k) => MODNAME[k]).join(', ')}는 소리가 나지 않아 건너뛰었어요.` : ''}</p>
          </div>
        </section>
        <section class="panel">
          <div class="panel-b lt-tabsbox">
            <div class="tabs" role="tablist">${x.mods.map((m) => html`<button role="tab" aria-selected=${cur === m.key} class=${cur === m.key ? 'on' : ''} onClick=${() => setTab(m.key)}>${m.name}<span class="n">${m.short}</span></button>`)}</div>
            ${cur === 'write' ? html`<${WritePanel} w=${x.write} scoring=${d.scoring} put=${put} rescore=${async () => {
              try {
                setD(await api(`/api/admin/lt/${id}/rescore`, { method: 'POST', body: {} }));
                toast('라이팅을 다시 채점해요');
              } catch (e) {
                toastErr(e);
              }
            }} />` : html`<${Html} cls="lt-panel" h=${x.panels[cur]} />`}
          </div>
        </section>
      </div>
      <aside class="lt-side">
        <${SendPanel} d=${d} id=${id} put=${put} />
        <${LinkPanel} s=${s} put=${put} />
      </aside>
    </div>
  </div>`;
}

// 어머니께 보내기: 교재 고르기, 선생님 의견, 리포트 PDF, 카톡 문구
function SendPanel({ d, id, put }) {
  const s = d.session;
  const [text, setText] = useState(s.comment || d.auto_comment);
  const [busy, setBusy] = useState(false);
  const last = useRef(s.comment || d.auto_comment);
  useEffect(() => {
    const v = s.comment || d.auto_comment;
    if (v !== last.current) {
      last.current = v;
      setText(v);
    }
  }, [s.comment, d.auto_comment]);
  const custom = !!s.comment;
  const dirty = text.trim() !== (s.comment || d.auto_comment).trim();
  const saveComment = async (v) => {
    setBusy(true);
    await put({ comment: v }, v ? '의견을 저장했어요' : '자동으로 쓴 의견으로 되돌렸어요');
    setBusy(false);
  };
  const order = d.detail.mods.filter((m) => m.level != null).map((m) => m.key);
  return html`<section class="panel lt-send">
    <div class="panel-h"><h2>어머니께 보내기</h2></div>
    <div class="panel-b">
      ${s.phone ? html`<p class="lt-to">받는 분 <b>${s.name} 학부모님</b> <a href=${`tel:${s.phone.replace(/[^0-9]/g, '')}`}>${s.phone}</a></p>` : html`<p class="lt-to faint">학부모님 번호를 적지 않았어요.</p>`}
      ${d.scoring && d.scoring.need && html`<p class="lt-warn">라이팅 채점이 끝난 뒤 리포트를 만들면 라이팅 결과도 들어가요.</p>`}
      <div class="lt-books-pick">${order.map((k) => {
        const list = d.books.filter((b) => b.skill === k);
        const chosen = d.book_choice[k] || '';
        return html`<${Field} label=${`${MODNAME[k]} 교재`}><select class="input" value=${chosen} onChange=${(e) => put({ book: { skill: k, name: e.target.value } }, '교재를 바꿨어요')}>
          <option value="">${d.detail.books[k] && !chosen ? `자동: ${d.detail.books[k]}` : '레벨에 맞게 자동으로'}</option>
          ${list.map((b) => html`<option value=${b.name}>${b.name} (${SHORT[b.from]}~${SHORT[b.to]})</option>`)}</select></${Field}>`;
      })}</div>
      <${Field} label="선생님 의견" hint=${custom ? '직접 고친 의견이에요.' : '결과를 보고 자동으로 쓴 초안이에요. 고쳐서 저장하면 리포트에 들어가요.'}>
        <textarea class="input" rows="7" value=${text} onInput=${(e) => setText(e.target.value)} maxlength="2000"></textarea></${Field}>
      <div class="lt-row-btns">
        <${Btn} size="sm" busy=${busy} disabled=${!dirty} onClick=${() => saveComment(text.trim())}>의견 저장</${Btn}>
        ${custom && html`<button class="btn link sm" onClick=${() => saveComment('')}>자동 의견으로 되돌리기</button>`}
      </div>
      <${Btn} kind="primary" block icon="printer" onClick=${() => window.open(`/lt-report#${id}`, '_blank', 'noopener')}>리포트 PDF 만들기</${Btn}>
      <p class="lt-note">새 창에서 A4 세 장짜리 리포트가 열려요. 'PDF로 저장'을 눌러 저장한 뒤 카카오톡으로 보내 주세요.</p>
      <div class="lt-msg-h"><b>카톡 문구</b><${Btn} kind="ghost" size="sm" icon="copy" onClick=${() => copyText(d.msg)}>복사</${Btn}></div>
      <pre class="lt-msg">${d.msg}</pre>
    </div>
  </section>`;
}

// 학생 계정과 잇기: 이으면 6개월이 지나도 남고, 다음 시험은 지난 결과 근처에서 시작해요
function LinkPanel({ s, put }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState('');
  useEffect(() => {
    if (s.user_id || list) return;
    api('/api/admin/students')
      .then((r) => setList(r.students))
      .catch(() => setList([]));
  }, [s.user_id]);
  return html`<section class="panel">
    <div class="panel-h"><h2>학생 계정</h2></div>
    <div class="panel-b">
      ${s.user_id ? html`<p class="lt-to"><b>${s.user_name || '학생'}</b> 계정과 이어져 있어요.</p>
          <button class="btn link sm" onClick=${() => put({ user_id: 0 }, '계정과 잇기를 풀었어요')}>잇기 풀기</button>`
        : html`<p class="lt-note" style="margin-top:0">학원에 등록한 학생이면 계정과 이어 주세요. 이은 결과는 6개월이 지나도 지워지지 않고, 다음 레벨테스트를 이번 결과 근처에서 시작해요.</p>
          <div class="lt-link-row">
            <select class="input" value=${pick} onChange=${(e) => setPick(e.target.value)} aria-label="이을 학생">
              <option value="">${list ? (list.length ? '학생 고르기' : '학생이 없어요') : '학생 목록을 불러오는 중'}</option>
              ${(list || []).map((x) => html`<option value=${x.id}>${x.name}${x.class_name ? ` (${x.class_name})` : ''}</option>`)}</select>
            <${Btn} size="sm" disabled=${!pick} onClick=${() => put({ user_id: Number(pick) }, '학생 계정과 이었어요')}>잇기</${Btn}>
          </div>`}
    </div>
  </section>`;
}

// 라이팅: 자동 채점 문항, 조건 영작(0~2점), 짧은 글(기준마다 1~5점). AI 점수를 선생님이 고칠 수 있어요
function WritePanel({ w, scoring, put, rescore }) {
  const [sum, setSum] = useState((w.essay && w.essay.summary) || '');
  useEffect(() => setSum((w.essay && w.essay.summary) || ''), [w.essay && w.essay.summary]);
  const by = { ai: 'AI 채점', teacher: '선생님 채점', 'ai+teacher': 'AI 채점, 선생님 고침' }[w.by] || '';
  const task = scoring && scoring.task;
  const need = scoring && scoring.need;
  const setPts = (id, p) => put({ scoring: { items: [{ id, points: p }] } });
  const setRub = (k, v) => put({ scoring: { essay: { [k]: v } } });
  let box = null;
  if (w.tier !== 'A') {
    if (need && task && task.status === 'failed') box = html`<div class="lt-ai bad"><span>AI 채점이 끝나지 못했어요. ${task.error}</span><${Btn} size="sm" icon="refresh" onClick=${rescore}>다시 채점</${Btn}></div>`;
    else if (need) box = html`<div class="lt-ai"><span>${task && task.status === 'running' ? '학원 PC 제작 엔진에서 Claude가 채점하고 있어요.' : '학원 PC 제작 엔진이 켜지면 Claude가 채점해요. 기다리지 않고 아래에서 직접 점수를 골라도 돼요.'}</span></div>`;
    else box = html`<div class="lt-ai"><span>${by ? html`<b>${by}</b>${w.model ? ` (${w.model})` : ''}. ` : ''}점수를 누르면 바로 바뀌고, 리포트에도 들어가요.</span><${Btn} kind="ghost" size="sm" icon="refresh" onClick=${rescore}>AI로 다시 채점</${Btn}></div>`;
  }
  return html`<div class="lt-write">
    <p class="lt-wh">과제 단계 <b>${w.tier}, ${w.tier_name}</b>, 라이팅 레벨 <b>${w.level_short || '채점 전'}</b></p>
    ${box}
    ${w.rows.map((r) => {
      if (r.auto) {
        return html`<div class="wi"><div class="h"><b>${r.kind === 'spell' ? '낱말 맞추기' : '문장 맞추기'}</b><span class=${r.ok ? 'ok' : 'no'}>${r.ok ? '○ 맞음' : '× 틀림'}</span><span class="faint">자동 채점</span></div>
          ${r.ko && html`<div class="faint">${r.ko}</div>`}<div class="ans" lang="en">${r.ans || '(빈칸)'}</div>${!r.ok && html`<div class="model">정답: ${r.answer}</div>`}</div>`;
      }
      if (r.kind === 'cond') {
        return html`<div class="wi"><div class="h"><b>조건 영작</b><span class="faint">${r.ko}</span></div>
          <div class="ans" lang="en">${r.ans || '(빈칸)'}</div>
          <div class="chk">${r.need.map((n) => html`<span class=${n.ok ? 'ok' : 'no'}>${n.ok ? '✓' : '✗'} ${n.w}</span>`)}<span>${r.words}단어</span><span>조건: ${r.cond.join(', ')}</span></div>
          <div class="model">모범 답: <span lang="en">${r.model}</span></div>
          ${(r.note || (r.corrected && r.corrected !== r.model)) && html`<div class="model">${r.corrected && r.corrected !== r.model ? html`고친 문장: <span lang="en">${r.corrected}</span>. ` : ''}${r.note}</div>`}
          <div class="wrow"><span class="faint">점수</span><${Seg} value=${r.points == null ? '' : String(r.points)} onChange=${(v) => setPts(r.id, Number(v))} label="조건 영작 점수" options=${[['0', '0점'], ['1', '1점'], ['2', '2점']]} />
            <span class="faint small">2점은 조건과 문법이 모두 맞을 때, 1점은 작은 오류, 0점은 뜻이나 조건이 틀렸을 때</span></div></div>`;
      }
      const e = w.essay || {};
      return html`<div class="wi"><div class="h"><b>짧은 글</b><span class="faint">${r.words}단어${r.range ? `, 권장 ${r.range[0]}~${r.range[1]}단어` : ''}</span></div>
        <div class="faint">${r.q}</div>
        <div class="ans" lang="en">${r.ans || '(빈칸)'}</div>
        <div class="rubgrid">${w.rubric.map((k) => html`<label>${k.name}<select class="input" value=${e[k.key] ? String(e[k.key]) : ''} onChange=${(ev) => setRub(k.key, ev.target.value ? Number(ev.target.value) : null)}>
          <option value="">고르기</option>${[5, 4, 3, 2, 1].map((n) => html`<option value=${String(n)}>${n}점${n === 5 ? `, ${k.d5}` : n === 3 ? `, ${k.d3}` : n === 1 ? `, ${k.d1}` : ''}</option>`)}</select></label>`)}</div>
        ${e.errors && e.errors.length ? html`<ul class="rp-fix">${e.errors.map((z) => html`<li><s>${z.wrong}</s> → <b>${z.right}</b> <small>${z.why}</small></li>`)}</ul>` : null}
        <${Field} label="학부모님께 보일 한 줄 평"><textarea class="input" rows="3" maxlength="400" value=${sum} onInput=${(ev) => setSum(ev.target.value)} onBlur=${() => sum !== ((w.essay && w.essay.summary) || '') && put({ scoring: { essay: { summary: sum } } }, '한 줄 평을 저장했어요')}></textarea></${Field}></div>`;
    })}
  </div>`;
}
