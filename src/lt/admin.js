// 선생님 결과 화면에 넣는 자세한 기록: 영역별 문항 기록, 시험 경로, 라이팅 채점 칸
// 정답과 해설이 들어 있어서 선생님 API(/api/admin/lt/:id)로만 보내요.
import {
  LT_LEVELS, LT_BANK, LT_VBANDS, LT_SKILLS, LT_MODNAME, LT_RUBRIC,
  ltEsc, ltLvShort, ltPathSVG, ltSkillHTML, ltVocBars, ltLadderSVG, ltIdxTiles, ltModLine, ltTimeStats, ltCmp,
  ltReadLimits, ltFK, ltClock, ltWords,
} from './core.js';

const MARK = ['①', '②', '③', '④', '⑤'];

function optText(opts, k) {
  const o = opts && opts[k];
  if (o == null) return '';
  if (typeof o !== 'string') return `그림 ${k + 1}`;
  return /^[①-⑤]$/.test(o) ? o : `${MARK[k]} ${o}`;
}
function pickText(opts, p) {
  if (p === -1) return '잘 모르겠어요';
  if (p === -2) return '시간 초과';
  if (p == null || p < 0) return '답 없음';
  return optText(opts, p);
}
const secs = (ms) => `${Math.round((Number(ms) || 0) / 1000)}초`;
const mark = (ok) => `<td class="${ok ? 'ok' : 'no'}">${ok ? '○' : '×'}</td>`;

function vocLog(m) {
  const rows = m.items
    .map((x) => {
      const B = LT_VBANDS[x.band - 1];
      const pick = x.pick === -1 ? '잘 모르겠어요' : x.pick === -2 ? '시간 초과' : x.pick == null || x.pick < 0 ? '답 없음' : ltEsc(x.opts[x.pick]);
      return `<tr><td lang="en"><b>${ltEsc(x.en)}</b></td><td class="num">${B.from.toLocaleString()}~${B.to.toLocaleString()}</td>${mark(x.ok)}<td>${pick}${x.ok ? '' : ` <span class="to">→ ${ltEsc(x.ko)}</span>`}</td><td class="num">${secs(x.t)}</td></tr>`;
    })
    .join('');
  return `<div class="tblwrap"><table class="itemlog"><thead><tr><th>낱말</th><th>자주 쓰는 순서</th><th>결과</th><th>고른 뜻</th><th>시간</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function levelLog(mod, m) {
  const rows = m.items
    .map((x) => {
      const pick = pickText(x.opts, x.pick);
      return `<tr><td>${LT_LEVELS[x.level].short}</td><td>${ltEsc(x.pt || '')}</td>${mark(x.ok)}<td>${ltEsc(pick)}${x.ok ? '' : ` <span class="to">→ ${ltEsc(optText(x.opts, x.a))}</span>`}${x.why ? `<small>${ltEsc(x.why)}</small>` : ''}</td><td class="num">${secs(x.t)} / ${x.limit}초</td></tr>`;
    })
    .join('');
  return `<div class="tblwrap"><table class="itemlog"><thead><tr><th>단계</th><th>${mod === 'gram' ? '문법' : '유형'}</th><th>결과</th><th>고른 답</th><th>시간 / 제한</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function points(m, okName, noName) {
  return `<div class="rp-pts"><div><em>${okName}</em>${m.known.map((p) => `<span class="pt ok">${ltEsc(p)}</span>`).join('') || '<span class="pt">-</span>'}</div><div><em>${noName}</em>${m.weak.map((p) => `<span class="pt no">${ltEsc(p)}</span>`).join('') || '<span class="pt">없음</span>'}</div></div>`;
}

function readPanel(m) {
  const log = m.steps
    .map((s, si) => {
      const b = LT_BANK[s.level];
      const lims = ltReadLimits(s.level);
      const items = b.items
        .map((it, i) => {
          const ok = s.correct[i];
          const p = s.answers[i];
          return `<li><span class="mark ${ok ? 'ok' : 'no'}">${ok ? '○' : '×'}</span><span class="iq">${ltEsc(it.q)}<span class="sk">${LT_SKILLS[it.skill].name}</span></span><span class="ia">고른 답 ${ltEsc(pickText(it.opts, p))}${ok ? '' : `, 정답 ${ltEsc(optText(it.opts, it.a))}`}, 제한 ${lims[i]}초</span><span class="iw">${ltEsc(it.why)}</span></li>`;
        })
        .join('');
      const words = ltWords(b.passage);
      const meta = [words ? `${words}단어` : '', words ? `FK ${ltFK(b.passage)}` : '', ltClock(s.ms)].filter(Boolean).join(', ');
      return `<details><summary><span class="lv">지문 ${si + 1}, ${LT_LEVELS[s.level].short}</span><span class="tt">${ltEsc(b.title)}</span><span class="meta num">${meta}</span><span class="sc ${s.pass ? 'ok' : 'no'}">${s.score}/3 ${s.pass ? '통과' : '통과 못 함'}</span></summary><ul class="items">${items}</ul></details>`;
    })
    .join('');
  return `<div class="res-path"><div class="pw">${ltPathSVG(m.steps, m.result, m.G, true)}</div><div class="pn">${ltPathSVG(m.steps, m.result, m.G)}</div></div>
    <p class="rp-legend2"><span><i class="lg-ok"></i>통과</span><span><i class="lg-no"></i>통과 못 함</span><span><i class="lg-band"></i>레벨</span><span><i class="lg-grade"></i>지금 학년</span></p>
    <div class="rp-skills">${ltSkillHTML(m)}</div>
    <div class="steps-log">${log}</div>`;
}

// 라이팅: 화면(Preact)이 점수 칸을 그릴 수 있게 문항과 답, 점수를 그대로 보내요
function writeData(a, state) {
  const m = a.mods.write;
  const w = state.res.write;
  const sc = w.scoring || null;
  return {
    tier: m.tier,
    tier_name: m.tierName,
    level: m.level,
    level_short: m.level != null ? ltLvShort(m.level) : null,
    by: sc ? sc.by || '' : '',
    model: sc ? sc.model || '' : '',
    rubric: LT_RUBRIC.map((k) => ({ key: k.key, name: k.name, d5: k.d5, d3: k.d3, d1: k.d1 })),
    essay: sc && sc.essay ? sc.essay : {},
    rows: m.rows.map((row) => {
      const it = row.it;
      const base = { id: it.id, kind: it.kind, q: it.q, ko: it.ko || '', ans: row.ans || '', time: Math.round(((w.times || {})[it.id] || 0) / 1000), limit: it.time };
      if (row.auto) return { ...base, auto: true, ok: !!row.ok, answer: it.answer[0] };
      if (it.kind === 'cond') {
        return { ...base, cond: it.cond || [], model: it.model || '', need: row.check.need, words: row.check.words, points: row.score ? row.score.points : null, corrected: row.score ? row.score.corrected || '' : '', note: row.score ? row.score.note || '' : '' };
      }
      return { ...base, words: row.words, range: it.words || null };
    }),
  };
}

// 선생님 결과 화면 한 장에 들어갈 것
export function ltAdminDetail(a, state) {
  const ts = ltTimeStats(a);
  const ov = a.overall || { level: 0, cefr: '-', value: null };
  const panels = {};
  for (const k of a.order) {
    const m = a.mods[k];
    if (k === 'read') panels.read = readPanel(m);
    else if (k === 'voc') panels.voc = `<p class="rp-sub">아는 낱말 약 <b>${m.size.toLocaleString()}개</b>, ${ltLvShort(m.level)} 수준, CEFR ${m.cefr}</p>${ltVocBars(m)}${vocLog(m)}`;
    else if (k === 'gram') panels.gram = points(m, '아는 문법', '다질 문법') + levelLog('gram', m);
    else if (k === 'listen') panels.listen = points(m, '잘 들은 것', '놓친 것') + levelLog('listen', m);
  }
  return {
    overall: {
      level: ov.level,
      short: ov.level > 0 ? LT_LEVELS[ov.level].short : '시작',
      name: ov.level > 0 ? `${LT_LEVELS[ov.level].name} 수준` : '기초부터 시작해요',
      cmp: ltCmp(ov.level - a.G),
      cefr: ov.cefr,
      value: ov.value,
    },
    idx: ltIdxTiles(a),
    ladder: `<div class="pw">${ltLadderSVG(a, true)}</div><div class="pn">${ltLadderSVG(a, false)}</div>`,
    mods: a.order.map((k) => ({ key: k, name: LT_MODNAME[k], level: a.mods[k].level, short: a.mods[k].level == null ? '채점 전' : ltLvShort(a.mods[k].level), cefr: a.mods[k].cefr || '', line: ltModLine(k, a.mods[k], a) })),
    time: { n: ts.n, over: ts.over, avg: ts.avg != null ? Math.round(ts.avg * 100) : null },
    panels,
    write: a.mods.write ? writeData(a, state) : null,
    books: Object.fromEntries(a.order.map((k) => [k, a.books[k] ? a.books[k].name : ''])),
  };
}
