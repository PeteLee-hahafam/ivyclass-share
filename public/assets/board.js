// 판서 그리기
// 지문 문장(영어·해석)에 밑줄·박스·형광펜·메모·화살표를 그리고, 내용 정리·메모·핵심 단어 상자를 채워요.
// 선생님 검수 화면(미리보기)과 학원 PC 제작 엔진(영상 만들기)이 같은 코드를 써서 보이는 모습이 똑같아요.

const SVGNS = 'http://www.w3.org/2000/svg';
const VW = 1920;
const VH = 1080;
const COLORS = { blue: '#2457d6', red: '#e0362c', green: '#179c55', orange: '#e5860b', purple: '#7c4ddb', gray: '#7a8396', navy: '#1f2d5c' };
const ICON = {
  sum: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  memo: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  flow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h4a2 2 0 0 1 2 2v7"/><path d="m12 12 3 3 3-3"/>',
  voc: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  exam: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
};
// 판서 펜 (끝이 그리는 자리에 와요). 색은 --pen-c
const PEN_SVG = `<svg viewBox="0 0 90 120" width="90" height="120" aria-hidden="true"><g transform="rotate(32 8 112)">
<path d="M8 112 L2.5 100 H13.5 Z" style="fill:var(--pen-c,#e0362c)"/>
<rect x="1" y="88" width="14" height="13" rx="2" style="fill:var(--pen-c,#e0362c)"/>
<rect x="-1" y="22" width="18" height="68" rx="5" fill="#273046"/>
<rect x="2" y="26" width="3.5" height="58" rx="1.75" fill="#ffffff" opacity="0.22"/>
<rect x="-1.5" y="6" width="19" height="20" rx="5" style="fill:var(--pen-c,#e0362c)"/>
</g></svg>`;

// 대본 속 이름 부르기 자리({호명})와 목소리 감정 표시([laughs] 등)는 화면 글자에서 빼요
export function cleanSay(text) {
  return String(text || '')
    .replace(/\{\s*호명\s*\}(아|야)?\s*[,!.]?\s*/g, '')
    .replace(/\[\s*(laughs|chuckles|excited|curious|surprised|whispers|sighs|warmly|playfully|emphasizes|pause)\s*\]\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const VIEW_LABEL = { intro: '인사', summary: '내용 정리', sentence: '문장', flow: '글의 흐름', memo: '메모', vocab: '핵심 어휘', exam: '변형 포인트', review: '마무리' };

// ------------------------------------------------------------ 판서 스타일 (설정 → 판서 스타일)
// 규칙 버전 2: 괄호 안은 사선만, 문장 뒤 분사구문, 의문문, 도치. 버전 3: 수식어 괄호.
// 버전 4: 해석 기준, 동그라미는 동사만(조동사·사이 부사까지 한 덩어리), 접속부사·문두 전명구 괄호, 병렬 세모, 긴 주어 뒤 사선, 소제목 (서버 util.js 와 같아야 해요)
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
export const RULES_V = 4;
const VERB_RULE = "- 동사는 조동사와 사이에 낀 부사까지 한 동그라미 (예: will also search). 현재완료·과거완료도 have, has, had부터 p.p.까지 한 동그라미 (예: has already finished). 시제와 태(수동태)도 해석 기준으로 함께 묶는다";
const FRONT_RULE = "- 문장 맨 앞에 나오는 부사는 단어·구·절 모두 괄호. For example, In addition 같은 전명구도 부사구라서 통째로 괄호";
const CONJ_RULE = "- 등위접속사는 문장과 문장을 이을 때 세모. 뒤에 주어 없이 동사가 와서 병렬로 이어질 때도 세모";
export const BASE_RULES = [
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
// 예전 기본 규칙 줄을 새 규칙으로 바꿔요 (선생님이 손댄 다른 줄은 그대로)
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
// v: 규칙을 저장할 때의 규칙 버전. 그 뒤에 새로 생긴 기본 규칙은 한 번만 더해요(선생님이 지운 줄은 다시 넣지 않아요)
export function migrateRules(text, v) {
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
export const DEFAULT_STYLE = {
  hand: 'gaegu', // gaegu(둥근 손글씨) | pen(펜 손글씨) | print(정자체)
  en_font: 'serif', // serif(명조) | sans(고딕)
  labels: 'en', // en(S V O C) | ko(주 동 목 보) | none(쓰지 않기)
  modifier: 'paren', // box(둥근 박스) | paren(괄호 ( )) | paren2(구 ( ) · 절 [ ])
  verb_mark: 'circle', // circle(동그라미) | under(밑줄)
  conj_mark: 'triangle', // triangle(세모) | circle(동그라미) | none
  long_paren: true, // 3단어 이상 주어·목적어·보어는 괄호
  sc_circle: true, // 2형식: 보어가 3단어까지면 동사와 보어를 한 동그라미로, 넘으면 보어는 괄호
  fill: true, // 박스 안 연하게 칠하기
  ko: 'always', // always(처음부터) | step(설명할 때 나타나기)
  colors: { subject: '#2457d6', verb: '#e0362c', modifier: '#179c55', connector: '#e5860b', note: '#e0362c', highlight: '#ffe27a', accent: '#1f2d5c' },
  rules: BASE_RULES,
  rules_v: RULES_V,
};
export const STYLE_PRESETS = {
  base: { label: '기본 판서', style: {} },
  sample: { label: '샘플 영상처럼', style: { modifier: 'box', verb_mark: 'under', conj_mark: 'circle', long_paren: false } },
  paren2: { label: '구 ( ) · 절 [ ]', style: { modifier: 'paren2' } },
  pen: { label: '펜 손글씨', style: { hand: 'pen', colors: { subject: '#1d4fd8', verb: '#d92d20', modifier: '#0f8a4a', connector: '#d97706', note: '#d92d20', highlight: '#fde68a', accent: '#111827' } } },
  calm: { label: '차분한 색', style: { colors: { subject: '#3b5b92', verb: '#b4443a', modifier: '#4c7a5b', connector: '#a8742b', note: '#b4443a', highlight: '#f4e3a1', accent: '#334155' } } },
};
const HANDS = {
  gaegu: { family: "'Gaegu', 'Pretendard Variable', sans-serif", load: 'Gaegu', weight: 700, size: 26, row: 31 },
  pen: { family: "'Nanum Pen Script', 'Gaegu', sans-serif", load: '"Nanum Pen Script"', weight: 400, size: 32, row: 37 },
  print: { family: "'Pretendard Variable', Pretendard, sans-serif", load: '"Pretendard Variable"', weight: 600, size: 23, row: 27 },
};
const KO_LABELS = { S: '주', V: '동', O: '목', C: '보', 'O.C': '목보', OC: '목보', 'S.C': '주보', SC: '주보', 'I.O': '간목', IO: '간목', 'D.O': '직목', DO: '직목', 가S: '가주', 진S: '진주', 가O: '가목', 진O: '진목', "S'": "주'", "V'": "동'", "O'": "목'", "C'": "보'" };
const hexOk = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export function normalizeStyle(input) {
  const x = input && typeof input === 'object' ? input : {};
  const D = DEFAULT_STYLE;
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const c = x.colors || {};
  const colors = {};
  for (const [k, d] of Object.entries(D.colors)) colors[k] = hexOk(c[k]) ? c[k] : d;
  return {
    hand: pick(x.hand, ['gaegu', 'pen', 'print'], D.hand),
    en_font: pick(x.en_font, ['serif', 'sans'], D.en_font),
    labels: pick(x.labels, ['en', 'ko', 'none'], D.labels),
    modifier: pick(x.modifier, ['box', 'paren', 'paren2'], D.modifier),
    verb_mark: pick(x.verb_mark, ['circle', 'under'], D.verb_mark),
    conj_mark: pick(x.conj_mark, ['triangle', 'circle', 'none'], D.conj_mark),
    long_paren: x.long_paren === undefined ? D.long_paren : !!x.long_paren,
    sc_circle: x.sc_circle === undefined ? D.sc_circle : !!x.sc_circle,
    fill: x.fill === undefined ? D.fill : x.fill !== false,
    ko: pick(x.ko, ['always', 'step'], D.ko),
    colors,
    rules: x.rules === undefined || x.rules === null ? D.rules : migrateRules(x.rules, x.rules_v),
    rules_v: RULES_V,
  };
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ------------------------------------------------------------ 해석 덩어리 (판서는 해석 기준)
// 동사는 조동사와 사이에 낀 부사까지 한 동그라미: will (also) search → will also search
// 의문문·도치에서 앞으로 나온 be동사·조동사는 주어와 함께 밑줄: Did + the students → Did the students
const AUX = new Set([
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'cannot', "won't", "wouldn't", "shan't", "shouldn't", "can't", "couldn't",
  "mightn't", "mustn't", "don't", "doesn't", "didn't", "haven't", "hasn't", "hadn't", "isn't", "aren't", "wasn't", "weren't",
]);
const MID_ADV = new Set(['not', 'never', 'also', 'always', 'still', 'even', 'just', 'already', 'often', 'sometimes', 'usually', 'ever', 'only', 'soon', 'now', 'then', 'once', 'yet', 'further', 'almost', 'nearly', 'rather', 'quite', 'all', 'both', 'each', 'no', 'longer']);
const SC_LAB = /^(C|S\.?C)'?$/;
const CORE_LAB = /^(S|O|C|O\.?C|S\.?C|I\.?O|D\.?O|가S|진S|가O|진O)'?$/;
const wordsOf = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const lowW = (w) => String(w || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z']/g, '');
const labOf = (m) => String(m.label || '').trim();
const isVerbLab = (m) => /^V/.test(labOf(m));
// 주어 표시 (S, '동명사구 S' 같은 이름표. 의문사 주어는 빼요)
const isSubj = (m) => (labOf(m) === 'S' || /\sS$/.test(labOf(m))) && !/의문사/.test(labOf(m));
// 앞 단어 하나 (쉼표 같은 문장부호는 넘지 않아요)
function wordBefore(text, pos) {
  const m = /([A-Za-z’']+)\s+$/.exec(text.slice(0, pos));
  return m ? { w: m[1], s: m.index, e: m.index + m[1].length } : null;
}
// 표시가 실제로 덮는 글자 (조동사까지 넓힌 범위 기준)
const rangeText = (s, m) => (m._on === 'ko' ? s.ko : s.en).slice(m._r.s, m._r.e);
// 주어·목적어 길이: 의문문에서 주어와 함께 묶은 앞 조동사는 세지 않아요
function coreWords(s, m) {
  const ws = rangeText(s, m).trim().split(/\s+/).filter(Boolean);
  return ws.length > 1 && isSubj(m) && AUX.has(lowW(ws[0])) ? ws.length - 1 : ws.length;
}
// 표시 범위를 해석 덩어리에 맞게 넓혀요. 다른 표시에 합쳐진 표시 id 를 돌려줘요 (그리지 않아요)
// 현재완료·과거완료도 have/has/had 부터 p.p. 까지 한 덩어리 (has already finished, had been waiting)
export function joinChunks(s) {
  const merged = new Set();
  const en = s.marks.filter((m) => m._on !== 'ko' && m._r);
  const question = /\?["”’)\]]*\s*$/.test(s.en);
  const fronted = en.some((x) => /도치|의문사/.test(labOf(x)));
  const isVerbMark = (m) => isVerbLab(m) && ['under', 'circle'].includes(m.type || 'under');
  const coverOf = (t, self) => en.find((x) => x !== self && !merged.has(x.id) && ['under', 'circle', 'box', 'triangle'].includes(x.type || 'under') && x._r.s < t.e && t.s < x._r.e);
  const advBox = (x) => x.type === 'box' && (!labOf(x) || /부사|수식어/.test(labOf(x))) && wordsOf(rangeText(s, x)) <= 3;
  for (const v of en) {
    if (!isVerbMark(v) || merged.has(v.id)) continue;
    let pos = v._r.s;
    let start = null;
    let advFrom = null;
    const eat = [];
    for (let k = 0; k < 6; k++) {
      const t = wordBefore(s.en, pos);
      if (!t) break;
      const other = coverOf(t, v);
      if (other && isVerbMark(other) && AUX.has(lowW(rangeText(s, other).trim().split(/\s+/).pop()))) {
        // 조동사만 따로 동사로 표시한 경우: 하나로 합쳐요
        eat.push(other);
        start = other._r.s;
        pos = other._r.s;
        continue;
      }
      if (other && !advBox(other)) {
        // 의문문·도치에서 주어 바로 뒤 부사는 동사 덩어리에 넣어요: Have you (ever) seen → ever seen
        if (start === null && advFrom !== null && (question || fronted) && isSubj(other)) start = advFrom;
        break;
      }
      if (!other && AUX.has(lowW(t.w))) {
        start = t.s;
        pos = t.s;
        continue;
      }
      if (other || MID_ADV.has(lowW(t.w)) || /^[a-z]+ly$/.test(lowW(t.w))) {
        pos = other ? Math.min(t.s, other._r.s) : t.s;
        advFrom = pos;
        continue;
      }
      break;
    }
    if (start !== null && start < v._r.s) {
      v._r = { s: start, e: v._r.e };
      for (const x of eat) merged.add(x.id);
    }
  }
  // 의문문·도치: 주어 바로 앞에 남은 be동사·조동사는 주어 밑줄에 넣어요
  for (const m of en) {
    if (!isSubj(m) || !['under', 'box'].includes(m.type || 'under') || merged.has(m.id)) continue;
    const t = wordBefore(s.en, m._r.s);
    if (!t || !AUX.has(lowW(t.w)) || coverOf(t, m)) continue;
    const first = !/[A-Za-z]/.test(s.en.slice(0, t.s));
    if (question || fronted || first) m._r = { s: t.s, e: m._r.e };
  }
  return merged;
}

// ------------------------------------------------------------ 2형식: 동사와 보어 한 동그라미
// 동사(V) 바로 뒤 주격 보어(C)가 3단어까지면 동사와 보어를 한 동그라미로 묶어요 ('~다'로 해석하니까).
// 3단어가 넘으면 묶지 않고, 보어는 괄호가 돼요. 목적격 보어(O.C)나 사이에 목적어가 있으면 묶지 않아요.
export function scPairs(s, style) {
  const pairOf = new Map(); // 동사 id -> 동그라미 범위
  const inPair = new Set(); // 동그라미에 들어간 보어 id
  if (!style.sc_circle || style.verb_mark !== 'circle') return { pairOf, inPair };
  const kind = (x) => x.type || 'under';
  const en = s.marks.filter((x) => x._on !== 'ko' && x._r && (kind(x) === 'under' || kind(x) === 'circle') && !(s._merged && s._merged.has(x.id)));
  for (const v of en) {
    if (!/^V'?$/.test(labOf(v))) continue;
    let c = null;
    for (const x of en) {
      if (x === v || kind(x) !== 'under' || inPair.has(x.id) || !SC_LAB.test(labOf(x)) || x._r.s < v._r.e) continue;
      if (!c || x._r.s < c._r.s) c = x;
    }
    if (!c || wordsOf(rangeText(s, c)) > 3) continue;
    const gap = s.en.slice(v._r.e, c._r.s);
    if (wordsOf(gap) > 2 || /[,;:.!?"“”()]/.test(gap)) continue;
    if (en.some((x) => x !== v && x !== c && x._r.s < c._r.s && x._r.e > v._r.e && CORE_LAB.test(labOf(x)))) continue;
    pairOf.set(v.id, { s: v._r.s, e: c._r.e });
    inPair.add(c.id);
  }
  return { pairOf, inPair };
}

// 동그라미는 동사에만: 동사가 아닌데 동그라미로 온 표시(접속부사·신호어 등)는 괄호로 그려요
function kindOf(m, style) {
  const k = m.type || 'under';
  if (k === 'circle' && m._on !== 'ko' && style.verb_mark === 'circle' && !isVerbLab(m)) return 'box';
  return k;
}
const isVerbCircle = (m, style) => m._on !== 'ko' && isVerbLab(m) && ((m.type || 'under') === 'circle' || ((m.type || 'under') === 'under' && style.verb_mark === 'circle'));

// 괄호 안에서는 사선만: 괄호(box, 또는 길어서 괄호가 되는 주어·목적어) 안에 들어간 밑줄·동그라미·괄호·세모는 그리지 않고,
// 사선은 괄호 안에 있을 때와 긴 주어 뒤에만 그려요. 메모·형광펜·화살표는 괄호 안에서도 그려요.
const INNER_HIDE = new Set(['under', 'circle', 'box', 'triangle']);
function parenRules(s, style) {
  const { inPair } = scPairs(s, style);
  const merged = s._merged || new Set();
  const parens = s.marks.filter((x) => {
    if (x._on === 'ko' || !x._r || inPair.has(x.id) || merged.has(x.id)) return false;
    const k = kindOf(x, style);
    const lb = labOf(x);
    return k === 'box' || (k === 'under' && CORE_LAB.test(lb) && style.long_paren && coreWords(s, x) >= (SC_LAB.test(lb) && style.sc_circle ? 4 : 3));
  });
  const len = (x) => x._r.e - x._r.s;
  const hidden = new Set(merged);
  for (const m of s.marks) {
    if (m._on === 'ko' || !m._r || !INNER_HIDE.has(kindOf(m, style))) continue;
    if (parens.some((x) => x !== m && x._r.s <= m._r.s && m._r.e <= x._r.e && len(x) > len(m))) hidden.add(m.id);
  }
  // 동사 동그라미(조동사·사이 부사까지) 안의 괄호·밑줄은 그리지 않아요: will (also) search → 한 동그라미
  const verbs = s.marks.filter((m) => m._r && !hidden.has(m.id) && isVerbCircle(m, style));
  for (const m of s.marks) {
    if (m._on === 'ko' || !m._r || hidden.has(m.id) || isVerbCircle(m, style) || !INNER_HIDE.has(kindOf(m, style))) continue;
    if (verbs.some((v) => v._r.s <= m._r.s && m._r.e <= v._r.e)) hidden.add(m.id);
  }
  const open = parens.filter((x) => !hidden.has(x.id));
  const slashes = new Set(s.marks.filter((m) => m.type === 'slash' && m._on !== 'ko' && m._r && open.some((x) => x._r.s < m._r.s && m._r.s < x._r.e)).map((m) => m.id));
  // 긴 주어 뒤 사선 (읽을 때 쉬는 곳): 괄호 밖이라도, 주절 주어부터 사선까지 5단어 이상이고
  // 사선 바로 뒤에 동사가 오면(사이 부사 2단어까지) 그려요
  const subjSlash = new Set();
  const live = s.marks.filter((m) => m._on !== 'ko' && m._r && !hidden.has(m.id));
  for (const m of s.marks) {
    if (m.type !== 'slash' || m._on === 'ko' || !m._r || slashes.has(m.id)) continue;
    const p = m._r.s;
    const subj = live.filter((x) => isSubj(x) && x._r.s < p).sort((a, b) => b._r.s - a._r.s)[0];
    if (!subj || subj._r.e > p) continue;
    const verb = live.filter((x) => isVerbLab(x) && !labOf(x).includes("'") && x._r.s >= p).sort((a, b) => a._r.s - b._r.s)[0];
    if (!verb || live.some((x) => isVerbLab(x) && x._r.s >= subj._r.s && x._r.s < p)) continue;
    if (wordsOf(s.en.slice(subj._r.s, p)) < 5 || wordsOf(s.en.slice(p, verb._r.s)) > 2) continue;
    slashes.add(m.id);
    subjSlash.add(m.id);
  }
  // 테두리가 있는 표시(괄호, 동그라미)의 범위: 바로 붙어 있으면 조금 띄워요
  const { pairOf } = scPairs(s, style);
  const rims = open.map((x) => x._r);
  for (const m of s.marks) {
    if (m._on === 'ko' || !m._r || hidden.has(m.id) || inPair.has(m.id) || open.includes(m)) continue;
    if (kindOf(m, style) === 'circle' || isVerbCircle(m, style)) rims.push(pairOf.get(m.id) || m._r);
  }
  return { hidden, slashes, subjSlash, open, rims };
}

// ------------------------------------------------------------ 데이터 다듬기
export function normalizeScript(input) {
  const s = typeof input === 'string' ? JSON.parse(input) : input || {};
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  let auto = 0;
  const sentences = (s.sentences || []).map((x, i) => ({
    n: Number(x.n) || i + 1,
    en: clean(x.en),
    ko: clean(x.ko),
    // 소제목: 이 문장 위에 따로 써요 (지문에 붙어 있던 제목)
    ...(clean(x.heading) ? { heading: clean(x.heading) } : {}),
    marks: (x.marks || []).filter(Boolean).map((m) => ({ ...m, id: String(m.id || `auto${++auto}`) })),
  }));
  const items = (arr, f) => (arr || []).filter(Boolean).map((x, i) => ({ ...f(x), id: String(x.id || `${f.name}${i + 1}`) }));
  return {
    ...s,
    title: clean(s.title),
    sentences,
    summary: items(s.summary, function sum(x) { return { k: clean(x.k), v: clean(x.v) }; }),
    memo: items(s.memo, function memo(x) { return { text: clean(x.text), tone: x.tone || 'red' }; }),
    // 단어: 유의어(syn)와 반의어(ant)는 1.4.0 엔진부터 (예전 대본에는 없어요)
    vocab: items(s.vocab, function voc(x) {
      const words = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, 3) : []);
      return { en: clean(x.en), ko: clean(x.ko), syn: words(x.syn), ant: words(x.ant) };
    }),
    // 변형 포인트: 이 지문이 시험에서 어떻게 변형돼 나올지 (1.4.0 엔진부터)
    exam: items(s.exam, function exam(x) { return { k: clean(x.k), text: clean(x.text), n: clean(x.n) }; }),
    flow: items(s.flow, function flow(x) { return { k: clean(x.k), text: clean(x.text), n: clean(x.n), hot: !!x.hot }; }),
    steps: (s.steps || []).filter(Boolean).map((st) => ({ ...st, view: st.view || 'sentence', say: String(st.say || ''), show: (st.show || []).map(String) })),
  };
}

// 자막: 말한 내용을 화면에 맞게 끊어요
export function captionChunks(text, max = 46) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?。…]+[.!?。…]*["')\]]*\s*/g) || [t];
  const out = [];
  for (let p of parts) {
    p = p.trim();
    while (p.length > max) {
      let cut = -1;
      for (const sep of [', ', ' - ', ' ']) {
        const i = p.lastIndexOf(sep, max);
        if (i > max * 0.45) {
          cut = i + sep.trimEnd().length;
          break;
        }
      }
      if (cut < 0) cut = max;
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

const isWordChar = (c) => !!c && /[A-Za-z0-9가-힣]/.test(c);
function findAll(hay, needle) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}
const normQ = (x) => x.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').toLowerCase();

export function resolveRange(text, needle, occ = 1) {
  let n = String(needle || '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  let pos = findAll(text, n);
  if (!pos.length) pos = findAll(normQ(text), normQ(n));
  if (!pos.length) {
    const n2 = n.replace(/^[\s,.;:!?"'()]+|[\s,.;:!?"'()]+$/g, '');
    if (n2 && n2 !== n) {
      n = n2;
      pos = findAll(normQ(text), normQ(n));
    }
  }
  if (!pos.length) return null;
  const whole = pos.filter((i) => !(isWordChar(n[0]) && isWordChar(text[i - 1])) && !(isWordChar(n[n.length - 1]) && isWordChar(text[i + n.length])));
  const list = whole.length ? whole : pos;
  const i = list[Math.min(list.length, Math.max(1, Number(occ) || 1)) - 1];
  return { s: i, e: i + n.length };
}

// ------------------------------------------------------------ DOM 도우미
function el(tag, attrs = {}, parent) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}
// 로고 둘레의 빈 여백(투명하거나 흰 곳)을 잘라 내요. 워터마크 크기가 로고 그림 자체의 크기가 되게요.
async function trimLogo(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] > 16 && !(d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244)) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0 || (x1 - x0 + 1 > w * 0.97 && y1 - y0 + 1 > h * 0.97)) return src;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch {
    return src; // 그림을 못 읽으면(다른 주소의 그림 등) 그대로 써요
  }
}
function showLogo(img, src) {
  return trimLogo(src).then((s) => {
    img.src = s;
    return img.decode();
  });
}

// PDF 워터마크: 쪽마다 A4 정중앙에, 한 변이 A4 세로의 절반(148.5mm)인 정사각형으로 흐리게 찍어요.
// scale 은 엔진이 PDF를 줄여 찍는 비율(판서노트 0.44)이라 그만큼 키워 두면 종이에서 148.5mm가 돼요.
export function printWatermark(src, scale = 1) {
  const old = document.getElementById('bd-pwater');
  if (old) old.remove();
  if (!src) return { el: null, ready: Promise.resolve() };
  const box = el('div', { id: 'bd-pwater', class: 'bd-pwater', 'aria-hidden': 'true' }, document.body);
  box.style.setProperty('--bd-wm', `${(148.5 / (Number(scale) > 0 ? Number(scale) : 1)).toFixed(2)}mm`);
  const img = el('img', { alt: '' }, box);
  const ready = Promise.race([showLogo(img, src).catch(() => box.remove()), new Promise((r) => setTimeout(r, 4000))]);
  return { el: box, ready };
}
function sv(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function fillTokens(container, text, ranges) {
  const cuts = new Set([0, text.length]);
  const re = /\s+/g;
  let m;
  while ((m = re.exec(text))) {
    cuts.add(m.index);
    cuts.add(m.index + m[0].length);
  }
  for (const r of ranges) {
    cuts.add(r.s);
    cuts.add(r.e);
  }
  const arr = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (a === b) continue;
    const seg = text.slice(a, b);
    if (/^\s+$/.test(seg)) container.appendChild(document.createTextNode(' '));
    else {
      const sp = document.createElement('span');
      sp.textContent = seg;
      sp.dataset.s = a;
      sp.dataset.e = b;
      container.appendChild(sp);
      spans.push(sp);
    }
  }
  return spans;
}

// ------------------------------------------------------------ 판서 만들기
export function mountBoard(host, input, opts = {}) {
  const mode = opts.mode || 'preview'; // preview | render | print
  const script = normalizeScript(input);
  const steps = script.steps;
  const header = opts.header || script.header || script.source || '';
  const timers = [];
  const cleanups = [];
  const marks = new Map(); // id -> [{ apply(t) }]
  const rows = new Map(); // id -> [row el]
  const problems = [];
  const state = { scroll: 0, scale: 1, cur: -1, reveal: new Map() };
  const style = normalizeStyle(opts.style);
  const hand = HANDS[style.hand];
  const PAL = { blue: style.colors.subject, red: style.colors.verb, green: style.colors.modifier, orange: style.colors.connector, purple: COLORS.purple, gray: COLORS.gray, navy: style.colors.accent };

  // 뼈대
  const view = el('div', { class: `bd-view${mode === 'print' ? ' bd-print' : ''}` });
  view.style.setProperty('--bd-hand', hand.family);
  view.style.setProperty('--bd-hand-weight', String(hand.weight));
  view.style.setProperty('--bd-row-size', `${hand.row}px`);
  view.style.setProperty('--bd-serif', style.en_font === 'sans' ? "'Pretendard Variable', Pretendard, sans-serif" : "'Noto Serif', Georgia, 'Times New Roman', serif");
  view.style.setProperty('--bd-navy', style.colors.accent);
  view.style.setProperty('--bd-hl', style.colors.highlight);
  const cam = el('div', { class: 'bd-cam' }, view);
  const paper = el('div', { class: 'bd-paper' }, cam);
  const head = el('div', { class: 'bd-head' }, paper);
  el('span', { class: 'sq' }, head);
  el('span', { text: header }, head);
  el('span', { class: 'ac', text: opts.academy || '' }, head);
  el('h1', { class: 'bd-title', text: script.title || '' }, paper);

  const sentEls = new Map();
  const lines = []; // { sent, which, spans, body }
  for (const s of script.sentences) {
    const blk = el('div', { class: 'bd-sent', 'data-n': s.n }, paper);
    if (s.heading) el('div', { class: 'bd-subhead', lang: 'en', text: s.heading }, blk);
    el('div', { class: 'bd-no', text: String(s.n) }, blk);
    const body = el('div', { class: 'bd-body' }, blk);
    const back = sv('svg', { class: 'bd-svg back' }, body);
    const en = el('div', { class: 'bd-en', lang: 'en' }, body);
    const ko = el('div', { class: 'bd-ko', lang: 'ko' }, body);
    const front = sv('svg', { class: 'bd-svg front' }, body);
    const ranges = { en: [], ko: [] };
    for (const m of s.marks) {
      const on = m.on === 'ko' ? 'ko' : 'en';
      const text = on === 'ko' ? s.ko : s.en;
      m._r = resolveRange(text, m.text, m.occ);
      m._on = on;
      if (!m._r) problems.push({ n: s.n, id: m.id, text: m.text, why: '문장에서 찾지 못했어요' });
      if (m.type === 'arrow') {
        m._r2 = resolveRange(text, m.to, m.to_occ);
        if (!m._r2) problems.push({ n: s.n, id: m.id, text: m.to, why: '화살표 끝을 찾지 못했어요' });
      }
    }
    // 해석 덩어리: 조동사·사이 부사까지 한 동그라미, 의문문의 앞 조동사는 주어와 함께
    s._merged = joinChunks(s);
    for (const m of s.marks) {
      if (m._r) ranges[m._on].push(m._r);
      if (m._r2) ranges[m._on].push(m._r2);
    }
    const enSpans = fillTokens(en, s.en, ranges.en);
    const koSpans = fillTokens(ko, s.ko, ranges.ko);
    // 사선 자리는 조금 띄워서 괄호와 겹치지 않게 해요
    const pr = parenRules(s, style);
    s._slash = pr.slashes;
    s._subjSlash = pr.subjSlash;
    s._hide = pr.hidden;
    // 닫는 괄호·동그라미 바로 뒤에 붙은 쉼표·마침표·물음표는 조금 띄워서 테두리에 가리지 않게 해요
    for (const r of pr.rims) {
      if (!/[^\s]/.test(s.en.charAt(r.e))) continue;
      const sp = enSpans.find((y) => +y.dataset.s === r.e);
      if (sp) sp.classList.add('pn-gap');
    }
    // 동그라미·괄호 테두리가 앞뒤 낱말에 닿지 않게 살짝 띄워요
    for (const r of pr.rims) {
      const a = enSpans.find((y) => +y.dataset.s === r.s);
      if (a && r.s > 0 && /\s/.test(s.en.charAt(r.s - 1))) a.classList.add('rm-gap');
      const b = enSpans.find((y) => +y.dataset.s >= r.e);
      if (b && /^\s+$/.test(s.en.slice(r.e, +b.dataset.s))) b.classList.add('rm-gap');
    }
    // 괄호·동그라미가 빈칸 하나(또는 쉼표 + 빈칸)를 사이에 두고 붙어 있으면 뒤쪽을 조금 띄워요
    for (const b of pr.rims) {
      if (!pr.rims.some((a) => a !== b && a.e <= b.s && /^[,;:]?\s+$/.test(s.en.slice(a.e, b.s)))) continue;
      const sp = enSpans.find((y) => +y.dataset.s === b.s);
      if (sp) sp.classList.add('mk-gap');
    }
    // 세모는 글자보다 넓게 그려져요: 앞뒤를 띄워 옆 괄호·동그라미와 겹치지 않게 해요
    if (style.conj_mark === 'triangle') {
      for (const m of s.marks) {
        if (m.type !== 'triangle' || m._on === 'ko' || !m._r || s._hide.has(m.id)) continue;
        const a = enSpans.find((y) => +y.dataset.s === m._r.s);
        const b = enSpans.find((y) => +y.dataset.s >= m._r.e);
        if (a) a.classList.add('tr-gap');
        if (b) b.classList.add('tr-gap2');
      }
    }
    for (const m of s.marks) {
      if (!s._slash.has(m.id)) continue;
      const sp = enSpans.find((x) => +x.dataset.s === m._r.s);
      // 긴 주어 뒤 사선은 바로 뒤 동그라미·괄호와 겹치지 않게 더 띄워요
      if (sp) sp.classList.add(s._subjSlash.has(m.id) ? 'sl-gap2' : 'sl-gap');
    }
    sentEls.set(s.n, { blk, body, back, front, en, ko, enSpans, koSpans, s });
    if (style.ko === 'step') {
      ko.classList.add('mk-fade');
      rows.set(`ko-${s.n}`, [ko]);
    }
  }

  // 메모 → 내용 정리 → 핵심 단어 순서로 아래에 붙여요
  const boxEls = {};
  const addBox = (key, cls, title, list, renderRow) => {
    if (!list.length) return;
    const box = el('div', { class: `bd-box ${cls}` }, paper);
    const h = el('h4', {}, box);
    h.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</svg>`;
    h.appendChild(document.createTextNode(title));
    const wrap = key === 'voc' ? el('div', { class: `grid ${list.length <= 5 ? 'one' : ''}` }, box) : box;
    for (const it of list) {
      const r = renderRow(it, wrap);
      rows.set(it.id, [...(rows.get(it.id) || []), r]);
    }
    boxEls[key] = box;
  };
  const textRow = (cls, text, p) => {
    const r = el('div', { class: cls }, p);
    el('span', { class: 'tx', text }, r);
    return r;
  };
  addBox('memo', 'bd-memo', '메모', script.memo, (it, p) => textRow(`bd-row ${it.tone !== 'red' ? it.tone : ''}`, it.text, p));
  addBox('sum', 'bd-sum', '내용 정리', script.summary, (it, p) => textRow('bd-row', it.k ? `${it.k}: ${it.v}` : it.v, p));
  // 글의 흐름: 단계 상자를 화살표로 이어 그려요
  const flowNodes = [];
  let flowWrap = null;
  let flowSvg = null;
  if (script.flow.length) {
    const box = el('div', { class: 'bd-box bd-flow' }, paper);
    const h = el('h4', {}, box);
    h.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON.flow}</svg>`;
    h.appendChild(document.createTextNode('글의 흐름'));
    flowWrap = el('div', { class: 'bd-fwrap', style: `--cols:${Math.min(4, script.flow.length)}` }, box);
    flowSvg = sv('svg', { class: 'bd-svg front' }, flowWrap);
    script.flow.forEach((it, i) => {
      const node = el('div', { class: `bd-fnode${it.hot ? ' hot' : ''}` }, flowWrap);
      const top = el('div', { class: 'k' }, node);
      el('span', { text: it.k || String(i + 1) }, top);
      if (it.n) el('span', { class: 'n', text: /^[0-9~\-–, ]+$/.test(it.n) ? `${it.n}번 문장` : it.n }, top);
      el('div', { class: 't', text: it.text }, node);
      flowNodes.push({ it, node });
    });
    boxEls.flow = box;
  }
  addBox('voc', 'bd-voc', '핵심 단어·구문', script.vocab, (it, p) => {
    const r = el('div', { class: 'bd-row' }, p);
    el('span', { class: 'w', text: it.en }, r);
    const m = el('span', { class: 'm' }, r);
    el('span', { text: it.ko }, m);
    // 유의어(=)와 반의어(↔)는 뜻 뒤에 작게
    if (it.syn.length) el('span', { class: 'sy', text: `= ${it.syn.join(', ')}` }, m);
    if (it.ant.length) el('span', { class: 'an', text: `↔ ${it.ant.join(', ')}` }, m);
    return r;
  });
  // 유의어·반의어가 있으면 단어 상자를 한 줄에 하나씩 넓게 써요
  if (boxEls.voc && script.vocab.some((x) => x.syn.length || x.ant.length)) {
    const g = boxEls.voc.querySelector('.grid');
    if (g) g.classList.add('one', 'wide');
  }
  // 변형 포인트: 유형 이름표, 무엇을 묻는지, 문장 번호
  addBox('exam', 'bd-exam', '변형 포인트', script.exam, (it, p) => {
    const r = el('div', { class: 'bd-row' }, p);
    el('span', it.k ? { class: 'k', text: it.k } : { class: 'k0' }, r); // 유형이 없어도 자리는 지켜요
    el('span', { class: 'tx', text: it.text }, r);
    // 문장 번호는 글에 'N번'이 없을 때만 오른쪽에 따로 적어요
    if (it.n && !/\d\s*번/.test(it.text)) el('span', { class: 'n', text: /^[0-9~\-–, ]+$/.test(it.n) ? `${it.n}번` : it.n }, r);
    return r;
  });

  let water = null;
  let pwater = null;
  let cap = null;
  let penEl = null;
  if (mode !== 'print') {
    penEl = el('div', { class: 'bd-pen' }, cam);
    penEl.innerHTML = PEN_SVG;
    if (opts.logo) {
      water = el('div', { class: 'bd-water' }, view);
      el('img', { alt: '' }, water);
    }
    cap = el('div', { class: 'bd-cap' }, view);
  } else if (opts.logo) {
    pwater = printWatermark(opts.logo, opts.pageScale);
    cleanups.push(() => pwater.el && pwater.el.remove());
  }

  // 미리보기는 같은 화면을 줄여서 보여 줘요
  let stage = null;
  let ro = null;
  if (mode === 'preview') {
    stage = el('div', { class: 'bd-stage' });
    stage.appendChild(view);
    host.appendChild(stage);
    const fit = () => {
      state.scale = stage.clientWidth / VW || 1;
      view.style.transform = `scale(${state.scale})`;
    };
    fit();
    ro = new ResizeObserver(fit);
    ro.observe(stage);
    // 휠·끌기로 판서를 위아래로 볼 수 있어요
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        view.classList.remove('anim');
        setScroll(state.scroll + e.deltaY / Math.max(0.2, state.scale));
      },
      { passive: false },
    );
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, s: state.scroll };
      view.classList.remove('anim');
    });
    const onMove = (e) => drag && setScroll(drag.s - (e.clientY - drag.y) / Math.max(0.2, state.scale));
    const onUp = () => (drag = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cleanups.push(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    });
  } else {
    host.appendChild(view);
    if (mode === 'print') {
      view.style.height = 'auto';
      view.style.width = '100%';
      view.style.overflow = 'visible';
      cam.style.position = 'static';
      cam.style.width = '100%';
    }
  }

  // ------------------------------------------------------------ 표시 그리기
  const handText = [
    ...script.sentences.flatMap((s) => s.marks.flatMap((m) => [m.label || '', m.note || ''])),
    ...script.summary.map((x) => `${x.k}${x.v}`),
    ...script.memo.map((x) => x.text),
    ...script.vocab.map((x) => `${x.en}${x.ko}${x.syn.join('')}${x.ant.join('')}=↔`),
    ...script.flow.map((x) => `${x.k}${x.text}${x.n}`),
    ...script.exam.map((x) => `${x.k}${x.text}${x.n}번`),
  ].join('');

  // 카메라(.bd-cam) 안에서의 위치
  function offsetIn(node, root) {
    let x = 0;
    let y = 0;
    let n = node;
    while (n && n !== root) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return { x, y };
  }
  const pens = new Map(); // id -> [(t) => {x, y, c} | null]
  // 한 표시 안의 선들을 길이 순서대로 차례차례 그리고, 이름표·메모는 뒤따라 나타나요
  function makeApply(strokes, fades, off, color) {
    const n = strokes.length;
    const S = n ? (fades.length ? 0.8 : 1) : 0;
    const lens = strokes.map((x) => (x.kind === 'path' ? x.L : x.w));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const spans = [];
    let acc = 0;
    for (const L of lens) {
      spans.push([(acc / total) * S, ((acc + L) / total) * S]);
      acc += L;
    }
    const local = (t, k) => {
      const [a, b] = spans[k];
      return b > a ? clamp01((t - a) / (b - a)) : t >= a ? 1 : 0;
    };
    const apply = (t) => {
      strokes.forEach((x, k) => {
        const u = local(t, k);
        if (x.kind === 'path') {
          x.el.style.visibility = u > 0 ? 'visible' : 'hidden';
          x.el.style.strokeDashoffset = String(x.L * (1 - u));
        } else x.el.setAttribute('width', String(x.w * u));
      });
      for (const f of fades) f.node.style.opacity = String(clamp01((t - f.from) / (f.to - f.from)));
    };
    const pen = (t) => {
      if (!(t > 0 && t < 1)) return null;
      for (let k = 0; k < n; k++) {
        const u = local(t, k);
        if (u > 0 && u < 1) {
          const x = strokes[k];
          if (x.kind === 'path') {
            const P = x.el.getPointAtLength(u * x.L);
            return { x: off.x + P.x, y: off.y + P.y, c: color };
          }
          return { x: off.x + x.x + x.w * u, y: off.y + x.y, c: color };
        }
      }
      return null;
    };
    const dur = Math.max(0.38, Math.min(0.95, 0.3 + total / 2600 + (fades.length ? 0.08 : 0)));
    return { apply, pen, dur };
  }
  const durs = new Map(); // id -> 그리는 시간(초)
  function revealDur(id) {
    if (durs.has(id)) return durs.get(id);
    for (const r of rows.get(id) || []) {
      const g = rowGeo.get(r);
      if (g) return Math.max(0.45, Math.min(1.25, 0.3 + g.txW / 1500));
    }
    return 0.45;
  }

  function geom(spans, r, body) {
    if (!r) return [];
    const o = body.getBoundingClientRect();
    const k = (state.scale || 1) * ((state.camera && state.camera.z) || 1);
    const sel = spans.filter((sp) => +sp.dataset.s >= r.s && +sp.dataset.e <= r.e);
    const out = [];
    for (const sp of sel) {
      const b = sp.getBoundingClientRect();
      const x = { l: (b.left - o.left) / k, r: (b.right - o.left) / k, t: (b.top - o.top) / k, b: (b.bottom - o.top) / k };
      const L = out.find((q) => Math.abs(q.t - x.t) < 14);
      if (L) {
        L.l = Math.min(L.l, x.l);
        L.r = Math.max(L.r, x.r);
        L.t = Math.min(L.t, x.t);
        L.b = Math.max(L.b, x.b);
      } else out.push({ ...x });
    }
    return out.sort((a, b) => a.t - b.t || a.l - b.l);
  }

  function drawMarks() {
    for (const [, E] of sentEls) {
      const { body, back, front, enSpans, koSpans, s } = E;
      back.innerHTML = '';
      front.innerHTML = '';
      const W = body.offsetWidth;
      const H = body.offsetHeight;
      for (const svg of [back, front]) {
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      }
      const labels = [];
      const notes = [];
      const off = offsetIn(body, cam);
      const { pairOf, inPair } = scPairs(s, style);
      for (const m of s.marks) {
        if (m.type === 'slash' && m._on !== 'ko' && !(s._slash && s._slash.has(m.id))) continue;
        if (s._hide && s._hide.has(m.id)) continue;
        const spans = m._on === 'ko' ? koSpans : enSpans;
        const own = geom(spans, m._r, body);
        const pair = pairOf.get(m.id);
        const segs = pair ? geom(spans, pair, body) : own;
        if (!segs.length) continue;
        let type = kindOf(m, style);
        const rawLab = String(m.label || '').trim();
        const isVerb = /^V/.test(rawLab);
        const isCore = CORE_LAB.test(rawLab);
        const nWords = coreWords(s, m);
        // 선생님 판서 스타일에 맞게 모양을 바꿔요
        if (type === 'under' && isVerb && style.verb_mark === 'circle' && m._on !== 'ko') type = 'circle';
        else if (inPair.has(m.id)) type = 'label'; // 동사 동그라미 안에 들어간 보어: 이름표와 메모만
        else if (type === 'under' && isCore && style.long_paren && nWords >= (SC_LAB.test(rawLab) && style.sc_circle ? 4 : 3) && m._on !== 'ko') type = 'box';
        if (type === 'triangle') {
          if (style.conj_mark === 'none') continue;
          if (style.conj_mark === 'circle') type = 'circle';
        }
        const showLab = style.labels === 'none' && (isVerb || isCore) ? '' : rawLab;
        const lab = style.labels === 'ko' && KO_LABELS[showLab] ? KO_LABELS[showLab] : showLab;
        const color = COLORS[m.color]
          ? m.color
          : isVerb
            ? 'red'
            : isCore
              ? 'blue'
              : type === 'box' || type === 'arrow'
                ? 'green'
                : type === 'circle' || type === 'triangle'
                  ? 'orange'
                  : type === 'note'
                    ? 'red'
                    : type === 'slash'
                      ? 'gray'
                      : 'blue';
        const c = type === 'note' && !m.color ? style.colors.note : PAL[color];
        const strokes = [];
        const fades = [];
        const addPath = (d, w, layer = front, extra = {}) => {
          const p = sv('path', { d, fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'mk-path', ...extra }, layer);
          const L = p.getTotalLength() || 1;
          p.style.strokeDasharray = `${L} ${L + 4}`;
          strokes.push({ el: p, kind: 'path', L });
          return p;
        };
        const addFade = (node, from = 0, to = 1) => {
          node.classList.add('mk-fade');
          fades.push({ node, from, to });
        };
        if (type === 'under') {
          for (const g of segs) addPath(`M${g.l} ${g.b + 1}H${g.r}`, 3.2);
        } else if (type === 'triangle') {
          // 세모: 절과 절을 잇는 등위접속사
          const g = segs[0];
          const cx = (g.l + g.r) / 2;
          const base = g.b + 5;
          const apex = g.t - 20;
          const half = (g.r - g.l) / 2 + 17;
          addPath(`M${cx - half} ${base}L${cx} ${apex}L${cx + half} ${base}Z`, 2.4);
        } else if (type === 'box' && (style.modifier === 'paren' || style.modifier === 'paren2')) {
          // 괄호형: 모두 ( ), 또는 구는 ( ) · 절은 [ ]
          const square = style.modifier === 'paren2' && /절|clause/i.test(rawLab);
          segs.forEach((g, k) => {
            const top = g.t - 2;
            const bot = g.b + 2;
            const mid = (top + bot) / 2;
            if (k === 0) addPath(square ? `M${g.l + 2} ${top}H${g.l - 6}V${bot}H${g.l + 2}` : `M${g.l + 1} ${top}Q${g.l - 11} ${mid} ${g.l + 1} ${bot}`, 2.6);
            if (k === segs.length - 1) addPath(square ? `M${g.r - 2} ${top}H${g.r + 6}V${bot}H${g.r - 2}` : `M${g.r - 1} ${top}Q${g.r + 11} ${mid} ${g.r - 1} ${bot}`, 2.6);
          });
        } else if (type === 'box' || type === 'circle') {
          for (const g of segs) {
            const pad = type === 'circle' ? 8 : 7;
            const x = g.l - pad;
            const y = g.t - 3;
            const w = g.r - g.l + pad * 2;
            const h = g.b - g.t + 6;
            const r = type === 'circle' ? h / 2 : 9;
            const fill = sv('path', { d: rrect(x, y, w, h, r), fill: type === 'box' && style.fill ? rgba(c, 0.065) : 'none', stroke: 'none' }, back);
            addFade(fill, 0, 0.6);
            addPath(rrect(x, y, w, h, r), 2.5);
          }
        } else if (type === 'hl') {
          for (const g of segs) {
            const w = g.r - g.l + 8;
            const hh = Math.max(8, g.b - g.t - 8);
            const rect = sv('rect', { x: g.l - 4, y: g.t + 5, width: 0, height: hh, rx: 5, fill: m.color && PAL[m.color] ? rgba(PAL[m.color], 0.28) : style.colors.highlight, class: 'mk-grow' }, back);
            strokes.push({ el: rect, kind: 'grow', w, x: g.l - 4, y: g.t + 5 + hh * 0.7 });
          }
        } else if (type === 'slash') {
          const g = segs[0];
          const dx = s._subjSlash && s._subjSlash.has(m.id) ? 13 : 0;
          addPath(`M${g.l - 3 - dx} ${g.t + 1}L${g.l - 14 - dx} ${g.b}`, 2.8);
        } else if (type === 'arrow') {
          const segs2 = geom(spans, m._r2, body);
          if (segs2.length) {
            const a = segs[0];
            const b = segs2[segs2.length - 1];
            const sameLine = Math.abs(a.t - b.t) < 14;
            let d;
            let head;
            if (sameLine) {
              const ax = b.r < a.l ? a.l + 16 : a.r - 16;
              const bx = b.r < a.l ? b.r - 16 : b.l + 16;
              const top = Math.min(a.t, b.t) - 22;
              d = `M${ax} ${a.t - 3}V${top}H${bx}V${b.t - 8}`;
              head = `M${bx - 7} ${b.t - 15}L${bx} ${b.t - 3}L${bx + 7} ${b.t - 15}Z`;
            } else if (b.t < a.t) {
              const ax = a.l + 16;
              const bx = (b.l + b.r) / 2;
              d = `M${ax} ${a.t - 3}C${ax} ${a.t - 40} ${bx} ${b.b + 40} ${bx} ${b.b + 10}`;
              head = `M${bx - 7} ${b.b + 17}L${bx} ${b.b + 4}L${bx + 7} ${b.b + 17}Z`;
            } else {
              const ax = (a.l + a.r) / 2;
              const bx = b.l + 16;
              d = `M${ax} ${a.b + 3}C${ax} ${a.b + 40} ${bx} ${b.t - 40} ${bx} ${b.t - 10}`;
              head = `M${bx - 7} ${b.t - 17}L${bx} ${b.t - 4}L${bx + 7} ${b.t - 17}Z`;
            }
            addPath(d, 2.4);
            const hp = sv('path', { d: head, fill: c, stroke: 'none' }, front);
            addFade(hp, 0.75, 1);
          }
        }
        // 아래 이름표 (S, V, O, 관계부사절 …)
        if (lab && type !== 'note') {
          const ls = own.length ? own : segs;
          const g = ls.reduce((p, q) => (q.r - q.l > p.r - p.l ? q : p), ls[0]);
          const sans = /^[A-Za-z.,'’()/0-9 ]{1,6}$/.test(lab) || (style.labels === 'ko' && Object.values(KO_LABELS).includes(lab));
          const tx = sv('text', { x: (g.l + g.r) / 2, y: g.b + 28, fill: c, 'font-size': sans ? 25 : hand.size, 'text-anchor': 'middle', class: sans ? 'sans' : '' }, front);
          tx.textContent = lab;
          addFade(tx, 0.45, 1);
          labels.push({ node: tx, line: Math.round(g.b), seg: g });
        }
        // 위쪽 메모 (remind A of B, Although ✕ …)
        const noteText = type === 'note' ? String(m.note || m.label || '') : String(m.note || '');
        if (noteText) {
          const g = own[0] || segs[0];
          const nc = type === 'note' ? c : m.note_color && PAL[m.note_color] ? PAL[m.note_color] : style.colors.note;
          // 세모 위 메모는 꼭짓점 위 가운데에 써요
          const tri = type === 'triangle';
          const tx = sv('text', { x: tri ? (g.l + g.r) / 2 : g.l - 2, y: tri ? g.t - 25 : g.t - 5, fill: nc, 'font-size': hand.size, 'text-anchor': tri ? 'middle' : 'start' }, front);
          tx.textContent = noteText;
          addFade(tx, type === 'note' ? 0 : 0.35, 1);
          notes.push({ node: tx, line: Math.round(g.t) });
        }
        const fx = makeApply(strokes, fades, off, type === 'hl' ? style.colors.accent : c);
        marks.set(m.id, [...(marks.get(m.id) || []), fx.apply]);
        pens.set(m.id, [...(pens.get(m.id) || []), fx.pen]);
        durs.set(m.id, Math.max(durs.get(m.id) || 0, fx.dur));
      }
      // 겹치는 글씨 살짝 비키기: 이름표(아래)를 먼저 자기 밑줄 범위 안에 놓고, 메모(위)는 옆으로 비켜 빈 곳을 찾아요
      const placed = [];
      const hitOf = (bb) => placed.find((p) => bb.y < p.y + p.height - 5 && p.y < bb.y + bb.height - 5 && bb.x < p.x + p.width + 6 && p.x < bb.x + bb.width + 6);
      labels.sort((a, b) => a.line - b.line || +a.node.getAttribute('x') - +b.node.getAttribute('x'));
      for (const it of labels) {
        let bb = it.node.getBBox();
        const g = it.seg;
        const half = bb.width / 2;
        const lo = g.l + half;
        const hi = g.r - half;
        const mid = (g.l + g.r) / 2;
        const cands = [mid];
        for (let d = 30; d < (g.r - g.l) / 2; d += 30) cands.push(mid - d, mid + d);
        let ok = false;
        for (const cx of cands.filter((x) => x >= lo - 1 && x <= hi + 1)) {
          it.node.setAttribute('x', String(cx));
          bb = it.node.getBBox();
          if (!hitOf(bb)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          it.node.setAttribute('x', String(mid));
          bb = it.node.getBBox();
        }
        placed.push(bb);
      }
      notes.sort((a, b) => a.line - b.line || +a.node.getAttribute('x') - +b.node.getAttribute('x'));
      for (const it of notes) {
        const x0 = +it.node.getAttribute('x');
        const y0 = +it.node.getAttribute('y');
        let bb = it.node.getBBox();
        if (hitOf(bb)) {
          let done = false;
          for (const dy of [0, -16, -30]) {
            for (const dx of [0, 24, 48, -24, 72, 96, -48, 130, 170]) {
              it.node.setAttribute('x', String(x0 + dx));
              it.node.setAttribute('y', String(y0 + dy));
              bb = it.node.getBBox();
              if (!hitOf(bb)) {
                done = true;
                break;
              }
            }
            if (done) break;
          }
          if (!done) {
            it.node.setAttribute('x', String(x0));
            it.node.setAttribute('y', String(y0 - 22));
            bb = it.node.getBBox();
          }
        }
        placed.push(bb);
      }
    }
    measureRows();
    drawFlow();
  }

  // 상자 줄: 왼쪽부터 손으로 쓰듯 나타나요
  const rowGeo = new Map(); // row el -> { off, txL, txW, w, y }
  function measureRows() {
    rowGeo.clear();
    for (const [, list] of rows) {
      for (const r of list) {
        if (r.classList.contains('bd-ko')) continue;
        const off = offsetIn(r, cam);
        const kids = [...r.children];
        let L = Infinity;
        let R = -Infinity;
        for (const k of kids.length ? kids : [r]) {
          L = Math.min(L, k.offsetLeft);
          R = Math.max(R, k.offsetLeft + k.offsetWidth);
        }
        if (!Number.isFinite(L)) {
          L = 0;
          R = r.offsetWidth;
        }
        const lh = parseFloat(getComputedStyle(r).lineHeight) || 40;
        rowGeo.set(r, { off, txL: L, txW: Math.max(1, R - L), w: r.offsetWidth, y: (parseFloat(getComputedStyle(r).paddingTop) || 0) + lh * 0.72 });
      }
    }
  }
  function rowColor(r) {
    return getComputedStyle(r.querySelector('.tx') || r).color;
  }

  function drawFlow() {
    if (!flowWrap || !flowNodes.length) return;
    flowSvg.innerHTML = '';
    const W = flowWrap.offsetWidth;
    const H = flowWrap.offsetHeight;
    flowSvg.setAttribute('width', W);
    flowSvg.setAttribute('height', H);
    flowSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const off = offsetIn(flowWrap, cam);
    const box = (n) => ({ l: n.offsetLeft, t: n.offsetTop, r: n.offsetLeft + n.offsetWidth, b: n.offsetTop + n.offsetHeight });
    flowNodes.forEach(({ it, node }, i) => {
      const g = box(node);
      const color = it.hot ? style.colors.verb : style.colors.accent;
      const strokes = [];
      const fades = [];
      const path = (d, w, col, extra = {}) => {
        const p = sv('path', { d, fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra }, flowSvg);
        const L = p.getTotalLength() || 1;
        p.style.strokeDasharray = `${L} ${L + 4}`;
        strokes.push({ el: p, kind: 'path', L });
        return p;
      };
      if (i > 0) {
        const a = box(flowNodes[i - 1].node);
        const ac = rgba(style.colors.accent, 0.55);
        let head;
        if (Math.abs(a.t - g.t) < 10) {
          const y = (g.t + g.b) / 2;
          path(`M${a.r + 10} ${y}H${g.l - 14}`, 3, ac);
          head = `M${g.l - 24} ${y - 9}L${g.l - 10} ${y}L${g.l - 24} ${y + 9}`;
        } else {
          const x1 = (a.l + a.r) / 2;
          const x2 = (g.l + g.r) / 2;
          const ym = (a.b + g.t) / 2;
          path(`M${x1} ${a.b + 8}V${ym}H${x2}V${g.t - 12}`, 3, ac);
          head = `M${x2 - 9} ${g.t - 24}L${x2} ${g.t - 10}L${x2 + 9} ${g.t - 24}`;
        }
        path(head, 3, ac);
      }
      path(rrect(g.l, g.t, g.r - g.l, g.b - g.t, 18), it.hot ? 3.4 : 2.6, color);
      node.classList.add('mk-fade');
      fades.push({ node, from: 0.55, to: 1 });
      const fx = makeApply(strokes, fades, off, color);
      marks.set(it.id, [fx.apply]);
      pens.set(it.id, [fx.pen]);
      durs.set(it.id, Math.max(0.7, Math.min(1.2, fx.dur + 0.25)));
    });
  }

  // ------------------------------------------------------------ 언제 무엇이 나타나는지
  const revealAt = new Map();
  steps.forEach((st, i) => st.show.forEach((id) => !revealAt.has(id) && revealAt.set(id, i)));
  const firstStep = (f) => {
    const i = steps.findIndex(f);
    return i >= 0 ? i : Math.max(0, steps.length - 1);
  };
  for (const s of script.sentences) for (const m of s.marks) if (!revealAt.has(m.id)) revealAt.set(m.id, firstStep((st) => st.view === 'sentence' && Number(st.n) === s.n));
  for (const it of script.summary) if (!revealAt.has(it.id)) revealAt.set(it.id, firstStep((st) => st.view === 'summary'));
  for (const it of script.memo) if (!revealAt.has(it.id)) revealAt.set(it.id, firstStep((st) => st.view === 'memo'));
  for (const it of script.vocab) if (!revealAt.has(it.id)) revealAt.set(it.id, firstStep((st) => st.view === 'vocab'));
  for (const it of script.flow) if (!revealAt.has(it.id)) revealAt.set(it.id, firstStep((st) => st.view === 'flow'));
  for (const it of script.exam) if (!revealAt.has(it.id)) revealAt.set(it.id, firstStep((st) => st.view === 'exam'));
  if (style.ko === 'step') for (const s of script.sentences) revealAt.set(`ko-${s.n}`, firstStep((st) => (st.view === 'sentence' || st.view === 'review') && Number(st.n) === s.n));

  const allIds = () => [...new Set([...marks.keys(), ...rows.keys(), ...script.flow.map((x) => x.id)])];
  let seq = 0;
  const started = new Map();
  function setReveal(id, t) {
    const before = state.reveal.get(id) || 0;
    if (t > 0 && !(before > 0)) started.set(id, ++seq);
    state.reveal.set(id, t);
    for (const f of marks.get(id) || []) f(t);
    for (const r of rows.get(id) || []) {
      const u = clamp01(t);
      const g = rowGeo.get(r);
      if (!g) {
        r.style.opacity = String(u);
        continue;
      }
      r.style.opacity = u > 0 ? '1' : '0';
      r.style.clipPath = u >= 1 ? 'none' : `inset(0 ${Math.max(0, g.w - (g.txL + g.txW * u)).toFixed(1)}px 0 0)`;
    }
  }
  function penFor(id, t) {
    for (const f of pens.get(id) || []) {
      const p = f(t);
      if (p) return p;
    }
    for (const r of rows.get(id) || []) {
      const g = rowGeo.get(r);
      if (g && t > 0 && t < 1) return { x: g.off.x + g.txL + g.txW * t, y: g.off.y + g.y, c: rowColor(r) };
    }
    return null;
  }
  // 지금 그리고 있는 표시 끝에 펜을 둬요 (가장 나중에 그리기 시작한 것)
  function syncPen() {
    if (!penEl) return;
    let best = null;
    for (const [id, t] of state.reveal) {
      if (t > 0 && t < 1) {
        const k = started.get(id) || 0;
        if (!best || k > best.k) best = { id, t, k };
      }
    }
    const p = best ? penFor(best.id, best.t) : null;
    if (p) {
      penEl.style.opacity = '1';
      penEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      penEl.style.setProperty('--pen-c', p.c);
    } else penEl.style.opacity = '0';
  }
  function revealOrder(i) {
    const st = steps[i];
    const listed = st ? st.show.filter((id) => revealAt.get(id) === i) : [];
    const rest = [...revealAt.entries()].filter(([id, si]) => si === i && !listed.includes(id)).map(([id]) => id);
    const kos = rest.filter((id) => id.startsWith('ko-'));
    return [...kos, ...listed, ...rest.filter((id) => !id.startsWith('ko-'))].filter((id) => marks.has(id) || rows.has(id));
  }
  function resetTo(i, upto = 'before') {
    for (const id of allIds()) {
      const si = revealAt.has(id) ? revealAt.get(id) : 0;
      setReveal(id, si < i || (upto === 'including' && si === i) ? 1 : 0);
    }
  }

  // ------------------------------------------------------------ 카메라 (확대·이동) {cx, cy, z}: 화면 가운데에 올 판서 위치와 배율
  const pageHeight = () => paper.offsetHeight;
  const maxScroll = () => Math.max(0, pageHeight() - VH);
  const CAP_ROOM = 0.74; // 아래 자막 자리를 비워 둬요
  function setCamera(c) {
    const z = Math.max(0.5, Math.min(2, Number(c.z) || 1));
    state.camera = { cx: c.cx, cy: c.cy, z };
    state.scroll = c.cy - VH / 2 / z;
    cam.style.transform = `translate(${(VW / 2 - z * c.cx).toFixed(2)}px, ${(VH / 2 - z * c.cy).toFixed(2)}px) scale(${z.toFixed(4)})`;
  }
  function setScroll(y) {
    const yy = Math.max(0, Math.min(maxScroll(), y));
    setCamera({ cx: VW / 2, cy: yy + VH / 2, z: 1 });
    state.scroll = yy;
  }
  function markTop(id) {
    for (const [, E] of sentEls) {
      const m = E.s.marks.find((x) => x.id === id);
      if (m) {
        const g = geom(m._on === 'ko' ? E.koSpans : E.enSpans, m._r, E.body)[0];
        if (g) return E.blk.offsetTop + E.body.offsetTop + g.t;
      }
    }
    return null;
  }
  // 문장 덩어리의 실제 글자 범위 (짧은 문장은 더 크게 확대해요)
  function sentRect(E) {
    const o = offsetIn(E.blk, cam);
    let R = 0;
    for (const sp of [...E.enSpans, ...E.koSpans]) R = Math.max(R, sp.offsetLeft + sp.offsetWidth);
    const bo = offsetIn(E.body, cam);
    const right = Math.max(bo.x + R + 40, o.x + 400);
    return { x: o.x - 10, y: o.y, w: right - (o.x - 10), h: E.blk.offsetHeight };
  }
  function fitRect(r, zMax) {
    const z = Math.max(1, Math.min(zMax, (VW * 0.94) / r.w, (VH * CAP_ROOM) / r.h));
    let cy;
    if (r.h * z <= VH * CAP_ROOM) cy = r.y + r.h / 2 + (VH / 2 - VH * 0.43) / z;
    else cy = r.y + (VH / 2 - 60) / z;
    const half = VH / 2 / z;
    cy = Math.max(half, Math.min(Math.max(half, pageHeight() - half), cy));
    let cx = r.x + r.w / 2;
    const hw = VW / 2 / z;
    cx = Math.max(hw, Math.min(VW - hw, cx));
    return { cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, z: Math.round(z * 1000) / 1000 };
  }
  function camFor(i) {
    const st = steps[i];
    const top = { cx: VW / 2, cy: VH / 2, z: 1, f: 0 };
    if (!st) return top;
    const n = Number(st.n);
    if ((st.view === 'sentence' || st.view === 'review') && sentEls.has(n)) {
      const E = sentEls.get(n);
      let r = sentRect(E);
      if (st.focus && markTop(st.focus) !== null && r.h * 1.0 > VH * CAP_ROOM) {
        const y = markTop(st.focus) - 120;
        r = { ...r, y, h: Math.min(r.h - (y - r.y), VH * 0.6) };
      }
      return { ...fitRect(r, 1.35), f: n };
    }
    const key = { summary: 'sum', memo: 'memo', vocab: 'voc', flow: 'flow', exam: 'exam' }[st.view];
    if (key && boxEls[key]) {
      const b = boxEls[key];
      const o = offsetIn(b, cam);
      return { ...fitRect({ x: o.x - 20, y: o.y - 20, w: b.offsetWidth + 40, h: b.offsetHeight + 40 }, 1.25), f: 0 };
    }
    return top;
  }
  function cameraFor(i) {
    const c = camFor(i);
    return Math.max(0, c.cy - VH / 2 / c.z);
  }
  // 설명하는 문장만 또렷하게, 나머지는 흐리게 (a → b 로 p 만큼 넘어가는 중)
  const DIM = 0.34;
  function setSpot(a, b, p = 1) {
    const lv = (f, n) => (!f ? 1 : f === n ? 1 : DIM);
    for (const [n, E] of sentEls) {
      const o = lv(a, n) + (lv(b, n) - lv(a, n)) * clamp01(p);
      E.blk.style.opacity = o >= 0.999 ? '' : o.toFixed(3);
    }
    state.spot = clamp01(p) >= 1 ? b : a;
  }
  const setCaption = (t) => cap && (cap.textContent = t || '');

  // ------------------------------------------------------------ 준비
  const ready = (async () => {
    if (document.fonts) {
      const ko = [script.title, header, opts.academy || '', ...script.sentences.map((s) => s.ko)].join('');
      const en = script.sentences.map((s) => s.en).join(' ');
      const loads = [
        document.fonts.load('400 31px "Noto Serif"', en || 'A'),
        document.fonts.load(`${hand.weight} ${hand.size}px ${hand.load}`, handText || '가A'),
        document.fonts.load(`400 ${hand.row}px ${hand.load}`, handText || '가A'),
        document.fonts.load('500 25px "Pretendard Variable"', '주동목보간직가진S V O C'),
        document.fonts.load(`400 31px ${style.en_font === 'sans' ? '"Pretendard Variable"' : '"Noto Serif"'}`, script.sentences.map((s) => s.en).join(' ') || 'A'),
        document.fonts.load('700 23px "Pretendard Variable"', '메모내용정리핵심단어구문'),
        document.fonts.load('500 29px "Pretendard Variable"', ko || '가'),
        document.fonts.load('800 35px "Pretendard Variable"', script.title || '가'),
        document.fonts.load('600 32px "Noto Serif"', script.sentences.map((s) => s.heading || '').join(' ') || 'A'),
      ].map((p) => p.catch(() => null));
      await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 6000))]);
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
    }
    if (water) {
      const img = water.querySelector('img');
      await Promise.race([showLogo(img, opts.logo).catch(() => water.remove()), new Promise((r) => setTimeout(r, 4000))]);
    }
    if (pwater) await pwater.ready;
    drawMarks();
    if (mode === 'print') resetTo(steps.length + 1);
    else resetTo(0);
    return api;
  })();

  let raf = 0;
  function animate(list) {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const tick = (nowT) => {
      let more = false;
      for (const a of list) {
        const u = (nowT - t0 - a.at) / a.dur;
        if (u < 0) {
          more = true;
          continue;
        }
        setReveal(a.id, Math.min(1, u));
        if (u < 1) more = true;
      }
      syncPen();
      if (more) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function showStep(i, say) {
    timers.splice(0).forEach(clearTimeout);
    cancelAnimationFrame(raf);
    state.cur = i;
    view.classList.remove('anim');
    resetTo(i);
    syncPen();
    void view.offsetWidth;
    view.classList.add('anim');
    const c = camFor(i);
    setCamera(c);
    setSpot(c.f, c.f, 1);
    const st = steps[i];
    setCaption(st ? captionChunks(cleanSay(say !== undefined ? say : st.say))[0] || '' : '');
    let at = 700;
    animate(
      revealOrder(i).map((id) => {
        const d = revealDur(id) * 1000;
        const a = { id, at, dur: d };
        at += Math.max(380, d * 0.85) + 160;
        return a;
      }),
    );
  }

  function destroy() {
    timers.splice(0).forEach(clearTimeout);
    cancelAnimationFrame(raf);
    cleanups.splice(0).forEach((f) => f());
    if (ro) ro.disconnect();
    (stage || view).remove();
  }

  const api = {
    ready,
    view,
    script,
    style,
    steps,
    problems,
    revealAt,
    showStep,
    setReveal,
    revealOrder,
    resetTo,
    setScroll,
    setCamera,
    camFor,
    cameraFor,
    setSpot,
    syncPen,
    revealDur,
    setCaption,
    pageHeight,
    maxScroll,
    destroy,
    get scroll() {
      return state.scroll;
    },
    get camera() {
      return state.camera || { cx: VW / 2, cy: VH / 2, z: 1 };
    },
  };
  return api;
}
