// 공용 도구 모음
export const now = () => Math.floor(Date.now() / 1000);

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, '요청 형식이 올바르지 않아요.', 'bad_json');
  }
}

export function str(v, max = 2000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

export function int(v, fallback = null) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const enc = new TextEncoder();

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 0~9가 고르게 나오도록 250 이상인 값은 버려요
export function randomDigits(n) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 250 && out.length < n) out += String(b % 10);
  }
  return out;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// PBKDF2. 무료 요금제 CPU 한도 안에서 돌도록 반복 횟수를 맞췄어요.
const PBKDF2_ITER = 10000;

export async function hashPassword(password, saltHex) {
  const salt = saltHex || toHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITER },
    key,
    256,
  );
  return { hash: toHex(bits), salt };
}

export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// 파일 주소 서명용 비밀값. 처음 쓸 때 만들어 DB에 둬요.
export async function linkSecret(env) {
  const get = () => env.DB.prepare("SELECT value FROM settings WHERE key = 'link_secret'").first();
  let row = await get();
  if (row && row.value) return row.value;
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('link_secret', ?) ON CONFLICT(key) DO NOTHING").bind(randomToken(32)).run();
  row = await get();
  return row.value;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure }) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

// 시청 구간 비트맵: 1초 = 1비트
export function bitsDecode(b64, nbits) {
  const out = new Uint8Array(Math.ceil(nbits / 8));
  if (!b64) return out;
  try {
    const bin = atob(b64);
    for (let i = 0; i < Math.min(bin.length, out.length); i++) out[i] = bin.charCodeAt(i);
  } catch {
    /* 잘못된 값은 비어 있는 것으로 봐요 */
  }
  return out;
}

export function bitsEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function bitsCount(bytes, nbits) {
  let c = 0;
  for (let i = 0; i < nbits; i++) if (bytes[i >> 3] & (1 << (i & 7))) c++;
  return c;
}

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    academy_name: s.academy_name || '우리 학원',
    app_name: s.app_name || '온라인 강의실',
    header_text: s.header_text || '',
    academy_phone: s.academy_phone || '',
    logo_key: s.logo_key || '',
    complete_threshold: int(s.complete_threshold, 90),
    prevent_skip: s.prevent_skip === '1',
    default_minutes: int(s.default_minutes, 15),
    default_tone: s.default_tone || 'banmal',
    engine_token_hash: s.engine_token_hash || '',
    engine_last_seen: int(s.engine_last_seen, 0),
    engine_info: s.engine_info ? safeParse(s.engine_info) : null,
    board_style: safeParse(s.board_style, {}) || {},
    recovery_at: int(s.recovery_at, 0),
    // 레벨테스트: 링크로 받기(처음에는 켜져 있어요), 기본 영역 묶음, 학원 교재 목록(없으면 기본 목록)
    lt_open: s.lt_open !== '0',
    lt_preset: s.lt_preset || 'new',
    lt_books: safeParse(s.lt_books, null),
  };
}

// 판서 스타일 (선생님이 고른 글꼴·색·표기 방식·AI 판서 규칙). public/assets/board.js 의 DEFAULT_STYLE 과 같아야 해요.
// 규칙 버전 2: 괄호 안은 사선만, 문장 뒤 분사구문, 의문문, 도치. 버전 3: 수식어 괄호.
// 버전 4: 해석 기준, 동그라미는 동사만(조동사·사이 부사까지 한 덩어리), 접속부사·문두 전명구 괄호, 병렬 세모, 긴 주어 뒤 사선, 소제목 (board.js RULES_ADDED 와 같아요)
const RULES_ADDED = {
  2: [
    "- 괄호 안에는 밑줄·동그라미 같은 표시 없이 사선만 쓴다. 사선은 긴 명사절·형용사절·부사절에서만, 절의 주어+동사(또는 주어+동사+목적어)까지 읽은 뒤 수식어가 시작되는 곳처럼 자연스럽게 쉬어 읽는 곳에만 긋는다",
    "- 문장 뒤에 나오는 분사구문은 괄호로 묶지 않고 분사를 동사처럼 동그라미. 앞 문장에 이어 '그리고' 또는 '그래서'를 붙여 해석한다",
    "- 의문문은 의문사를 괄호, 앞에 나오는 be동사·조동사는 주어와 함께 밑줄(주어가 길면 괄호)로 주어임을 분명히 하고 '은/는/이/가'를 붙여 해석한다. 주어 뒤에 오는 말은 품사와 상관없이 동사처럼 동그라미 치고 '~니?/~까?'를 붙여 해석한다",
    "- 도치 구문은 맨 앞으로 나온 말을 괄호, 나머지는 의문문처럼 앞의 be동사·조동사와 주어를 함께 밑줄, 주어 뒤에 오는 말은 동사처럼 동그라미",
  ],
  3: ["- 부사, 전치사구 같은 수식어는 괄호. 이어서 나오는 수식어는 통으로 한 괄호 (예: (all night), (quietly on the bench))"],
  4: [
    "- 판서는 해석 기준: 읽고 해석하는 덩어리대로 표시한다",
    "- 동그라미는 동사(해석할 때 '~다', '~니?'가 붙는 말)에만 친다. 접속부사(however, therefore 등)는 괄호",
    "- 주절의 주어가 길면 주어가 끝나고 동사가 시작되는 곳, 읽을 때 쉬는 곳에 사선",
    "- 소제목은 문장에 붙어 있어도 떼어서 그 문단 위에 따로 쓴다",
  ],
};
const RULES_V = 4;
const VERB_RULE = "- 동사는 조동사와 사이에 낀 부사까지 한 동그라미 (예: will also search). 현재완료·과거완료도 have, has, had부터 p.p.까지 한 동그라미 (예: has already finished). 시제와 태(수동태)도 해석 기준으로 함께 묶는다";
const FRONT_RULE = "- 문장 맨 앞에 나오는 부사는 단어·구·절 모두 괄호. For example, In addition 같은 전명구도 부사구라서 통째로 괄호";
const CONJ_RULE = "- 등위접속사는 문장과 문장을 이을 때 세모. 뒤에 주어 없이 동사가 와서 병렬로 이어질 때도 세모";
export const DEFAULT_RULES = [
  RULES_ADDED[4][0],
  "- 주어·목적어·목적격 보어는 밑줄",
  VERB_RULE,
  "- 2형식은 해석 기준('~다')이라 보어가 3단어까지면 동사와 보어를 함께 동그라미, 3단어가 넘으면 동사는 동그라미, 보어는 괄호",
  "- 주어·목적어는 3단어 이상이면 구로 보고 괄호",
  "- 동명사구, to부정사구, 분사구는 괄호",
  FRONT_RULE,
  "- that절, what절, whether절, if절, 복합관계대명사절 같은 명사절은 모두 괄호",
  CONJ_RULE,
  ...RULES_ADDED[2],
  ...RULES_ADDED[3],
  ...RULES_ADDED[4].slice(1),
].join('\n');

// 예전 기본 규칙 줄을 새 규칙으로 바꾸고, 저장한 뒤 새로 생긴 기본 규칙은 한 번만 더해요 (board.js migrateRules 와 같아요)
const OLD_RULE_LINES = [
  ["- 주어·목적어·보어는 밑줄", "- 주어·목적어·목적격 보어는 밑줄"],
  ["- 2형식은 '~다'로 해석하니까 동사와 보어를 함께 동그라미. 단, 보어가 3단어 이상이면 동사는 동그라미, 보어는 따로 표시", "- 2형식은 해석 기준('~다')이라 보어가 3단어까지면 동사와 보어를 함께 동그라미, 3단어가 넘으면 동사는 동그라미, 보어는 괄호"],
  ["- 주어·목적어·보어라도 3단어 이상이면 구로 보고 괄호", "- 주어·목적어는 3단어 이상이면 구로 보고 괄호"],
  ["- 끊어 읽기 사선(/)은 긴 명사절·형용사절·부사절의 괄호 안에서만 쓴다. 의미 단위마다 끊지 말고, 절의 주어+동사(또는 주어+동사+목적어)까지 읽은 뒤 수식어가 시작되는 곳처럼 자연스럽게 쉬어 읽는 곳에만 긋는다", "- 괄호 안에는 밑줄·동그라미 같은 표시 없이 사선만 쓴다. 사선은 긴 명사절·형용사절·부사절에서만, 절의 주어+동사(또는 주어+동사+목적어)까지 읽은 뒤 수식어가 시작되는 곳처럼 자연스럽게 쉬어 읽는 곳에만 긋는다"],
  ["- 동사는 시제와 태(조동사·수동태 포함)까지 해석 기준으로 동그라미", VERB_RULE],
  ["- 문장 맨 앞에 나오는 부사는 단어·구·절 모두 괄호", FRONT_RULE],
  ["- 등위접속사는 문장과 문장을 이을 때만 세모", CONJ_RULE],
  ["- 의문문은 의문사를 괄호, be동사·조동사 뒤의 주어는 밑줄(길면 괄호)로 주어임을 분명히 하고 '은/는/이/가'를 붙여 해석한다. 주어 뒤에 오는 말은 품사와 상관없이 동사처럼 동그라미 치고 '~니?/~까?'를 붙여 해석한다", RULES_ADDED[2][2]],
  ["- 도치 구문은 맨 앞으로 나온 말을 괄호, 나머지는 의문문처럼 주어는 밑줄, 주어 뒤에 오는 말은 동사처럼 동그라미", RULES_ADDED[2][3]],
];
function migrateRules(text, v) {
  const lines = String(text)
    .split('\n')
    .map((line) => {
      const hit = OLD_RULE_LINES.find(([a]) => line.trim() === a);
      return hit ? hit[1] : line;
    });
  const from = Number(v) || 1;
  for (const [ver, add] of Object.entries(RULES_ADDED)) {
    if (from >= Number(ver)) continue;
    const missing = add.filter((a) => !lines.some((l) => l.trim() === a));
    if (!missing.length) continue;
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(...missing);
  }
  return lines.join('\n');
}

export function cleanStyle(x) {
  const o = x && typeof x === 'object' ? x : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const c = (o.colors && typeof o.colors === 'object' && o.colors) || {};
  return {
    hand: pick(o.hand, ['gaegu', 'pen', 'print'], 'gaegu'),
    en_font: pick(o.en_font, ['serif', 'sans'], 'serif'),
    labels: pick(o.labels, ['en', 'ko', 'none'], 'en'),
    modifier: pick(o.modifier, ['box', 'paren', 'paren2'], 'paren'),
    verb_mark: pick(o.verb_mark, ['circle', 'under'], 'circle'),
    conj_mark: pick(o.conj_mark, ['triangle', 'circle', 'none'], 'triangle'),
    long_paren: o.long_paren === undefined ? true : !!o.long_paren,
    sc_circle: o.sc_circle === undefined ? true : !!o.sc_circle,
    fill: o.fill !== false,
    ko: pick(o.ko, ['always', 'step'], 'always'),
    colors: {
      subject: hex(c.subject, '#2457d6'),
      verb: hex(c.verb, '#e0362c'),
      modifier: hex(c.modifier, '#179c55'),
      connector: hex(c.connector, '#e5860b'),
      note: hex(c.note, '#e0362c'),
      highlight: hex(c.highlight, '#ffe27a'),
      accent: hex(c.accent, '#1f2d5c'),
    },
    rules: o.rules === undefined || o.rules === null ? DEFAULT_RULES : migrateRules(String(o.rules).trim(), o.rules_v).slice(0, 3000),
    rules_v: RULES_V,
  };
}

export function logoUrl(s) {
  return s.logo_key ? `/media/logo?v=${encodeURIComponent(s.logo_key.replace(/^.*logo-/, '').replace(/\..*$/, ''))}` : null;
}

export async function setSettings(env, obj) {
  const stmts = Object.entries(obj).map(([k, v]) =>
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(
      k,
      v === null || v === undefined ? null : String(v),
    ),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

export function safeParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// 강의 학년 (새 강의, 강의 목록 구분, 대본·문제 수준)
export const LECTURE_LEVELS = ['mid1', 'mid2', 'mid3', 'high1', 'high2', 'high3'];
// 1.4.0 이전 엔진은 mid1, mid2 를 몰라서 학년 이름으로 바꿔 보내요 (새 엔진은 둘 다 알아요)
const OLD_ENGINE_LEVEL = { mid1: '중학교 1학년', mid2: '중학교 2학년' };
export function engineOptions(raw) {
  const o = typeof raw === 'string' ? safeParse(raw, {}) || {} : { ...(raw || {}) };
  if (OLD_ENGINE_LEVEL[o.level]) o.level = OLD_ENGINE_LEVEL[o.level];
  return o;
}

// 학생 이름 부르기: 선생님이 '부를 이름'을 적었으면 그대로, 아니면 김하준 → 하준아 (반말, 반존대), 김하준 학생 (존댓말)
export function callText(user, tone) {
  const custom = String((user && user.call_name) || '').trim();
  if (custom) return custom;
  const base = String((user && user.name) || '').trim();
  if (!base) return '';
  if (tone === 'jondaet') return `${base} 학생`;
  const isHangul = (ch) => ch >= '가' && ch <= '힣';
  const given = base.length === 3 && [...base].every(isHangul) ? base.slice(1) : base;
  const last = given[given.length - 1];
  if (isHangul(last)) return given + ((last.charCodeAt(0) - 0xac00) % 28 ? '아' : '야');
  return given;
}
