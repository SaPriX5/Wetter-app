// Regenradar: DWD Radarkomposit WN (WMS) auf OpenFreeMap-Vektorkacheln, Darstellung mit MapLibre GL.
import { pad, fmtTime } from './util.js';

const WMS = 'https://maps.dwd.de/geoserver/dwd/wms';
const LAYER = 'dwd:Radar_wn-product_1x1km_ger';

let libPromise = null;
export function ensureMapLib() {
  if (window.maplibregl) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './vendor/maplibre-gl.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = './vendor/maplibre-gl.js'; s.onload = res; s.onerror = () => { libPromise = null; rej(new Error('Kartenbibliothek nicht ladbar')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

function style(dark) {
  const c = dark
    ? { bg: '#14161a', land: '#1b1f25', water: '#0d1318', road: '#2c333d', bound: '#4a5361', text: '#aab5c1', halo: '#14161a' }
    : { bg: '#eceae4', land: '#e3e5dc', water: '#c9d9e8', road: '#fafaf9', bound: '#9aa0a8', text: '#3a3f46', halo: '#f4f2ed' };
  const name = ['coalesce', ['get', 'name:de'], ['get', 'name']];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'land', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': c.land, 'fill-opacity': 0.9 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7, filter: ['in', 'class', 'motorway', 'trunk', 'primary'],
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 12, 2] } },
      { id: 'bound', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4],
        paint: { 'line-color': c.bound, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'places', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', 'class', 'city', 'town', 'village', 'country', 'state'],
        layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 14], 'text-max-width': 8 },
        paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
    ],
  };
}

function parseDim(xml) {
  const m = xml.match(/<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/i);
  if (!m) return [];
  const txt = m[1].trim();
  const out = [];
  for (const part of txt.split(',')) {
    const r = part.trim().split('/');
    if (r.length === 3) {
      const a = Date.parse(r[0]), b = Date.parse(r[1]);
      const pm = r[2].match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      const step = ((+pm?.[1] || 0) * 60 + (+pm?.[2] || 5)) * 60000;
      for (let t = a; t <= b && out.length < 4000; t += step) out.push(t);
    } else if (r[0]) out.push(Date.parse(r[0]));
  }
  return out.filter(Number.isFinite);
}

async function frames() {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(`https://maps.dwd.de/geoserver/dwd/Radar_wn-product_1x1km_ger/wms?service=WMS&version=1.3.0&request=GetCapabilities`, { signal: ctl.signal });
    clearTimeout(to);
    const times = parseDim(await r.text());
    if (!times.length) throw new Error('keine Zeiten');
    const now = Date.now();
    // von -60 Min bis Ende (Vorhersage bis +2 Std), alle 10 Min
    const sel = times.filter((t) => t >= now - 75 * 60000 && t % (10 * 60000) === 0);
    if (sel.length >= 3) return sel.slice(0, 22);
  } catch { /* Rückfall */ }
  return [null]; // nur das aktuelle Bild ohne TIME
}

export async function mountRadar(box, { lat, lon, dark, off }) {
  await ensureMapLib();
  box.innerHTML = `
    <button class="rfull" aria-label="Vollbild" title="Vollbild">⤢</button>
    <div class="map" role="img" aria-label="Regenradar-Karte"></div>
    <div class="radar-ui">
      <button class="rbtn" aria-label="Abspielen" data-act="play">▶</button>
      <input type="range" min="0" max="0" value="0" aria-label="Radar-Zeitpunkt">
      <span class="rtime mono">–</span>
    </div>
    <div class="legend"><span>Regen mm/h</span><i></i><span class="mono">0,1</span><span class="mono">1</span><span class="mono">5</span><span class="mono">20+</span></div>
    <p class="rmsg muted" hidden></p>`;
  const mapEl = box.querySelector('.map');
  const slider = box.querySelector('input'), tlabel = box.querySelector('.rtime'), play = box.querySelector('.rbtn'), msg = box.querySelector('.rmsg');
  const map = new window.maplibregl.Map({ container: mapEl, style: style(dark), center: [lon, lat], zoom: 7.2, attributionControl: false, cooperativeGestures: true, pitchWithRotate: false, dragRotate: false });
  map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const fb = box.querySelector('.rfull');
  let full = false, pushed = false;
  const setFull = (on, fromPop) => {
    if (on === full) return; full = on;
    box.classList.toggle('full', on); document.documentElement.classList.toggle('noscroll', on);
    fb.textContent = on ? '✕' : '⤢'; fb.setAttribute('aria-label', on ? 'Vollbild beenden' : 'Vollbild');
    if (on) { map.cooperativeGestures?.disable?.(); try { history.pushState({ radar: 1 }, ''); pushed = true; } catch { /* eingebettet */ } } else { map.cooperativeGestures?.enable?.(); if (!fromPop && pushed) history.back(); pushed = false; }
    setTimeout(() => map.resize(), 60);
  };
  const onPop = () => setFull(false, true);
  window.addEventListener('popstate', onPop);
  fb.addEventListener('click', () => setFull(!full));
  let errs = 0;
  map.on('error', (e) => {
    if (e?.sourceId?.startsWith('radar') || /dwd/i.test(e?.error?.url || '')) { if (++errs === 3) { msg.hidden = false; msg.textContent = 'Keine Radardaten erreichbar. Ohne Internet gibt es keine Radarbilder.'; } }
  });
  let fr = [null], cur = 0, timer = null;
  const show = (i) => {
    cur = i; slider.value = i;
    fr.forEach((_, k) => { if (map.getLayer(`radar-${k}`)) map.setPaintProperty(`radar-${k}`, 'raster-opacity', k === i ? 0.78 : 0); });
    const t = fr[i];
    if (!t) { tlabel.textContent = 'aktuell'; return; }
    const d = Math.round((t - Date.now()) / 60000), a = Math.abs(d);
    const rel = a <= 5 ? 'Jetzt' : `${d > 0 ? '+' : '−'}${a >= 60 ? `${Math.floor(a / 60)}:${pad(a % 60)} Std` : `${a} Min`}`;
    tlabel.textContent = `${fmtTime(t, off)} · ${rel}`;
  };
  map.on('load', async () => {
    fr = await frames();
    slider.max = fr.length - 1;
    fr.forEach((t, k) => {
      const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=${LAYER}&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}${t ? `&TIME=${new Date(t).toISOString().replace('.000Z', 'Z')}` : ''}`;
      map.addSource(`radar-${k}`, { type: 'raster', tiles: [url], tileSize: 256, attribution: 'Radar: DWD' });
      map.addLayer({ id: `radar-${k}`, type: 'raster', source: `radar-${k}`, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'bound');
    });
    map.addSource('me', { type: 'geojson', data: { type: 'Point', coordinates: [lon, lat] } });
    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 15, 'circle-color': '#ed1c24', 'circle-opacity': 0.22 } });
    map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 6, 'circle-color': '#ed1c24', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    // aktuellster Zeitpunkt = letzter nicht in der Zukunft
    let start = 0; fr.forEach((t, k) => { if (t && t <= Date.now() + 5 * 60000) start = k; });
    show(start);
    // einmal von -60 Min bis +2 Std durchlaufen lassen, dann beim aktuellen Bild stehen bleiben
    if (fr.length > 3 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let k = 0; show(0); play.textContent = '❚❚';
      timer = setInterval(() => { k++; if (k >= fr.length) { stop(); show(start); } else show(k); }, 450);
    }
  });
  slider.addEventListener('input', () => { stop(); show(+slider.value); });
  const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶'; play.setAttribute('aria-label', 'Abspielen'); };
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (fr.length < 2) return;
    play.textContent = '❚❚'; play.setAttribute('aria-label', 'Anhalten');
    timer = setInterval(() => show((cur + 1) % fr.length), 700);
  });
  box.insertAdjacentHTML('beforeend', '<p class="muted small attr">Radar: DWD · Karte © OpenStreetMap-Mitwirkende, OpenFreeMap</p>');
  return { destroy() { stop(); window.removeEventListener('popstate', onPop); if (full) { document.documentElement.classList.remove('noscroll'); box.classList.remove('full'); } map.remove(); box.innerHTML = ''; } };
}
