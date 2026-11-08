// Regen-Warner: die nächsten 2 Stunden in 15-Minuten-Schritten (Open-Meteo Nowcast, sonst Stundenwerte).
import { pad } from './util.js';

const STEP = 15 * 60000, N = 8; // 8 Balken = 2 Std
export const level = (p) => (p < 0.1 ? 0 : p < 2.5 ? 1 : p < 7.6 ? 2 : 3);
const NAMES = ['trocken', 'leichter Regen', 'mäßiger Regen', 'starker Regen'];
const dur = (min) => (min >= 90 ? `${Math.floor(min / 60)} Std${min % 60 ? ` ${min % 60} Min` : ''}` : `${min} Min`);

export function nowcast(m, now = Date.now()) {
  const t0 = Math.floor(now / STEP) * STEP;
  const bars = [];
  for (let i = 0; i < N; i++) {
    const t = t0 + i * STEP;
    const q = m.min15.find((x) => x.t === t);
    let p = q ? q.p : null;
    if (p == null) { const h = m.hours.find((x) => x.t <= t && t < x.t + 3600000); p = h ? h.precip || 0 : 0; }
    bars.push({ t, p, lv: level(p) });
  }
  const mins = (b) => Math.max(0, Math.round((b.t - now) / 60000));
  let title, sub = '';
  if (bars[0].lv) {
    const dry = bars.findIndex((b) => !b.lv);
    title = NAMES[Math.max(...bars.slice(0, dry < 0 ? N : dry).map((b) => b.lv))].replace(/^./, (c) => c.toUpperCase());
    sub = dry < 0 ? 'Der Regen hält mindestens 2 Std an' : `Regen endet in ca. ${dur(Math.max(5, mins(bars[dry])))}`;
  } else {
    const wet = bars.findIndex((b) => b.lv);
    if (wet < 0) { title = 'Trocken'; sub = 'In den nächsten 2 Std kommt kein Regen'; }
    else {
      const m1 = mins(bars[wet]);
      const end = bars.findIndex((b, i) => i > wet && !b.lv);
      const len = ((end < 0 ? N : end) - wet) * 15;
      title = m1 <= 5 ? 'Gleich Regen' : `Regen in ${dur(m1)}`;
      sub = `${NAMES[Math.max(...bars.slice(wet, end < 0 ? N : end).map((b) => b.lv))].replace(/^./, (c) => c.toUpperCase())}, ${end < 0 ? 'länger als ' : 'ca. '}${dur(len)}`;
    }
  }
  return { title, sub, bars, wet: bars.some((b) => b.lv) };
}

export function nowcastHTML(nc, off, parts) {
  const hmax = 8; // mm/h für volle Höhe
  const lab = (b, i) => { if (i % 2) return ''; const p = parts(b.t, off); return `${pad(p.h)}:${pad(p.mi)}`; };
  return `<div class="nc-head"><div><b class="nc-title ${nc.wet ? 'wet' : ''}">${nc.title}</b><div class="muted small">${nc.sub}</div></div></div>
  <div class="nc-bars" role="img" aria-label="Regen in den nächsten 2 Stunden: ${nc.title}">${nc.bars.map((b, i) => {
    const h = b.lv ? Math.max(14, Math.round(Math.sqrt(Math.min(b.p, hmax) / hmax) * 100)) : 0;
    const p = parts(b.t, off);
    return `<div class="nc-col"><div class="nc-bar lv${b.lv}" style="height:${h}%" title="${pad(p.h)}:${pad(p.mi)} Uhr, ${b.p.toFixed(1).replace('.', ',')} mm/h"></div><span class="nc-lab mono">${lab(b, i)}</span></div>`;
  }).join('')}</div>`;
}
