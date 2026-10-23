import { html, render, useState, useEffect, api, Icon, Btn, Field, Toasts, ConfirmHost, toastErr, ChalkLine, hasHangul, hanToEng, useCapsLock, KeyWarn, RecoveryCard } from './ui.js';
import { TeacherApp } from './teacher.js';
import { StudentApp } from './student.js';

function Mark({ info, cls = 'auth-logo' }) {
  return html`<div class=${cls}>${info && info.logo_url ? html`<img src=${info.logo_url} alt="" />` : html`<${Icon} name="penLine" size="lg" />`}</div>`;
}

// 칠판 위에 분필로 쓴 앱 이름 + 흰 카드
function AuthShell({ info, children }) {
  return html`<div class="auth chalkboard">
    <div class="auth-word">${(info && info.app_name) || '온라인 강의실'}<${ChalkLine} /></div>
    ${children}
    ${info && info.academy_name && html`<div class="auth-foot">${info.academy_name}</div>`}
  </div>`;
}

function Login({ info, onDone }) {
  const [mode, setMode] = useState('login');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [caps, onKey] = useCapsLock();
  if (mode === 'forgot') return html`<${Forgot} info=${info} onBack=${() => setMode('login')} onDone=${onDone} />`;
  // 아이디는 영문·숫자만 있어서, 한글이 섞이면 한/영 키 실수로 보고 영문으로 바꿔요
  const idEng = hasHangul(id) ? hanToEng(id.trim()) : '';
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const login_id = idEng || id.trim();
    if (idEng) setId(idEng);
    try {
      try {
        await api('/api/login', { method: 'POST', body: { login_id, password: pw } });
      } catch (er) {
        // 비밀번호도 한글 상태로 쳤으면 영문으로 바꿔 한 번 더 해 봐요
        if (er.status !== 401 || !hasHangul(pw)) throw er;
        await api('/api/login', { method: 'POST', body: { login_id, password: hanToEng(pw) } });
      }
      onDone();
    } catch (er) {
      setErr(er.message);
    }
    setBusy(false);
  };
  return html`<${AuthShell} info=${info}><form class="auth-card" onSubmit=${submit}>
    <${Mark} info=${info} />
    <h1>로그인</h1>
    <div class="sub">${info.academy_name} 강의실에 오신 걸 환영해요.</div>
    <div class="stack">
      <${Field} label="아이디"><input value=${id} onInput=${(e) => setId(e.target.value)} autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="학원에서 받은 아이디" required />
        ${idEng && html`<div class="key-warn" role="status"><${Icon} name="alert" size="sm" />한글로 입력됐어요. ‘${idEng}’(으)로 바꿔서 로그인할게요.</div>`}</${Field}>
      <${Field} label="비밀번호" error=${err}><input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} onKeyDown=${onKey} onKeyUp=${onKey} autocomplete="current-password" placeholder="비밀번호" required />
        <${KeyWarn} value=${pw} caps=${caps} /></${Field}>
      <${Btn} kind="primary" size="lg" block busy=${busy} type="submit">로그인</${Btn}>
    </div>
    <div class="auth-alt"><button type="button" class="btn link" onClick=${() => setMode('forgot')}>아이디나 비밀번호를 잊었어요</button></div>
  </form></${AuthShell}>`;
}

// 아이디나 비밀번호를 잊었을 때: 학생은 선생님께, 선생님은 복구 코드로 새 비밀번호를 정해요
const fmtCode = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1-');

function Forgot({ info, onBack, onDone }) {
  const [step, setStep] = useState('code');
  const [lost, setLost] = useState(false);
  const [code, setCode] = useState('');
  const [admins, setAdmins] = useState([]);
  const [uid, setUid] = useState(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [res, setRes] = useState(null);
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [caps, onKey] = useCapsLock();
  const check = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/recover/check', { method: 'POST', body: { code } });
      setAdmins(r.admins);
      setUid(r.admins[0].id);
      setStep('reset');
    } catch (er) {
      if (er.code === 'no_admin') return onDone();
      setErr(er.message);
    }
    setBusy(false);
  };
  const reset = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setErr('비밀번호 두 개가 서로 달라요.');
    setBusy(true);
    setErr('');
    try {
      setRes(await api('/api/recover/reset', { method: 'POST', body: { code, user_id: uid, password: pw } }));
      setStep('done');
    } catch (er) {
      setErr(er.message);
    }
    setBusy(false);
  };
  const who = admins.find((a) => a.id === uid) || admins[0];

  if (step === 'done') {
    return html`<${AuthShell} info=${info}><div class="auth-card">
      <div class="auth-logo ok"><${Icon} name="checkCircle" size="lg" /></div>
      <h1>새 비밀번호로 바꿨어요</h1>
      <div class="sub">다른 기기에 로그인돼 있던 것은 모두 로그아웃했어요.</div>
      <div class="id-show"><span>아이디</span><b>${res.login_id}</b></div>
      ${res.recovery_code
        ? html`<div class="stack sm" style="margin-top:18px"><div class="label">새 복구 코드</div>
            <div class="faint" style="font-size:13px">${res.replaced ? '예전 복구 코드는 이제 못 써요. ' : ''}다음에 또 잊으면 이 코드로 되찾아요. 이 화면은 지금 한 번만 나와요.</div>
            <${RecoveryCard} code=${res.recovery_code} loginId=${res.login_id} academy=${info.academy_name} />
            <label class="ack"><input type="checkbox" checked=${kept} onChange=${(e) => setKept(e.target.checked)} />사진을 찍거나 종이에 적어 두었어요</label></div>`
        : html`<div class="faint" style="font-size:13px;margin-top:14px">복구 코드는 그대로 쓸 수 있어요.</div>`}
      <${Btn} kind="primary" size="lg" block cls="mt" disabled=${!!res.recovery_code && !kept} onClick=${onDone}>강의실로 가기</${Btn}>
    </div></${AuthShell}>`;
  }

  if (step === 'reset') {
    return html`<${AuthShell} info=${info}><form class="auth-card" onSubmit=${reset}>
      <h1>새 비밀번호 정하기</h1>
      <div class="sub">${lost ? 'Cloudflare 비상 코드를' : '복구 코드를'} 확인했어요.</div>
      ${admins.length > 1
        ? html`<div class="stack sm" style="margin-bottom:14px"><div class="label">어느 계정인가요?</div>${admins.map((a) => html`<label class="ack"><input type="radio" name="who" checked=${uid === a.id} onChange=${() => setUid(a.id)} />${a.name} <span class="faint">${a.login_id}</span></label>`)}</div>`
        : html`<div class="id-show"><span>아이디</span><b>${who.login_id}</b></div>`}
      <input class="sr" type="text" name="username" autocomplete="username" value=${who.login_id} readonly tabindex="-1" aria-hidden="true" />
      <div class="stack" style="margin-top:16px">
        <${Field} label="새 비밀번호" hint="8자 이상"><input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} onKeyDown=${onKey} onKeyUp=${onKey} autocomplete="new-password" required minlength="8" />
          <${KeyWarn} value=${pw} caps=${caps} /></${Field}>
        <${Field} label="새 비밀번호 확인" error=${err}><input type="password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} autocomplete="new-password" required /></${Field}>
        <${Btn} kind="primary" size="lg" block busy=${busy} type="submit">새 비밀번호로 바꾸기</${Btn}>
      </div>
      <div class="auth-alt"><button type="button" class="btn link" onClick=${onBack}>로그인으로 돌아가기</button></div>
    </form></${AuthShell}>`;
  }

  return html`<${AuthShell} info=${info}><form class="auth-card" onSubmit=${check}>
    <h1>계정 되찾기</h1>
    <div class="notice" style="margin:4px 0 18px"><${Icon} name="user" /><div><b>학생</b>은 선생님께 말씀해 주세요. 선생님이 새 비밀번호를 바로 만들어 드려요.</div></div>
    <div class="sub" style="margin-bottom:14px"><b style="color:var(--ink)">선생님</b>은 ${lost ? 'Cloudflare 비상 코드' : '복구 코드'}를 넣으면 아이디를 확인하고 새 비밀번호를 정할 수 있어요.</div>
    <div class="stack">
      ${lost
        ? html`<${Field} label="Cloudflare 비상 코드" hint="Cloudflare 에 SETUP_CODE 로 넣은 값" error=${err}><input key="m" value=${code} onInput=${(e) => setCode(e.target.value)} autocapitalize="off" autocomplete="off" spellcheck="false" required /></${Field}>`
        : html`<${Field} label="복구 코드" hint="처음 설정할 때 받은 숫자 16자리" error=${err}><input key="c" class="num" value=${code} onInput=${(e) => setCode(fmtCode(e.target.value))} inputmode="numeric" autocomplete="off" placeholder="0000-0000-0000-0000" required /></${Field}>`}
      <${Btn} kind="primary" size="lg" block busy=${busy} type="submit">확인</${Btn}>
    </div>
    ${lost
      ? html`<div class="notice amber" style="margin-top:16px"><${Icon} name="shield" /><div><b>Cloudflare 비상 코드 만들기</b>
          <ol class="how sm"><li>컴퓨터에서 dash.cloudflare.com 에 로그인해요.</li><li><b>Workers & Pages</b> → <b>ivyclass</b> → <b>Settings</b> → <b>Variables and Secrets</b> 에서 <b>Add</b>를 눌러요.</li>
            <li>Type은 <b>Secret</b>, 이름은 <b>SETUP_CODE</b>, 값은 8자 이상으로 정하고 <b>Deploy</b>를 눌러요.</li><li>1분쯤 뒤 그 값을 위 칸에 넣어요.</li></ol>
          <div class="faint" style="font-size:12.5px">이미 넣어 둔 값이 있으면 그 값을 넣으면 돼요.</div></div></div>`
      : null}
    <div class="auth-alt">
      ${lost
        ? html`<button type="button" class="btn link" onClick=${() => { setLost(false); setCode(''); setErr(''); }}>복구 코드로 할게요</button>`
        : html`<button type="button" class="btn link" onClick=${() => { setLost(true); setCode(''); setErr(''); }}>복구 코드도 잃어버렸어요</button>`}
      <button type="button" class="btn link" onClick=${onBack}>로그인으로 돌아가기</button>
    </div>
  </form></${AuthShell}>`;
}

function Setup({ info, onDone }) {
  const [f, setF] = useState({ setup_code: '', academy_name: '', name: '', login_id: '', password: '', password2: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState(null);
  const [kept, setKept] = useState(false);
  const [caps, onKey] = useCapsLock();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.password2) return setErr('비밀번호 두 개가 서로 달라요.');
    setBusy(true);
    setErr('');
    const body = hasHangul(f.login_id) ? { ...f, login_id: hanToEng(f.login_id) } : f;
    if (body !== f) setF(body);
    try {
      const r = await api('/api/setup', { method: 'POST', body });
      if (!r.recovery_code) return onDone();
      setMade(r);
    } catch (er) {
      setErr(er.message);
    }
    setBusy(false);
  };
  if (made) {
    const academy = f.academy_name.trim() || info.academy_name;
    return html`<${AuthShell} info=${{ ...info, app_name: `${academy} 강의실`, academy_name: academy }}><div class="auth-card">
      <h1>복구 코드를 보관해 주세요</h1>
      <div class="sub">비밀번호를 잊어도 이 코드로 아이디를 확인하고 새 비밀번호를 정할 수 있어요. 이 화면은 지금 한 번만 나와요.</div>
      <${RecoveryCard} code=${made.recovery_code} loginId=${made.login_id} academy=${academy} />
      <div class="faint" style="font-size:13px;margin-top:12px">휴대폰으로 사진을 찍거나 종이에 적어 집에 두세요. 학생이 볼 수 있는 곳은 피해 주세요.</div>
      <label class="ack" style="margin-top:14px"><input type="checkbox" checked=${kept} onChange=${(e) => setKept(e.target.checked)} />사진을 찍거나 종이에 적어 두었어요</label>
      <${Btn} kind="primary" size="lg" block cls="mt" disabled=${!kept} onClick=${onDone}>강의실 시작하기</${Btn}>
    </div></${AuthShell}>`;
  }
  return html`<${AuthShell} info=${info}><form class="auth-card" onSubmit=${submit}>
    <h1>처음 설정</h1>
    <div class="sub">학원 이름과 선생님(관리자) 계정을 정해요. 이 화면은 처음 한 번만 나와요.</div>
    <div class="stack">
      ${info.needs_code && html`<${Field} label="처음 설정 코드" hint="Cloudflare 에 SETUP_CODE 로 넣은 값이에요"><input value=${f.setup_code} onInput=${set('setup_code')} autocapitalize="off" spellcheck="false" required /></${Field}>`}
      <${Field} label="학원 이름"><input value=${f.academy_name} onInput=${set('academy_name')} placeholder="예: 한빛영어학원" required /></${Field}>
      <${Field} label="선생님 이름"><input value=${f.name} onInput=${set('name')} placeholder="예: 김민준 선생님" required /></${Field}>
      <${Field} label="아이디" hint="영문, 숫자 3자 이상"><input value=${f.login_id} onInput=${set('login_id')} onBlur=${() => hasHangul(f.login_id) && setF({ ...f, login_id: hanToEng(f.login_id) })} autocomplete="username" autocapitalize="off" spellcheck="false" required />
        ${hasHangul(f.login_id) && html`<div class="key-warn" role="status"><${Icon} name="alert" size="sm" />한글로 입력됐어요. ‘${hanToEng(f.login_id)}’(으)로 바꿀게요.</div>`}</${Field}>
      <${Field} label="비밀번호" hint="8자 이상"><input type="password" value=${f.password} onInput=${set('password')} onKeyDown=${onKey} onKeyUp=${onKey} autocomplete="new-password" required />
        <${KeyWarn} value=${f.password} caps=${caps} /></${Field}>
      <${Field} label="비밀번호 확인" error=${err}><input type="password" value=${f.password2} onInput=${set('password2')} autocomplete="new-password" required /></${Field}>
      <${Btn} kind="primary" size="lg" block busy=${busy} type="submit">계정 만들기</${Btn}>
    </div>
  </form></${AuthShell}>`;
}

function Root() {
  const [info, setInfo] = useState(null);
  const [me, setMe] = useState(undefined);
  const [err, setErr] = useState(null);
  const load = async () => {
    try {
      const [i, m] = await Promise.all([api('/api/public/info'), api('/api/me')]);
      setInfo(i);
      setMe(m.user);
      document.title = i.app_name;
      setErr(null);
    } catch (e) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
    const out = () => setMe(null);
    window.addEventListener('ivy:logout', out);
    return () => window.removeEventListener('ivy:logout', out);
  }, []);
  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      toastErr(e);
    }
    location.hash = '#/';
    setMe(null);
  };
  let body;
  if (err) {
    body = html`<${AuthShell} info=${info}><div class="auth-card"><h1>연결할 수 없어요</h1>
      <div class="sub">${err.message}</div><${Btn} kind="primary" block onClick=${load}>다시 시도</${Btn}></div></${AuthShell}>`;
  } else if (!info || me === undefined) {
    body = html`<div class="auth chalkboard"><div class="boot-msg">불러오는 중…</div></div>`;
  } else if (!info.has_admin) {
    body = html`<${Setup} info=${info} onDone=${load} />`;
  } else if (!me) {
    body = html`<${Login} info=${info} onDone=${load} />`;
  } else if (me.role === 'admin') {
    body = html`<${TeacherApp} info=${info} me=${me} onLogout=${logout} onInfo=${load} />`;
  } else {
    body = html`<${StudentApp} info=${info} me=${me} onLogout=${logout} />`;
  }
  return html`${body}<${Toasts} /><${ConfirmHost} />`;
}

render(html`<${Root} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
