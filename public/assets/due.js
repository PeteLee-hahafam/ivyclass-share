// 마감 고르기 (과제 내기, 시험 내기 창이 같이 써요)
import { html, fmtDate } from './ui.js';

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysLater = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const endOfDay = (s) => Math.floor(new Date(`${s}T23:59:00`).getTime() / 1000);

export function DuePicker({ due, setDue, noDue, setNoDue, quick = [[1, '내일'], [3, '3일 뒤'], [7, '1주 뒤'], [14, '2주 뒤']] }) {
  return html`<div class="field"><label>마감</label>
    <div class="pick-row">${quick.map(([n, label]) => {
      const v = daysLater(n);
      return html`<button type="button" class=${`pick ${!noDue && due === v ? 'on' : ''}`} onClick=${() => { setNoDue(false); setDue(v); }}>${label}</button>`;
    })}<button type="button" class=${`pick ${noDue ? 'on' : ''}`} onClick=${() => setNoDue(true)}>마감 없음</button></div>
    ${!noDue && html`<div class="row wrap" style="margin-top:6px;gap:10px"><input type="date" class="input" value=${due} onInput=${(e) => setDue(e.target.value)} style="max-width:190px" aria-label="마감일" />
      ${due && html`<span class="muted" style="font-size:13.5px">${fmtDate(endOfDay(due))} 밤 11시 59분까지</span>`}</div>`}
  </div>`;
}
