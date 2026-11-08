// Tagesseite: Stundenwerte, Temperatur, Regen, Wind und Sonne für einen Tag.
import { esc, de, deg, pad, parts, fmtTime, dayKey, dowOfKey, WD_LANG, compass, isNum } from './util.js';
import { icon, iconSvg, wmoText } from './wmo.js';
import { tempColor } from './charts.js';

const W = 340, L = 30, R = 8;
const xOf = (t, t0) => L + ((t - t0) / 86400000) * (W - L - R);
const axis = (t0, off, H) => [0, 6, 12, 18, 24].map((h) => { const x = xOf(t0 + h * 3600000, t0); return `<line x1="${x}" x2="${x}" y1="6" y2="${H - 18}" class="ax"/><text x="${x}" y="${H - 4}" text-anchor="middle" class="al">${pad(h % 24)}</text>`; }).join('');
const nightBands = (hs, t0, H) => hs.filter((h) => !h.isDay).map((h) => `<rect x="${xOf(h.t, t0) - 0.5}" y="6" width="${(W - L - R) / 24 + 1}" height="${H - 24}" class="night"/>`).join('');

function tempChart(hs, t0, off, dark) {
  const H = 150, vals = hs.flatMap((h) => [h.temp, h.feels]).filter(isNum);
  if (!vals.length) return '';
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1), y = (v) => 10 + (1 - (v - lo) / (hi - lo || 1)) * (H - 34);
  const line = (k) => hs.filter((h) => isNum(h[k])).map((h, i) => `${i ? 'L' : 'M'}${xOf(h.t, t0).toFixed(1)} ${y(h[k]).toFixed(1)}`).join('');
  const mx = hs.reduce((a, h) => (h.temp > a.temp ? h : a)), mn = hs.reduce((a, h) => (h.temp < a.temp ? h : a));
  const lab = (h) => `<circle cx="${xOf(h.t, t0)}" cy="${y(h.temp)}" r="3.5" fill="${tempColor(h.temp, dark)}"/><text x="${clampX(xOf(h.t, t0))}" y="${y(h.temp) + (h === mx ? -8 : 15)}" text-anchor="middle" class="tl" style="fill:${tempColor(h.temp, dark)}">${deg(h.temp)}</text>`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi].map((v) => `<text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" class="al">${v}°</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="dc" role="img" aria-label="Temperaturverlauf">${nightBands(hs, t0, H)}${axis(t0, off, H)}${ticks}<path d="${line('feels')}" class="feels"/><path d="${line('temp')}" class="tline"/>${lab(mx)}${mn !== mx ? lab(mn) : ''}</svg>`;
}
const clampX = (x) => Math.min(W - 16, Math.max(L + 10, x));

function rainChart(hs, t0, off) {
  const H = 100, max = Math.max(2, ...hs.map((h) => h.precip || 0)), bw = Math.max(3, (W - L - R) / 24 - 2);
  const bars = hs.map((h) => { const v = h.precip || 0, bh = v > 0 ? Math.max(2, (v / max) * (H - 34)) : 0; return `<rect x="${xOf(h.t, t0) + 1}" y="${H - 18 - bh}" width="${bw}" height="${bh}" rx="2" class="rbar"><title>${pad(parts(h.t, off).h)}:00 · ${de(v, 1)} mm</title></rect>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="dc" role="img" aria-label="Regen">${axis(t0, off, H)}<text x="${L - 4}" y="${H - 18 - (H - 34) + 4}" text-anchor="end" class="al">${de(max, max < 10 ? 1 : 0)}</text>${bars}</svg>`;
}

function windChart(hs, t0, off) {
  const H = 120, max = Math.max(20, ...hs.map((h) => h.gust ?? h.wind ?? 0)), y = (v) => 10 + (1 - v / max) * (H - 34);
  const path = (k) => hs.filter((h) => isNum(h[k])).map((h, i) => `${i ? 'L' : 'M'}${xOf(h.t, t0).toFixed(1)} ${y(h[k]).toFixed(1)}`).join('');
  const arrows = hs.filter((h, i) => i % 3 === 0 && isNum(h.dir) && isNum(h.wind)).map((h) => `<g transform="translate(${xOf(h.t, t0)} ${H - 30}) rotate(${(h.dir + 180) % 360})"><path d="M0-7L4 5H-4z" class="arr"/></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="dc" role="img" aria-label="Wind">${axis(t0, off, H)}<text x="${L - 4}" y="14" text-anchor="end" class="al">${Math.round(max)}</text><path d="${path('gust')}" class="gust"/><path d="${path('wind')}" class="wline"/>${arrows}</svg><p class="muted small">Linie: Wind, gestrichelt: Böen, in km/h. Pfeile zeigen, wohin der Wind weht.</p>`;
}

function sunArc(d, off) {
  if (!d.sunrise || !d.sunset) return '';
  const now = Date.now(), f = Math.min(1, Math.max(0, (now - d.sunrise) / (d.sunset - d.sunrise))), isToday = dayKey(now, off) === d.key;
  const a = Math.PI * (1 - f), cx = 170 + 140 * Math.cos(a), cy = 100 - 80 * Math.sin(a);
  const len = Math.round((d.sunset - d.sunrise) / 60000), h = Math.floor(len / 60), m = len % 60;
  return `<svg viewBox="0 0 340 130" class="dc" role="img" aria-label="Sonnenstand"><path d="M30 100A140 80 0 0 1 310 100" class="arc"/><line x1="10" x2="330" y1="100" y2="100" class="ax"/>${isToday && now > d.sunrise && now < d.sunset ? `<circle cx="${cx}" cy="${cy}" r="9" fill="#ffc83a"/>` : ''}<text x="30" y="120" class="al" text-anchor="middle">${fmtTime(d.sunrise, off)}</text><text x="310" y="120" class="al" text-anchor="middle">${fmtTime(d.sunset, off)}</text><text x="170" y="92" class="tl" text-anchor="middle" style="fill:var(--ink)">${h} Std ${m} Min</text></svg>`;
}

export function openDay(m, i, dark) {
  const d = m.days[i]; if (!d) return;
  const t0 = d.t0, off = m.off;
  const src = (m.hourly && m.hourly.length ? m.hourly : [...m.past, ...m.hours]);
  const hs = src.filter((h) => dayKey(h.t, off) === d.key && isNum(h.temp)).sort((a, b) => a.t - b.t);
  const dow = dowOfKey(d.key), [, mo, da] = d.key.split('-').map(Number);
  const name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WD_LANG[dow];
  const sum = hs.reduce((s, h) => s + (h.precip || 0), 0);
  const el = document.createElement('div');
  el.className = 'page'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', `Tagesdetails ${name}`);
  const rows = hs.map((h) => { const p = parts(h.t, off); return `<tr><td class="mono">${pad(p.h)}:00</td><td>${icon(h.code, h.isDay, 24)}</td><td class="mono"><b style="color:${tempColor(h.temp, dark)}">${deg(h.temp)}</b></td><td class="mono muted">${deg(h.feels)}</td><td class="mono">${(h.precip || 0) >= 0.1 ? `${de(h.precip, 1)} mm` : ''}</td><td class="mono">${isNum(h.wind) ? `${de(h.wind)}${isNum(h.gust) && h.gust > h.wind + 5 ? `<span class="muted"> / ${de(h.gust)}</span>` : ''} ${isNum(h.dir) ? `<span class="muted">${compass(h.dir)}</span>` : ''}` : ''}</td></tr>`; }).join('');
  el.innerHTML = `<div class="page-in">
    <header class="page-head"><button class="ibtn" data-close aria-label="Zurück">←</button><div><h1>${name}</h1><div class="muted">${WD_LANG[dow]}, ${da}.${mo}.</div></div></header>
    <section class="card"><div class="dsum">${icon(d.code ?? 3, true, 56)}<div><div class="dcond">${esc(wmoText(d.code ?? 3, true))}</div><div class="mono"><b style="color:${tempColor(d.tmax, dark)}">${deg(d.tmax)}</b> <span style="color:${tempColor(d.tmin, dark)}">${deg(d.tmin)}</span></div></div></div>
      <div class="dstats"><div><span class="muted small">Regen</span><b class="mono">${de(isNum(d.precip) ? d.precip : sum, 1)} mm</b></div><div><span class="muted small">Böen bis</span><b class="mono">${isNum(d.gust) ? de(d.gust) : '–'} km/h</b></div><div><span class="muted small">Regenchance</span><b class="mono">${d.ens?.regenChance != null ? `${de(d.ens.regenChance * 100)} %` : '–'}</b></div></div></section>
    ${hs.length ? `<section class="card"><div class="card-head"><h2>Temperatur</h2><span class="tag mono">gestrichelt: gefühlt</span></div>${tempChart(hs, t0, off, dark)}</section>
    <section class="card"><div class="card-head"><h2>Regen</h2><span class="tag mono">mm pro Stunde</span></div>${rainChart(hs, t0, off)}</section>
    <section class="card"><div class="card-head"><h2>Wind</h2></div>${windChart(hs, t0, off)}</section>` : '<section class="card"><p class="muted">Für diesen Tag gibt es keine Stundenwerte.</p></section>'}
    <section class="card"><div class="card-head"><h2>Sonne</h2></div>${sunArc(d, off) || '<p class="muted">Keine Sonnenzeiten vorhanden.</p>'}</section>
    ${hs.length ? `<section class="card"><div class="card-head"><h2>Stunde für Stunde</h2></div><div class="tw"><table class="htab"><thead><tr><th>Zeit</th><th></th><th>Temp.</th><th>Gefühlt</th><th>Regen</th><th>Wind / Böen</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : ''}
    <p class="muted small" style="padding:4px 4px 24px">${d.src === 'ICON-D2' ? 'Modell: DWD ICON-D2' : 'Modell: ECMWF IFS'}${m.mosmixStation ? ` · Temperatur und Wind teils DWD MOSMIX, Station ${esc(m.mosmixStation.name)}` : ''}</p>
  </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('noscroll');
  let closed = false, pushed = false;
  const close = (fromPop) => { if (closed) return; closed = true; el.remove(); document.documentElement.classList.remove('noscroll'); window.removeEventListener('popstate', pop); document.removeEventListener('keydown', key); if (!fromPop && pushed) history.back(); };
  const pop = () => close(true), key = (e) => { if (e.key === 'Escape') close(false); };
  try { history.pushState({ day: i }, ''); pushed = true; } catch { /* eingebettet */ }
  window.addEventListener('popstate', pop); document.addEventListener('keydown', key);
  el.querySelector('[data-close]').addEventListener('click', () => close(false));
  el.querySelector('[data-close]').focus();
  el.scrollTop = 0;
}
