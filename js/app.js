import { nowcast, nowcastHTML } from './nowcast.js';
import { $, $$, esc, de, deg, pad, WD, WD_LANG, parts, parseLocal, fmtTime, ago, isNum, dowOfKey } from './util.js';
import { icon, wmoText, kindOf } from './wmo.js';
import { geocode, loadWeather, saveCache, readCache } from './api.js';
import { openDay } from './day.js';
import { heroIcon, stateIcon } from './hero.js';
import { hourChart, rangeChart, tempColor } from './charts.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll */ } },
};

const S = {
  theme: LS.get('wf:theme', 'auto'),
  favs: LS.get('wf:favs', []),
  loc: LS.get('wf:loc', null),
  model: null, stale: false, loading: false, error: null,
  count: LS.get('wf:count', 7), sel: null,
  radar: null, dark: true,
};

// ------------------------------------------------------------------ Darstellung
const TINT = {
  light: { clear: ['#f4f2ed', '#ffe6b0'], partly: ['#e9e7ec', '#f4f2ed'], cloud: ['#d5d7db', '#e3e4e4'], fog: ['#d3d3d1', '#e5e6e5'], rain: ['#b4bcc6', '#dce2ec'], snow: ['#e2e9f0', '#fafaf9'], storm: ['#c8c4d0', '#aab5c1'], night: ['#dce2ec', '#e1e7ee'], dusk: ['#f7f7f6', '#ffe6b0'] },
  dark: { clear: ['#1b222b', '#111b27'], partly: ['#1b222b', '#131518'], cloud: ['#1e1f21', '#141516'], fog: ['#232a33', '#17222e'], rain: ['#111b27', '#0c0e11'], snow: ['#1b222b', '#0f1114'], storm: ['#1c1626', '#0e0c12'], night: ['#0b1226', '#261d30'], dusk: ['#2a2533', '#332a18'] },
};

function isNightAtLoc() {
  const m = S.model;
  return !!m && m.now && m.now.isDay === false;
}
function computeDark() {
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  if (S.theme === 'dunkel') return true;
  if (S.theme === 'hell') return false;
  return sysDark || isNightAtLoc();
}
function applyTheme() {
  S.dark = computeDark();
  document.documentElement.dataset.theme = S.dark ? 'dark' : 'light';
  $('meta[name=theme-color]').content = S.dark ? '#0b1429' : '#eef1f6';
}

// ------------------------------------------------------------------ Hilfen
const toast = (() => {
  let t; return (msg) => { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(t); t = setTimeout(() => { el.hidden = true; }, 3200); };
})();
const isFav = (loc) => S.favs.some((f) => f.id === loc?.id);

function rainOutlook(m) {
  const now = Date.now();
  const items = [];
  const mEnd = m.min15.length ? m.min15[m.min15.length - 1].t : 0;
  m.min15.forEach((x) => { if (x.t >= now - 15 * 60000) items.push({ t: x.t, p: x.p }); });
  m.hours.forEach((h) => { if (h.t > Math.max(mEnd, now - 3600000)) items.push({ t: h.t, p: h.precip || 0 }); });
  items.sort((a, b) => a.t - b.t);
  if (!items.length) return { text: '', raining: false };
  const wet = (x) => x.p >= 0.1;
  const raining = wet(items[0]);
  const fmtT = (t) => { const p = parts(t, m.off), n = parts(now, m.off); return (p.key === n.key ? '' : `${WD[p.dow]} `) + `${pad(p.h)}:${pad(p.mi)}`; };
  if (raining) {
    const stop = items.find((x) => !wet(x));
    if (!stop) return { text: 'Regen hält die nächsten Stunden an', raining: true };
    return { text: `Regen bis ca. ${fmtT(stop.t)}`, raining: true, stop: stop.t, endsSoon: stop.t - now <= 3 * 3600000 };
  }
  const start = items.find(wet);
  if (start) return { text: `Regen ab ${fmtT(start.t)}`, raining: false, start: start.t, soon: start.t - now <= 3 * 3600000 };
  const last = items[items.length - 1].t + 3600000;
  if (last - now >= 47 * 3600000) return { text: '48 Stunden trocken', raining: false };
  return { text: `Trocken bis mindestens ${fmtT(last)}`, raining: false };
}

function dayparts(m) {
  const now = Date.now();
  const defs = [['Morgen', 6, 10], ['Mittag', 11, 15], ['Abend', 17, 21], ['Nacht', 22, 29]]; // Nacht = 22 bis 5 Uhr des Folgetags
  const out = [];
  for (let off = 0; off < 3 && out.length < 4; off++) {
    const key = parts(now + off * 86400000, m.off).key;
    const mid = parseLocal(`${key}T00:00`, m.off);
    for (const [name, a, b] of defs) {
      const hs = m.hours.filter((h) => { const hh = (h.t - mid) / 3600000; return hh >= a && hh <= b; });
      if (!hs.length || hs[hs.length - 1].t < now) continue;
      const rep = hs[Math.floor(hs.length / 2)];
      out.push({ name, temp: Math.round(hs.reduce((s, h) => s + h.temp, 0) / hs.length), code: rep.code, isDay: name !== 'Nacht', rain: hs.reduce((s, h) => s + (h.precip || 0), 0), off });
      if (out.length === 4) break;
    }
  }
  return out;
}

function skyTint(m) {
  const n = m.now, k = kindOf(n.code);
  const pal = S.dark ? TINT.dark : TINT.light;
  const sr = m.days[0]?.sunrise, ss = m.days[0]?.sunset, t = Date.now();
  if (!n.isDay) return k === 'storm' ? pal.storm : k === 'rain' ? pal.rain : pal.night;
  const near = (x) => x && Math.abs(t - x) < 50 * 60000;
  if ((near(sr) || near(ss)) && (k === 'clear' || k === 'partly')) return pal.dusk;
  return pal[k] || pal.cloud;
}

// ------------------------------------------------------------------ Rendern
function renderPlaces() {
  const nav = $('#places');
  const chip = (l, extra = '') => `<button class="chip ${S.loc?.id === l.id ? 'on' : ''} ${extra}" data-id="${esc(l.id)}">${l.id === 'gps' ? '◎ ' : ''}${esc(l.name)}</button>`;
  const gps = LS.get('wf:gps', null);
  nav.innerHTML = `<span class="lbl">Orte</span>${chip({ id: 'gps', name: 'Mein Standort' })}${S.favs.map((f) => chip(f)).join('')}`;
  $$('.chip', nav).forEach((b) => {
    let timer = null, longed = false;
    const id = b.dataset.id;
    b.addEventListener('pointerdown', () => {
      longed = false;
      if (id === 'gps') return;
      timer = setTimeout(() => {
        longed = true;
        const f = S.favs.find((x) => x.id === id);
        if (f && confirm(`Favorit löschen: ${f.name}?`)) { S.favs = S.favs.filter((x) => x.id !== id); LS.set('wf:favs', S.favs); renderPlaces(); updateStar(); }
      }, 650);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener('click', () => {
      if (longed) return;
      if (id === 'gps') return useGps(!!gps);
      const f = S.favs.find((x) => x.id === id); if (f) setLoc(f);
    });
  });
  if (!S.favs.length) nav.insertAdjacentHTML('beforeend', '<span class="hint">Noch keine Favoriten. Suche oben nach einer Stadt und tippe auf den Stern.</span>');
}

function updateStar() {
  const b = $('#starBtn');
  const can = S.loc && S.loc.id !== 'gps';
  b.hidden = !can;
  if (!can) return;
  const on = isFav(S.loc);
  b.textContent = on ? '★' : '☆';
  b.setAttribute('aria-pressed', on);
  b.setAttribute('aria-label', on ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
  b.title = on ? 'Aus Favoriten entfernen' : 'Zu Favoriten';
}

function emptyState(title, text, frog = 'hallo', action = '') {
  $('#app').innerHTML = `<section class="empty">${stateIcon(frog)}<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>${action}</section>`;
  $$('[data-act=gps]').forEach((b) => b.addEventListener('click', () => useGps(false)));
  $$('[data-act=retry]').forEach((b) => b.addEventListener('click', () => refresh(true)));
}

function render() {
  const m = S.model;
  renderPlaces(); updateStar();
  if (!S.loc) {
    emptyState('Wetter', 'Suche oben nach einer Stadt oder nutze deinen Standort.', 'hallo', '<button class="btn" data-act="gps">Standort verwenden</button>');
    return;
  }
  if (!m) {
    if (S.loading) { $('#app').innerHTML = `<section class="empty">${stateIcon('laedt')}<p class="muted">Lade Vorhersage für ${esc(S.loc.name)} …</p></section>`; return; }
    emptyState(S.error === 'offline' ? 'Keine Verbindung' : 'Keine Daten', S.error === 'offline' ? 'Keine Verbindung und noch keine gespeicherte Vorhersage für diesen Ort.' : 'Die Vorhersage konnte nicht geladen werden.', S.error === 'offline' ? 'offline' : 'fehler', '<button class="btn" data-act="retry">Erneut versuchen</button>');
    return;
  }
  applyTheme();
  const n = m.now;
  const out = rainOutlook(m);
  const d0 = m.days[0];
  const srcLine = n.src === 'DWD-Messung'
    ? `Jetzt: DWD-Messung, Station ${esc(n.station)}`
    : `Jetzt: ${esc(n.src === 'ICON-D2' ? 'DWD ICON-D2' : 'ECMWF IFS')}${m.mosmixStation ? ` · Temperatur/Wind: DWD MOSMIX, Station ${esc(m.mosmixStation.name)}` : ''}`;
  const parts4 = dayparts(m);

  $('#app').innerHTML = `
  ${S.stale ? `<div class="banner" role="status">Offline. Zuletzt geladen ${esc(ago(m.fetchedAt))} (${fmtTime(m.fetchedAt, m.off)} Uhr).</div>` : ''}
  <section class="hero">
    <div class="hero-head">
      <div><h1>${esc(S.loc.name)}</h1><div class="sub">${esc(S.loc.id === 'gps' ? (m.mosmixStation ? `bei ${m.mosmixStation.name}` : 'Aktueller Standort') : S.loc.sub || '')}</div></div>
      <div class="hero-actions">
        ${S.loc.id === 'gps' ? '<button class="ibtn" id="regps" title="Standort neu bestimmen" aria-label="Standort neu bestimmen">◎</button>' : ''}
        <button class="ibtn" id="refresh" title="Aktualisieren" aria-label="Aktualisieren">↻</button>
      </div>
    </div>
    <div class="hero-body">
      <div class="heroicon" aria-hidden="true">${heroIcon(n.code, n.isDay)}</div>
      <div class="now">
        <div class="temp mono" style="color:${tempColor(n.temp, S.dark)}">${isNum(n.temp) ? Math.round(n.temp) : '–'}°</div>
        <div class="cond">${icon(n.code, n.isDay, 30)}<span>${esc(wmoText(n.code, n.isDay, n.temp))}</span></div>
        <div class="meta mono">Gefühlt ${deg(n.feels)} · Wind ${de(n.wind)} km/h${isNum(n.gust) && n.gust > n.wind + 5 ? ` · Böen ${de(n.gust)}` : ''}${isNum(n.humidity) ? ` · ${de(n.humidity)} %` : ''}</div>
        ${d0 ? `<div class="meta mono">Heute ${deg(d0.tmax)} / ${deg(d0.tmin)}</div>` : ''}
      </div>
    </div>
    <p class="rainline ${out.raining ? 'wet' : ''}">${out.raining ? '☔' : '☂'} ${esc(out.text)}</p>
    <div class="parts">${parts4.map((p) => `<div class="part"><span class="pn">${p.name}${p.off === 1 ? ' morgen' : p.off > 1 ? ' +2' : ''}</span>${icon(p.code, p.isDay, 24)}<b class="mono" style="color:${tempColor(p.temp, S.dark)}">${p.temp}°</b>${p.rain >= 0.1 ? `<span class="pr mono">${de(p.rain, 1)} mm</span>` : '<span class="pr"> </span>'}</div>`).join('')}</div>
    <p class="srcline mono">${srcLine} · Stand ${fmtTime(n.at ?? m.fetchedAt, m.off)}</p>
  </section>

  <section class="card" id="sec-hours">
    <div class="card-head"><h2>Stundenverlauf</h2><span class="tag mono">48 Std</span></div>
    <div class="chart" id="hourchart"></div>
    <p class="muted small">Tippen für Verlauf</p>
  </section>

  <section class="card" id="sec-days">
    <div class="card-head"><h2>Tage</h2>
      <div class="seg" role="group" aria-label="Zeitraum">${[3, 7, 16].map((c) => `<button data-c="${c}" aria-pressed="${S.count === c}">${c} Tage</button>`).join('')}</div>
    </div>
    <div class="chart" id="rangechart"></div>
    <ul class="days" id="daylist"></ul>
  </section>

  <section class="card" id="sec-radar">
    <div class="card-head"><h2>Radar</h2><span class="tag mono">DWD</span></div>
    <div class="radar" id="radar"><button class="btn" id="loadradar">Regenradar anzeigen</button></div>
  </section>

  <section class="card" id="sec-nowcast">
    <div class="card-head"><h2>Regen-Warner</h2><span class="tag mono">2 Std</span></div>
    ${nowcastHTML(nowcast(m), m.off, parts)}
  </section>

  <footer class="foot">
    <p class="muted small">Daten: Deutscher Wetterdienst (DWD), ECMWF (CC BY 4.0) · Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></p>
    <p><button class="link" id="infobtn">Info und Quellen</button></p>
  </footer>`;

  $('#refresh').addEventListener('click', () => refresh(true));
  $('#regps')?.addEventListener('click', () => useGps(false, true));
  $('#infobtn').addEventListener('click', openSheet);
  $$('.seg button').forEach((b) => b.addEventListener('click', () => { S.count = +b.dataset.c; LS.set('wf:count', S.count); S.sel = null; $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', +x.dataset.c === S.count)); renderDays(); }));
  $('#loadradar').addEventListener('click', startRadar);
  renderCharts();
  renderDays();
  // Radar automatisch laden, wenn sichtbar
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); startRadar(); } }, { rootMargin: '200px' });
    io.observe($('#sec-radar'));
  }
}

function renderCharts() {
  const m = S.model; if (!m) return;
  const el = $('#hourchart'); if (el) hourChart(el, m, S.dark);
}

function renderDays() {
  const m = S.model; if (!m) return;
  const days = m.days.slice(0, S.count);
  rangeChart($('#rangechart'), m.days, S.count, S.dark, (i) => { S.sel = S.sel === i ? null : i; renderDays(); }, S.sel);
  $('#daylist').innerHTML = days.map((d, i) => {
    const dow = dowOfKey(d.key), [, mo, da] = d.key.split('-').map(Number);
    const name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WD_LANG[dow];
    const e = d.ens;
    const chance = e?.regenChance;
    const wet = (d.precip || 0) >= 0.1;
    const maybe = !wet && chance != null && chance >= 0.3;
    const open = S.sel === i;
    const srcTxt = d.src === 'MOSMIX' ? `Temperatur/Wind: DWD MOSMIX${m.mosmixStation ? `, Station ${m.mosmixStation.name}` : ''}` : d.src === 'ICON-D2' ? 'Modell: DWD ICON-D2' : 'Modell: ECMWF IFS';
    return `<li class="day ${i >= 7 ? 'unsure' : ''} ${open ? 'open' : ''}" data-i="${i}">
      <button class="row" aria-expanded="${open}">
        <span class="dn"><b>${name}</b><small class="mono">${da}.${mo}.</small></span>
        <span class="di">${icon(d.code ?? 3, true, 26)}</span>
        <span class="dt">${esc(wmoText(d.code ?? 3, true))}${i >= 7 ? ' <em>unsicher</em>' : ''}</span>
        <span class="dtemp mono"><b style="color:${tempColor(d.tmax, S.dark)}">${deg(d.tmax)}</b> <span style="color:${tempColor(d.tmin, S.dark)}">${deg(d.tmin)}</span></span>
        <span class="dr mono">${wet ? `${de(d.precip, d.precip < 10 ? 1 : 0)} mm` : maybe ? 'Regen möglich' : ''}</span>
      </button>
      ${open ? `<div class="detail small">
        ${e ? `<p>Höchstwert ${deg(e.tmax[1])} <span class="muted">(${deg(e.tmax[0])} bis ${deg(e.tmax[2])})</span>${e.tmin ? ` · Tiefstwert ${deg(e.tmin[1])} <span class="muted">(${deg(e.tmin[0])} bis ${deg(e.tmin[2])})</span>` : ''}</p>
        <p>Regenchance ${de((chance ?? 0) * 100)} % · Regenmenge typisch ${de(e.regenP50 ?? 0, 1)} mm, im ungünstigen Fall ${de(e.regenP90 ?? 0, 1)} mm</p>` : ''}
        ${isNum(d.gust) ? `<p>Böen bis ${de(d.gust)} km/h</p>` : ''}
        ${d.sunrise ? `<p>Sonne ${fmtTime(d.sunrise, m.off)} bis ${fmtTime(d.sunset, m.off)}</p>` : ''}
        <p class="muted">${srcTxt}${d.adj && m.adjust != null ? `, an Ortsvorhersage angeglichen (${de(m.adjust, 1).replace(/^(\d)/, '+$1')}°)` : ''}${e ? ` · Ensemble: ECMWF ENS + NCEP GEFS, ${e.n} Läufe` : ''}</p>
        <button class="btn" data-day="${i}">Tagesdetails</button>
      </div>` : ''}
    </li>`;
  }).join('');
  $$('#daylist [data-day]').forEach((b) => b.addEventListener('click', () => openDay(m, +b.dataset.day, S.dark)));
  $$('#daylist .row').forEach((b) => b.addEventListener('click', () => { const i = +b.closest('li').dataset.i; S.sel = S.sel === i ? null : i; renderDays(); }));
}

async function startRadar() {
  const box = $('#radar'); if (!box || !S.model) return;
  const { mountRadar } = await import('./radar.js');
  S.radar?.destroy?.();
  box.innerHTML = '<p class="muted">Lade Radar …</p>';
  try { S.radar = await mountRadar(box, { lat: S.loc.lat, lon: S.loc.lon, dark: S.dark, off: S.model.off }); }
  catch (e) { box.innerHTML = '<p class="muted">Keine Radardaten erreichbar. Ohne Internet gibt es keine Radarbilder.</p><button class="btn" id="loadradar2">Erneut versuchen</button>'; $('#loadradar2')?.addEventListener('click', startRadar); }
}

// ------------------------------------------------------------------ Laden
async function refresh(force = false) {
  const loc = S.loc; if (!loc) return;
  const cached = readCache(loc);
  if (!force && cached && Date.now() - cached.fetchedAt < 10 * 60000) { S.model = cached; S.stale = false; S.error = null; render(); return; }
  S.loading = !S.model || S.model.loc.id !== loc.id;
  if (S.loading) { S.model = null; render(); }
  try {
    const m = await loadWeather(loc);
    if (S.loc?.id !== loc.id) return;
    S.model = m; S.stale = false; S.error = null; saveCache(loc, m);
  } catch (e) {
    if (S.loc?.id !== loc.id) return;
    if (cached) { S.model = cached; S.stale = true; S.error = null; }
    else { S.model = null; S.error = navigator.onLine === false ? 'offline' : 'fehler'; }
  }
  S.loading = false;
  S.radar?.destroy?.(); S.radar = null;
  render();
}

function setLoc(loc) {
  S.loc = loc; LS.set('wf:loc', loc); S.sel = null; S.model = null;
  $('#q').value = ''; hideResults();
  refresh(false);
}

function useGps(haveStored, fresh = false) {
  const stored = LS.get('wf:gps', null);
  const go = (p) => setLoc({ id: 'gps', name: 'Mein Standort', sub: '', lat: p.lat, lon: p.lon, elev: null, tz: null });
  if (haveStored && stored && !fresh) return go(stored);
  if (!navigator.geolocation) return toast('Kein Standortrecht');
  toast('Bestimme Standort …');
  navigator.geolocation.getCurrentPosition((pos) => {
    const p = { lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) };
    LS.set('wf:gps', p); go(p);
  }, (err) => toast(err.code === 1 ? 'Kein Standortrecht' : 'Standort nicht verfügbar'), { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
}

// ------------------------------------------------------------------ Suche
let sTimer = null, sSeq = 0;
function hideResults() { const r = $('#results'); r.hidden = true; r.innerHTML = ''; }
async function doSearch(q) {
  const my = ++sSeq;
  const r = $('#results');
  if (navigator.onLine === false) { r.hidden = false; r.innerHTML = '<li class="msg">Keine Verbindung – Suche braucht Internet</li>'; return; }
  try {
    const res = await geocode(q);
    if (my !== sSeq) return;
    r.hidden = false;
    r.innerHTML = res.length ? res.map((x, i) => `<li><button data-i="${i}"><b>${esc(x.name)}</b> <span class="muted">${esc(x.sub)}</span></button></li>`).join('') : '<li class="msg">Nichts gefunden</li>';
    $$('button', r).forEach((b) => b.addEventListener('click', () => setLoc(res[+b.dataset.i])));
  } catch { if (my === sSeq) { r.hidden = false; r.innerHTML = '<li class="msg">Suche fehlgeschlagen</li>'; } }
}

// ------------------------------------------------------------------ Info / Einstellungen
function openSheet() {
  const dlg = $('#sheet');
  dlg.innerHTML = `
  <form method="dialog" class="sheet-in">
    <header><h2>Info und Quellen</h2><button class="ibtn" value="close" aria-label="Zurück">✕</button></header>
    <h3>Darstellung</h3>
    <div class="seg wide" id="themeseg" role="group">${[['auto', 'Auto'], ['hell', 'Hell'], ['dunkel', 'Dunkel']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.theme === v}">${l}</button>`).join('')}</div>
    <p class="muted small">Auto folgt dem Handy. Nachts ist die App dann immer dunkel.</p>
    <h3>Wie die Vorhersage entsteht</h3>
    <p class="small">0–48 Stunden: DWD ICON-D2 mit 2 km Raster, stark bei Schauern und Gewittern. Ab Tag 3: ECMWF IFS mit 9 km. Liegt eine DWD-Station nah genug (höchstens 20 km, höchstens 100 m Höhenunterschied), kommen Temperatur und Wind aus MOSMIX, das Modellfehler statistisch korrigiert. Der Jetzt-Wert ist dann sogar gemessen, sofern die Messung höchstens 40 Minuten alt ist. Fällt eine Quelle aus, springt die nächste ein. Ohne Netz zeigt die App die zuletzt geladene Vorhersage mit ihrem Stand.</p>
    <h3>Quellen</h3>
    <ul class="src small">
      <li><a href="https://www.dwd.de/opendata" target="_blank" rel="noopener"><b>Deutscher Wetterdienst (DWD)</b></a><br>Modell ICON-D2 (0–48 Std), MOSMIX-Stationsvorhersage, Stationsmessungen, Radarkomposit WN (Reflektivität) mit Radar-Vorhersage bis +2 Std. Datenbasis: Deutscher Wetterdienst.</li>
      <li><a href="https://brightsky.dev/" target="_blank" rel="noopener"><b>Bright Sky</b></a><br>Liefert die DWD-Stationsvorhersage MOSMIX und die aktuellen Messwerte als JSON. Freie Software (MIT).</li>
      <li><a href="https://open-meteo.com/" target="_blank" rel="noopener"><b>Open-Meteo</b></a><br>Vorhersage-API, Ensemble-API und Städtesuche. Daten unter CC BY 4.0.</li>
      <li><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener"><b>ECMWF</b></a><br>Modell IFS (9 km) ab Tag 3 und Ensemble ENS für die Langfrist. Lizenz CC BY 4.0.</li>
      <li><a href="https://www.ncei.noaa.gov/products/weather-climate-models/global-ensemble-forecast" target="_blank" rel="noopener"><b>NOAA NCEP GEFS</b></a><br>Zweites Ensemble für die Tage 15 und 16. Gemeinfreie Daten der US-Regierung.</li>
      <li><a href="https://github.com/basmilius/meteocons" target="_blank" rel="noopener"><b>Meteocons</b></a><br>Wettersymbole von Bas Milius, MIT-Lizenz.</li>
      <li><a href="https://openfreemap.org/" target="_blank" rel="noopener"><b>OpenFreeMap</b></a><br>Vektorkacheln fürs Regenradar, in der App selbst gezeichnet. Frei nutzbar ohne Anmeldung.</li>
      <li><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener"><b>OpenStreetMap</b></a><br>Grundlage der Kartenkacheln, unter der Open Database License (ODbL).</li>
      <li><a href="https://openfontlicense.org/" target="_blank" rel="noopener"><b>Schriften</b></a><br>Barlow (SIL Open Font License 1.1) als freier Ersatz für FF DINPro.</li>
    </ul>
    <h3>Datenschutz</h3>
    <p class="small">Kein Tracking, keine Analyse, keine Werbung, keine Konten. Die App fragt Wetterdienste nur mit Koordinaten an. Favoriten, Standort und Vorhersagen bleiben auf diesem Gerät. Der Standort ist optional. Die App funktioniert auch ohne.</p>
    <p class="muted small">Web-App nach dem Vorbild einer Android-Wetter-App.</p>
  </form>`;
  dlg.showModal();
  $$('#themeseg button', dlg).forEach((b) => b.addEventListener('click', () => {
    S.theme = b.dataset.v; LS.set('wf:theme', S.theme);
    $$('#themeseg button', dlg).forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === S.theme));
    applyTheme(); if (S.model) { S.radar?.destroy?.(); S.radar = null; render(); }
  }));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }, { once: true });
}

// ------------------------------------------------------------------ Start
async function init() {
  applyTheme();
  const q = $('#q');
  q.addEventListener('input', () => {
    clearTimeout(sTimer); const v = q.value.trim();
    $('#clearQ').hidden = !v;
    if (v.length < 2) return hideResults();
    sTimer = setTimeout(() => doSearch(v), 280);
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const v = q.value.trim(); if (v.length >= 2) doSearch(v); });
  $('#clearQ').addEventListener('click', () => { q.value = ''; $('#clearQ').hidden = true; hideResults(); q.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.top')) hideResults(); });
  $('#starBtn').addEventListener('click', () => {
    if (!S.loc || S.loc.id === 'gps') return;
    if (isFav(S.loc)) S.favs = S.favs.filter((f) => f.id !== S.loc.id); else S.favs = [...S.favs, S.loc];
    LS.set('wf:favs', S.favs); renderPlaces(); updateStar();
  });
  $('#menuBtn').addEventListener('click', openSheet);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); if (S.model) render(); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.model) { renderCharts(); renderDays(); } }, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.model && Date.now() - S.model.fetchedAt > 15 * 60000) refresh(true); });
  window.addEventListener('online', () => { if (S.loc && (S.stale || !S.model)) refresh(true); });
  render();
  if (S.loc) refresh(false);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();
