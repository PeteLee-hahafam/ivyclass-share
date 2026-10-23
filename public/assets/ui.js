import { html, render, useState, useEffect, useRef, useCallback } from './vendor/standalone.mjs';
import { ICONS } from './icons.js';

export { html, render, useState, useEffect, useRef, useCallback };

// ------------------------------------------------------------ API
export class ApiError extends Error {
  constructor(msg, status, code) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const opts = { method, headers: { 'X-Ivy': '1', ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError('인터넷 연결을 확인해 주세요.', 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'login_required') window.dispatchEvent(new CustomEvent('ivy:logout'));
    throw new ApiError(data.error || '문제가 생겼어요.', res.status, data.code);
  }
  return data;
}

// ------------------------------------------------------------ 아이콘
export function Icon({ name, size = '', cls = '' }) {
  return html`<svg class=${`ico ${size} ${cls}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

// ------------------------------------------------------------ 토스트
let toastId = 0;
const toastSubs = new Set();
let toasts = [];
export function toast(msg, kind = 'ok') {
  const id = ++toastId;
  toasts = [...toasts, { id, msg, kind }];
  toastSubs.forEach((f) => f(toasts));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastSubs.forEach((f) => f(toasts));
  }, kind === 'err' ? 4200 : 2600);
}
export const toastErr = (e) => toast(e && e.message ? e.message : String(e), 'err');
export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastSubs.add(setList);
    return () => toastSubs.delete(setList);
  }, []);
  return html`<div class="toasts" role="status">${list.map(
    (t) => html`<div class="toast ${t.kind === 'err' ? 'err' : ''}" key=${t.id}><${Icon} name=${t.kind === 'err' ? 'alert' : 'checkCircle'} />${t.msg}</div>`,
  )}</div>`;
}

// ------------------------------------------------------------ 모달
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);
  return html`<div class="backdrop" onClick=${(e) => e.target === e.currentTarget && onClose && onClose()}>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>${title}</h3>${onClose && html`<button class="btn ghost icon sm" onClick=${onClose} aria-label="닫기"><${Icon} name="x" /></button>`}</div>
      <div class="modal-b">${children}</div>
      ${footer && html`<div class="modal-f">${footer}</div>`}
    </div>
  </div>`;
}

let confirmSetter = null;
export function confirmBox({ title, body, ok = '확인', danger = false }) {
  return new Promise((resolve) => confirmSetter && confirmSetter({ title, body, ok, danger, resolve }));
}
export function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => {
    confirmSetter = setC;
  }, []);
  if (!c) return null;
  const close = (v) => {
    c.resolve(v);
    setC(null);
  };
  return html`<${Modal} title=${c.title} onClose=${() => close(false)} footer=${html`
      <button class="btn secondary" onClick=${() => close(false)}>취소</button>
      <button class="btn ${c.danger ? 'danger' : 'primary'}" onClick=${() => close(true)}>${c.ok}</button>`}>
    <p style="margin:4px 0 8px;color:var(--ink-2)">${c.body}</p>
  </${Modal}>`;
}

// ------------------------------------------------------------ 분필 밑줄 (지금 있는 곳 표시)
export function ChalkLine() {
  return html`<svg class="chalk-line" viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true"><path d="M3 6.6C21 4.4 40 7.6 62 5.7S100 4.2 117 5.3" /></svg>`;
}

// ------------------------------------------------------------ 찾기 (초성으로도: ㄱㅎㅈ → 김하준)
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function chosung(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
// 0: 안 맞음, 1: 가운데가 맞음, 2: 앞부분이 맞음 (앞이 맞는 것을 먼저 보여 줘요)
export function matchScore(text, q) {
  const qq = String(q || '').toLowerCase().replace(/\s+/g, '');
  if (!qq) return 1;
  const t = String(text || '').toLowerCase().replace(/\s+/g, '');
  const hay = /^[ㄱ-ㅎ]+$/.test(qq) ? chosung(t) : t;
  const i = hay.indexOf(qq);
  return i < 0 ? 0 : i === 0 ? 2 : 1;
}
export function matches(text, q) {
  return matchScore(text, q) > 0;
}

// 화면끼리 알리기: 과제를 내면 과제 목록이 저절로 새로 고쳐져요
export function useEvent(name, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e) => ref.current(e);
    window.addEventListener(name, h);
    return () => window.removeEventListener(name, h);
  }, [name]);
}
export const emit = (name) => window.dispatchEvent(new Event(name));
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

// ------------------------------------------------------------ 작은 부품
export function Btn({ kind = 'secondary', size = '', icon, children, busy, block, cls = '', ...rest }) {
  return html`<button class=${`btn ${kind} ${size} ${block ? 'block' : ''} ${cls}`} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<${Icon} name="refresh" cls="spin" />` : icon ? html`<${Icon} name=${icon} />` : null}${children}
  </button>`;
}

export function Field({ label, hint, error, children }) {
  return html`<div class="field ${error ? 'err' : ''}">
    ${label && html`<label>${label}</label>`}${children}${hint && html`<div class="hint">${hint}</div>`}${error && html`<div class="error">${error}</div>`}
  </div>`;
}

export function Seg({ value, options, onChange, full, label }) {
  return html`<div class="seg ${full ? 'full' : ''}" role="group" aria-label=${label}>
    ${options.map(([v, text, title]) => html`<button type="button" class=${value === v ? 'on' : ''} aria-pressed=${value === v} title=${title} aria-label=${title} onClick=${() => onChange(v)}>${text}</button>`)}
  </div>`;
}

export function Switch({ checked, onChange, title, desc }) {
  return html`<label class="switch"><div><div class="t">${title}</div>${desc && html`<div class="d">${desc}</div>`}</div>
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /></label>`;
}

export function Bar({ value = 0, tone, thin }) {
  return html`<div class="bar ${tone || ''} ${thin ? 'thin' : ''}"><i style=${`width:${Math.max(0, Math.min(100, value))}%`}></i></div>`;
}

export function Ring({ value = 0, size = 64, stroke = 7, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return html`<div class="ring" style=${`width:${size}px;height:${size}px`}>
    <svg width=${size} height=${size}><circle cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${stroke} fill="none" />
      <circle cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${stroke} fill="none" stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - v / 100)} style=${`transition:stroke-dashoffset .6s ease${v >= 100 ? ';stroke:var(--green)' : ''}`} /></svg>
    <div class="rv num">${label !== undefined ? label : `${Math.round(v)}%`}</div>
  </div>`;
}

export function Empty({ icon = 'penLine', title, children, action }) {
  return html`<div class="empty"><div class="ei"><${Icon} name=${icon} size="lg" /></div><div class="et">${title}</div>
    <div style="font-size:14px">${children}</div>${action && html`<div style="margin-top:16px">${action}</div>`}</div>`;
}

export function Skel({ h = 18, w = '100%', mb = 10 }) {
  return html`<div class="skel" style=${`height:${h}px;width:${w};margin-bottom:${mb}px`}></div>`;
}

export const STATUS = {
  queued: ['대본 대기', 'sky', true],
  scripting: ['대본 쓰는 중', 'sky', true],
  review: ['검수 대기', 'amber', false],
  render_queued: ['영상 대기', 'sky', true],
  rendering: ['영상 만드는 중', 'sky', true],
  done: ['완성', 'ivy', false],
  failed: ['실패', 'rose', false],
  manual: ['올리는 중', 'amber', false],
};
export function StatusChip({ status }) {
  const [label, tone, live] = STATUS[status] || [status, '', false];
  return html`<span class="chip ${tone}"><span class="dot ${live ? 'pulse' : ''}"></span>${label}</span>`;
}

// ------------------------------------------------------------ 형식
export function fmtDur(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtMin(sec) {
  if (!sec) return '';
  return `${Math.round(sec / 60)}분`;
}
export function fmtDate(ts, withTime) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  let s = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  if (withTime) s += ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return s;
}
export function ago(ts) {
  if (!ts) return '기록 없음';
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  return fmtDate(ts);
}
export function dueLabel(ts) {
  if (!ts) return null;
  const now = new Date();
  const due = new Date(ts * 1000);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((b - a) / 86400000);
  if (ts * 1000 < Date.now()) return { text: '마감 지남', tone: 'rose' };
  if (diff === 0) return { text: '오늘 마감', tone: 'amber' };
  if (diff === 1) return { text: '내일 마감', tone: 'amber' };
  return { text: `D-${diff}`, tone: diff <= 3 ? 'amber' : '' };
}
export function fmtBytes(n) {
  if (!n) return '';
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}
export function initial(name) {
  return ((name || '?').trim() || '?').slice(0, 1);
}

// ------------------------------------------------------------ 라우터
export function useRoute() {
  const get = () => (location.hash || '#/').slice(1) || '/';
  const [route, setRoute] = useState(get());
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => {
  location.hash = '#' + path;
};

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async (silent) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e });
    }
  }, deps);
  useEffect(() => {
    reload();
  }, deps);
  return { ...state, reload };
}

// 큰 파일 나눠 올리기
export async function uploadFile(file, lectureId, kind, onProgress, extra = {}) {
  const st = await api('/api/up/start', { method: 'POST', body: { lecture_id: lectureId, kind } });
  const PART = 8 * 1024 * 1024;
  const parts = [];
  const n = Math.max(1, Math.ceil(file.size / PART));
  for (let i = 0; i < n; i++) {
    const chunk = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
    let tries = 0;
    for (;;) {
      try {
        const r = await api(`/api/up/part?key=${encodeURIComponent(st.key)}&uploadId=${encodeURIComponent(st.uploadId)}&n=${i + 1}`, {
          method: 'PUT',
          body: chunk,
          raw: true,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        parts.push(r);
        break;
      } catch (e) {
        if (++tries >= 3) {
          await api('/api/up/abort', { method: 'POST', body: { key: st.key, uploadId: st.uploadId } }).catch(() => {});
          throw e;
        }
      }
    }
    onProgress && onProgress(Math.round(((i + 1) / n) * 100));
  }
  return api('/api/up/complete', { method: 'POST', body: { key: st.key, uploadId: st.uploadId, parts, kind, ...extra } });
}

// 올린 영상에서 썸네일 한 장을 떠요 (앞쪽 10% 지점, 최대 5초). 못 뜨면 null.
export function videoThumb(file, width = 960) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (blob) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(blob || null);
    };
    const timer = setTimeout(() => finish(null), 15000);
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(5, (v.duration || 10) * 0.1);
    };
    v.onseeked = () => {
      try {
        const w = width;
        const h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob((b) => {
          clearTimeout(timer);
          finish(b);
        }, 'image/jpeg', 0.85);
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    v.src = url;
  });
}

export function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve(v.duration);
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('복사했어요');
  } catch {
    toast('복사하지 못했어요. 길게 눌러 직접 복사해 주세요.', 'err');
  }
}

// ------------------------------------------------------------ 한/영 키가 한글일 때 친 글자 (두벌식) → 영문 자판 글자
// 아이디는 영문·숫자만 써서 한글이 섞이면 늘 한/영 키 실수예요. 비밀번호도 한 번 더 해 볼 때 써요.
const HAN_KEY = {
  ㄱ: 'r', ㄲ: 'R', ㄴ: 's', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅁ: 'a', ㅂ: 'q', ㅃ: 'Q', ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w', ㅉ: 'W', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
  ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u', ㅖ: 'P', ㅗ: 'h', ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅛ: 'y', ㅜ: 'n', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl', ㅠ: 'b', ㅡ: 'm', ㅢ: 'ml', ㅣ: 'l',
  ㄳ: 'rt', ㄵ: 'sw', ㄶ: 'sg', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft', ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg', ㅄ: 'qt',
};
const H_CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const H_JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const H_JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
export const hasHangul = (s) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(String(s || ''));
export function hanToEng(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) out += HAN_KEY[H_CHO[(c / 588) | 0]] + HAN_KEY[H_JUNG[((c % 588) / 28) | 0]] + (c % 28 ? HAN_KEY[H_JONG[c % 28]] : '');
    else out += HAN_KEY[ch] || ch;
  }
  return out;
}

// Caps Lock 이 켜졌는지 (비밀번호 칸에서 키를 누를 때 알아내요)
export function useCapsLock() {
  const [caps, setCaps] = useState(false);
  const onKey = (e) => {
    if (e.getModifierState) setCaps(e.getModifierState('CapsLock'));
  };
  return [caps, onKey];
}

// 비밀번호 칸 아래 작은 안내: 한글 입력, Caps Lock
export function KeyWarn({ value, caps }) {
  const msg = hasHangul(value) ? '한글로 입력되고 있어요. 한/영 키를 눌러 주세요.' : caps ? 'Caps Lock이 켜져 있어요.' : '';
  return msg ? html`<div class="key-warn" role="status"><${Icon} name="alert" size="sm" />${msg}</div>` : null;
}

// ------------------------------------------------------------ 복구 코드 카드 (사진 찍거나 인쇄해 두는 카드)
export function RecoveryCard({ code, loginId, academy }) {
  const site = location.origin;
  const text = [`[${academy}] 강의실 선생님 계정 되찾기`, `주소: ${site}`, `아이디: ${loginId}`, `복구 코드: ${code}`, "비밀번호를 잊으면 로그인 화면의 '아이디나 비밀번호를 잊었어요'에서 이 코드를 넣어요."].join('\n');
  const card = useRef(null);
  // 카드만 인쇄해요: 카드를 body 바로 아래에 복사해 두고, 인쇄할 때는 그것만 보여요
  const print = () => {
    const box = document.createElement('div');
    box.id = 'rc-print';
    box.appendChild(card.current.cloneNode(true));
    document.body.appendChild(box);
    document.body.classList.add('print-rc');
    let gone = false;
    const done = () => {
      if (gone) return;
      gone = true;
      document.body.classList.remove('print-rc');
      box.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 60000);
  };
  return html`<div class="rc">
    <div class="rc-card" ref=${card}>
      <div class="rc-h">${academy} 강의실 선생님 계정</div>
      <dl class="rc-dl">
        <dt>주소</dt><dd>${site.replace(/^https?:\/\//, '')}</dd>
        <dt>아이디</dt><dd>${loginId}</dd>
      </dl>
      <div class="rc-cl">복구 코드</div>
      <div class="rc-code num">${code}</div>
      <div class="rc-foot">비밀번호를 잊으면 로그인 화면의 ‘아이디나 비밀번호를 잊었어요’에서 이 코드를 넣어요.</div>
    </div>
    <div class="row wrap" style="gap:8px"><${Btn} size="sm" icon="copy" type="button" onClick=${() => copyText(text)}>복사</${Btn}><${Btn} size="sm" icon="printer" type="button" onClick=${print}>인쇄</${Btn}></div>
  </div>`;
}
