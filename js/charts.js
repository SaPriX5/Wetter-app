// SVG-Diagramme ohne Bibliothek
import { parts, pad, de, deg, isNum, clamp, lerp, WD, compass, dowOfKey } from './util.js';
import { iconSvg, wmoText } from './wmo.js';

const LIGHT = ['#2449c4', '#2e68c2', '#3f7fb3', '#a77a00', '#c15e14', '#c0392b'];
const DARK = ['#7fa2ff', '#8db6f2', '#a9ccec', '#f2d27a', '#f5a962', '#f07a5a'];
const STOPS = [-5, 3, 10, 18, 26, 32];

function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
export function tempColor(t, dark) {
  const P = dark ? DARK : LIGHT;
  if (!isNum(t)) return P[2];
  if (t <= STOPS[0]) return P[0];
  if (t >= STOPS[5]) return P[5];
  let i = 0; while (t > STOPS[i + 1]) i++;
  const f = (t - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
  const a = hex(P[i]), b = hex(P[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(lerp(v, b[k], f))).join(',')})`;
}

function smooth(pts) { // Catmull-Rom -> Bezier
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// ------------------------------------------------------------------ Stundenverlauf
export function hourChart(el, model, dark) {
  const off = model.off;
  const hourNow = Math.floor(Date.now() / 3600000) * 3600000;
  const hs = model.hours.filter((h) => h.t >= hourNow).slice(0, 49);
  if (hs.length < 3) { el.innerHTML = '<p class="muted">Keine Stundenwerte.</p>'; return; }
  const W = Math.max(320, el.clientWidth || 640), H = 250;
  const L = 10, R = 10, top = 52, bot = 160;
  const step = (W - L - R) / (hs.length - 1);
  const X = (i) => L + i * step;
  const temps = hs.map((h) => h.temp);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = m - 3; hi = m + 3; }
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const Y = (t) => top + (1 - (t - lo) / (hi - lo)) * (bot - top);
  const pts = hs.map((h, i) => [X(i), Y(h.temp)]);
  const line = smooth(pts);
  const area = `${line}L${X(hs.length - 1).toFixed(1)},${bot}L${X(0).toFixed(1)},${bot}Z`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Diagramm: Temperatur und Regen der nächsten 48 Stunden. Tippen für Verlauf.">`;
  svg += '<defs>';
  svg += `<linearGradient id="hg" x1="0" x2="1" y1="0" y2="0">${hs.map((h, i) => `<stop offset="${(i / (hs.length - 1)).toFixed(3)}" stop-color="${tempColor(h.temp, dark)}"/>`).join('')}</linearGradient>`;
  svg += `<linearGradient id="ha" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--ink)" stop-opacity=".10"/><stop offset="1" stop-color="var(--ink)" stop-opacity="0"/></linearGradient>`;
  svg += '</defs>';

  // Nacht-Bänder und Tagesgrenzen
  for (let i = 0; i < hs.length - 1; i++) {
    if (!hs[i].isDay) svg += `<rect x="${X(i).toFixed(1)}" y="${top - 10}" width="${(step + 0.5).toFixed(1)}" height="${H - top - 36}" class="night"/>`;
  }
  hs.forEach((h, i) => {
    const p = parts(h.t, off);
    if (p.h === 0 && i > 0) {
      svg += `<line x1="${X(i)}" x2="${X(i)}" y1="${top - 14}" y2="${H - 30}" class="gridv"/><text x="${X(i) + 4}" y="${top - 18}" class="ct ctb">${WD[p.dow]}</text>`;
    }
  });
  // Hilfslinien
  [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75].forEach((t) => { svg += `<line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="gridh"/>`; });

  // Regen-Balken
  const maxP = 4;
  hs.forEach((h, i) => {
    const p = h.precip || 0;
    if (p < 0.05) return;
    const bh = clamp(Math.sqrt(p / maxP), 0.08, 1) * 44;
    svg += `<rect x="${(X(i) - step * 0.36).toFixed(1)}" y="${(bot + 44 - bh).toFixed(1)}" width="${(step * 0.72).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" class="rainbar"/>`;
  });
  svg += `<text x="${L}" y="${bot + 56}" class="ct">Regen mm/h</text>`;

  svg += `<path d="${area}" fill="url(#ha)"/><path d="${line}" fill="none" stroke="url(#hg)" stroke-width="3" stroke-linecap="round"/>`;

  // Icons + Temperaturen alle 3 Stunden
  hs.forEach((h, i) => {
    const p = parts(h.t, off);
    if (p.h % (W < 520 ? 6 : 3) !== 0) return;
    const x = X(i);
    svg += `<g transform="translate(${(x - 11).toFixed(1)},4)">${iconSvg(h.code, h.isDay, 22)}</g>`;
    svg += `<text x="${x.toFixed(1)}" y="${(Y(h.temp) - 8).toFixed(1)}" text-anchor="middle" class="ct ctb" fill="${tempColor(h.temp, dark)}">${Math.round(h.temp)}°</text>`;
    svg += `<circle cx="${x.toFixed(1)}" cy="${Y(h.temp).toFixed(1)}" r="3" fill="${tempColor(h.temp, dark)}"/>`;
  });
  // Zeitachse
  hs.forEach((h, i) => {
    const p = parts(h.t, off);
    if (p.h % 6 === 0) svg += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ct">${pad(p.h)}</text>`;
  });
  svg += `<g class="cursor" style="display:none"><line y1="${top - 14}" y2="${bot + 44}" class="curline"/><circle r="5" class="curdot"/></g>`;
  svg += '</svg>';
  el.innerHTML = svg + '<div class="tip" hidden></div>';

  const svgEl = el.querySelector('svg');
  const cur = svgEl.querySelector('.cursor');
  const tip = el.querySelector('.tip');
  const show = (clientX) => {
    const r = svgEl.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const i = clamp(Math.round((x - L) / step), 0, hs.length - 1);
    const h = hs[i], p = parts(h.t, off);
    cur.style.display = '';
    cur.querySelector('line').setAttribute('x1', X(i)); cur.querySelector('line').setAttribute('x2', X(i));
    cur.querySelector('circle').setAttribute('cx', X(i)); cur.querySelector('circle').setAttribute('cy', Y(h.temp));
    tip.hidden = false;
    tip.innerHTML = `<b>${WD[p.dow]} ${pad(p.h)}:00</b> · ${wmoText(h.code, h.isDay, h.temp)}<br><span class="mono">${deg(h.temp)}</span> gefühlt ${deg(h.feels)} · Regen ${de(h.precip || 0, 1)} mm · Wind ${de(h.wind)} km/h${isNum(h.gust) ? `, Böen ${de(h.gust)}` : ''} ${compass(h.dir)}`;
    const px = (X(i) / W) * r.width;
    tip.style.left = `${clamp(px, 110, r.width - 110)}px`;
  };
  const hide = () => { cur.style.display = 'none'; tip.hidden = true; };
  svgEl.addEventListener('pointerdown', (e) => { show(e.clientX); });
  svgEl.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') show(e.clientX); });
  svgEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svgEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(hide, 2500); });
}

// ------------------------------------------------------------------ Tage (Spannbreite)
export function rangeChart(el, days, count, dark, onPick, selected) {
  const ds = days.slice(0, count);
  if (!ds.length) { el.innerHTML = ''; return; }
  const avail = el.clientWidth || 640;
  const colW = Math.max(count > 7 ? 46 : 0, avail / ds.length);
  const W = Math.round(colW * ds.length), H = 310;
  const top = 100, bot = 236;
  const all = ds.flatMap((d) => [d.tmax, d.tmin, d.ens?.tmax?.[2], d.ens?.tmax?.[0], d.ens?.tmin?.[0], d.ens?.tmin?.[2]]).filter(isNum);
  let lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1);
  if (hi - lo < 8) { hi += 2; lo -= 2; }
  const Y = (t) => top + (1 - (t - lo) / (hi - lo)) * (bot - top);
  const maxP = Math.max(8, ...ds.map((d) => d.precip || 0));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Diagramm: Spannbreite der Höchst- und Tiefstwerte über ${ds.length} Tage${ds.length > 7 ? ', ab Tag 8 unsicher' : ''}. Die Liste darunter enthält dieselben Werte.">`;
  svg += '<defs>';
  ds.forEach((d, i) => { svg += `<linearGradient id="rg${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempColor(d.tmax, dark)}"/><stop offset="1" stop-color="${tempColor(d.tmin, dark)}"/></linearGradient>`; });
  svg += '</defs>';

  [0.25, 0.5, 0.75].forEach((f) => { const t = lo + (hi - lo) * f; svg += `<line x1="0" x2="${W}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="gridh"/>`; });
  if (ds.length > 7) svg += `<rect x="${(7 * colW).toFixed(1)}" y="0" width="${(W - 7 * colW).toFixed(1)}" height="${H}" class="uncertain"/><text x="${(7 * colW + 6).toFixed(1)}" y="${H - 6}" class="ct">ab Tag 8 unsicher</text>`;

  ds.forEach((d, i) => {
    const cx = colW * i + colW / 2, bw = Math.min(16, colW * 0.34);
    const [ky, km, kd] = d.key.split('-').map(Number); const p = { m: km, d: kd, dow: dowOfKey(d.key) };
    const unsure = i >= 7;
    const sel = selected === i;
    if (sel) svg += `<rect x="${(colW * i + 2).toFixed(1)}" y="2" width="${(colW - 4).toFixed(1)}" height="${H - 24}" rx="10" class="selcol"/>`;
    const label = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WD[p.dow];
    svg += `<text x="${cx.toFixed(1)}" y="18" text-anchor="middle" class="ct ctb">${label}</text>`;
    svg += `<text x="${cx.toFixed(1)}" y="32" text-anchor="middle" class="ct">${p.d}.${p.m}.</text>`;
    svg += `<g transform="translate(${(cx - 13).toFixed(1)},40)" opacity="${unsure ? 0.7 : 1}">${iconSvg(d.code ?? 3, true, 26)}</g>`;
    svg += `<text x="${cx.toFixed(1)}" y="${(Y(d.tmax) - 8).toFixed(1)}" text-anchor="middle" class="ct ctb" fill="${tempColor(d.tmax, dark)}">${Math.round(d.tmax)}°</text>`;
    svg += `<text x="${cx.toFixed(1)}" y="${(Y(d.tmin) + 16).toFixed(1)}" text-anchor="middle" class="ct" fill="${tempColor(d.tmin, dark)}">${Math.round(d.tmin)}°</text>`;
    // Ensemble-Spannbreite (P10 Tief bis P90 Hoch)
    if (d.ens?.tmax && d.ens.tmin) {
      const y1 = Y(d.ens.tmax[2]), y2 = Y(d.ens.tmin[0]);
      svg += `<rect x="${(cx - bw).toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw * 2).toFixed(1)}" height="${Math.max(4, y2 - y1).toFixed(1)}" rx="${bw}" class="ensband"/>`;
    }
    const y1 = Y(d.tmax), y2 = Y(d.tmin);
    svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(6, y2 - y1).toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="url(#rg${i})" ${unsure ? 'opacity=".6" stroke-dasharray="3 2" stroke="var(--ink)" stroke-opacity=".35"' : ''}/>`;
    // Regen
    const ph = clamp(Math.sqrt((d.precip || 0) / maxP), 0, 1) * 40;
    if ((d.precip || 0) >= 0.1) svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(290 - ph).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, ph).toFixed(1)}" rx="2" class="rainbar" opacity="${unsure ? 0.55 : 1}"/>`;
    svg += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ct"${(d.precip || 0) >= 0.1 ? '' : ' opacity=".45"'}>${(d.precip || 0) >= 0.1 ? de(d.precip, d.precip < 10 ? 1 : 0) : '0'}</text>`;
    svg += `<rect x="${(colW * i).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${H}" fill="transparent" data-i="${i}" class="hit"/>`;
  });
  svg += ``;
  svg += '</svg>';
  el.innerHTML = `<div class="rscroll">${svg}</div><p class="muted small" style="margin-top:2px">Blaue Säulen unten: Regenmenge pro Tag in mm. 0 heißt trocken.</p>`;
  el.querySelectorAll('.hit').forEach((r) => r.addEventListener('click', () => onPick?.(+r.dataset.i)));
}
