// Datenquellen wie in der Android-App:
//  0-48 Std: DWD ICON-D2 (Open-Meteo), ab Tag 3: ECMWF IFS, Ensemble: ECMWF ENS + NOAA GEFS,
//  Temperatur/Wind: DWD MOSMIX und Messung über Bright Sky (nur wenn Station <= 20 km und <= 100 m Höhenunterschied).
import { parseLocal, parts, dayKey, isNum, percentile } from './util.js';
import { severity } from './wmo.js';

const HOURLY = 'temperature_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m';
const CURRENT = 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,relative_humidity_2m';

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

export async function geocode(name) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=de&format=json`;
  const j = await getJSON(u, 10000);
  return (j.results || []).map((r) => ({
    id: `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`,
    name: r.name,
    sub: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude, elev: r.elevation ?? null, tz: r.timezone || null,
  }));
}

const ok = (p) => p.then((v) => v, () => null);

function seriesOk(h, key) { return h && Array.isArray(h[key]) && h[key].some(isNum); }

export async function loadWeather(loc) {
  const q = `latitude=${loc.lat.toFixed(4)}&longitude=${loc.lon.toFixed(4)}`;
  const base = `https://api.open-meteo.com/v1/forecast?${q}`;
  const nowUtc = Date.now();
  const d0 = new Date(nowUtc - 86400000).toISOString().slice(0, 10);
  const d1 = new Date(nowUtc + 10 * 86400000).toISOString().slice(0, 10);

  const [d2, ifs, ens, bsW, bsC] = await Promise.all([
    ok(getJSON(`${base}&models=icon_d2&current=${CURRENT}&hourly=${HOURLY}&minutely_15=precipitation&forecast_minutely_15=12&past_hours=24&forecast_hours=48&timezone=auto`)),
    ok(getJSON(`${base}&models=ecmwf_ifs&current=${CURRENT}&hourly=${HOURLY}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,sunrise,sunset&past_days=1&forecast_days=16&timezone=auto`)),
    ok(getJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?${q}&models=ecmwf_ifs025,ncep_gefs05&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=16&timezone=auto`)),
    ok(getJSON(`https://api.brightsky.dev/weather?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}&date=${d0}&last_date=${d1}&max_dist=20000&tz=UTC`)),
    ok(getJSON(`https://api.brightsky.dev/current_weather?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}&max_dist=20000&tz=UTC`, 8000)),
  ]);

  const d2ok = seriesOk(d2?.hourly, 'temperature_2m');
  const ifsok = seriesOk(ifs?.hourly, 'temperature_2m');
  if (!d2ok && !ifsok) throw new Error('Keine Modelldaten');

  const meta = (d2ok ? d2 : ifs);
  const off = meta.utc_offset_seconds ?? 0;
  const tz = meta.timezone || loc.tz || 'UTC';
  const elev = loc.elev ?? meta.elevation ?? null;

  // ---- stündliche Daten (ms -> Datensatz) ----
  const mk = (h, src) => {
    const out = new Map();
    if (!h?.time) return out;
    h.time.forEach((s, i) => {
      const t = parseLocal(s, off);
      out.set(t, {
        t, temp: h.temperature_2m?.[i], feels: h.apparent_temperature?.[i], precip: h.precipitation?.[i] ?? 0,
        code: h.weather_code?.[i], isDay: h.is_day?.[i] === 1, wind: h.wind_speed_10m?.[i], gust: h.wind_gusts_10m?.[i],
        dir: h.wind_direction_10m?.[i], src,
      });
    });
    return out;
  };
  const mD2 = d2ok ? mk(d2.hourly, 'ICON-D2') : new Map();
  const mIfs = ifsok ? mk(ifs.hourly, 'IFS') : new Map();
  const hourMap = new Map(mIfs);
  for (const [t, v] of mD2) if (isNum(v.temp)) hourMap.set(t, v);

  // ---- MOSMIX (Bright Sky): nur mit passender Station ----
  let mosmix = null;
  if (bsW?.weather?.length && bsW.sources?.length) {
    const src = new Map(bsW.sources.map((s) => [s.id, s]));
    const good = (s) => s && isNum(s.distance) && s.distance <= 20000 && (elev == null || !isNum(s.height) || Math.abs(s.height - elev) <= 100);
    const pts = [];
    let station = null;
    for (const r of bsW.weather) {
      const s = src.get(r.source_id);
      if (!good(s) || !isNum(r.temperature)) continue;
      const t = Date.parse(r.timestamp);
      pts.push({ t, temp: r.temperature, wind: r.wind_speed, gust: r.wind_gust_speed, obs: s.observation_type });
      if (s.observation_type === 'forecast' || !station) station = s;
    }
    if (pts.length > 12) mosmix = { pts, station };
  }
  if (mosmix) {
    for (const p of mosmix.pts) {
      const h = hourMap.get(p.t);
      if (!h) continue;
      const delta = isNum(h.temp) ? p.temp - h.temp : 0;
      h.temp = p.temp;
      if (isNum(h.feels)) h.feels += delta;
      if (isNum(p.wind)) h.wind = p.wind;
      if (isNum(p.gust)) h.gust = p.gust;
      h.src = 'MOSMIX';
    }
  }

  // ---- Jetzt ----
  const hourNow = Math.floor(nowUtc / 3600000) * 3600000;
  const cur = (d2ok ? d2.current : ifs?.current) || null;
  let now = null;
  const hn = hourMap.get(hourNow);
  if (cur && isNum(cur.temperature_2m)) {
    now = { temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, isDay: cur.is_day === 1,
      wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, humidity: cur.relative_humidity_2m, src: d2ok ? 'ICON-D2' : 'IFS', at: parseLocal(cur.time, off) };
  } else if (hn) {
    now = { temp: hn.temp, feels: hn.feels, code: hn.code, isDay: hn.isDay, wind: hn.wind, gust: hn.gust, humidity: null, src: hn.src, at: hn.t };
  }
  if (!now) throw new Error('Kein Jetzt-Wert');
  // gemessener Wert, wenn Messung <= 40 Min alt und Station passt
  const cw = bsC?.weather;
  if (cw && bsC.sources?.length && isNum(cw.temperature)) {
    const s = bsC.sources.find((x) => x.id === cw.source_id) || bsC.sources[0];
    const age = nowUtc - Date.parse(cw.timestamp);
    const near = s && isNum(s.distance) && s.distance <= 20000 && (elev == null || !isNum(s.height) || Math.abs(s.height - elev) <= 100);
    if (near && age >= 0 && age <= 40 * 60000) {
      const delta = cw.temperature - now.temp;
      if (isNum(now.feels)) now.feels += delta;
      now.temp = cw.temperature;
      if (isNum(cw.wind_speed_10)) now.wind = cw.wind_speed_10;
      if (isNum(cw.wind_gust_speed_10)) now.gust = cw.wind_gust_speed_10;
      if (isNum(cw.relative_humidity)) now.humidity = cw.relative_humidity;
      now.src = 'DWD-Messung';
      now.station = s.station_name;
      now.distKm = s.distance / 1000;
      now.at = Date.parse(cw.timestamp);
    }
  }
  if (!now.station && mosmix?.station) { now.mosStation = mosmix.station.station_name; }

  // ---- Stundenliste: ab voller Stunde bis +48 h ----
  const hours = [...hourMap.values()].filter((h) => h.t >= hourNow - 3600000 && h.t <= hourNow + 48 * 3600000 && isNum(h.temp)).sort((a, b) => a.t - b.t);
  const past = [...hourMap.values()].filter((h) => h.t < hourNow && h.t >= hourNow - 24 * 3600000).sort((a, b) => a.t - b.t);

  // 15-Minuten-Regen (nächste 3 Std)
  const min15 = [];
  if (d2ok && d2.minutely_15?.time) d2.minutely_15.time.forEach((s, i) => min15.push({ t: parseLocal(s, off), p: (d2.minutely_15.precipitation?.[i] ?? 0) * 4 }));

  // ---- Tage ----
  const todayKey = dayKey(nowUtc, off);
  const byDay = new Map();
  for (const h of hourMap.values()) {
    const k = dayKey(h.t, off);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(h);
  }
  const days = [];
  const ifsDaily = ifs?.daily;
  const keys = [];
  if (ifsDaily?.time) ifsDaily.time.forEach((k) => keys.push(k));
  else { for (let i = 0; i < 3; i++) keys.push(dayKey(nowUtc + i * 86400000, off)); }
  const allDays = keys.map((k, i) => {
    const o = { key: k, t0: parseLocal(`${k}T00:00`, off) };
    if (ifsDaily?.time) {
      o.code = ifsDaily.weather_code?.[i]; o.tmax = ifsDaily.temperature_2m_max?.[i]; o.tmin = ifsDaily.temperature_2m_min?.[i];
      o.precip = ifsDaily.precipitation_sum?.[i]; o.gust = ifsDaily.wind_gusts_10m_max?.[i];
      o.sunrise = ifsDaily.sunrise?.[i] ? parseLocal(ifsDaily.sunrise[i], off) : null;
      o.sunset = ifsDaily.sunset?.[i] ? parseLocal(ifsDaily.sunset[i], off) : null;
      o.src = 'IFS';
    }
    return o;
  });
  const dIdx = (k) => allDays.findIndex((d) => d.key === k);
  const ti = dIdx(todayKey);
  const yesterday = ti > 0 ? allDays[ti - 1] : null;
  const from = ti >= 0 ? ti : 0;
  for (let i = from; i < allDays.length; i++) days.push(allDays[i]);

  // heute und morgen aus ICON-D2-Stunden
  if (d2ok) {
    days.slice(0, 2).forEach((d) => {
      const hs = (byDay.get(d.key) || []).filter((h) => mD2.has(h.t) || h.src === 'MOSMIX');
      const real = hs.filter((h) => isNum(h.temp));
      if (real.length >= 16) {
        d.tmax = Math.max(...real.map((h) => h.temp)); d.tmin = Math.min(...real.map((h) => h.temp));
        d.precip = real.reduce((a, h) => a + (h.precip || 0), 0);
        d.gust = Math.max(...real.map((h) => h.gust ?? 0));
        const day = real.filter((h) => { const p = parts(h.t, off); return p.h >= 7 && p.h <= 21; });
        const worst = (day.length ? day : real).reduce((a, h) => (severity(h.code) > severity(a.code) ? h : a));
        d.code = worst.code;
        d.src = 'ICON-D2';
      }
    });
  }
  // MOSMIX-Tagesextreme für vollständig abgedeckte Tage, danach Angleichung
  let adjust = null;
  if (mosmix) {
    const per = new Map();
    for (const p of mosmix.pts) {
      const k = dayKey(p.t, off);
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(p.temp);
    }
    const diffs = [];
    let lastCovered = -1;
    days.forEach((d, i) => {
      const a = per.get(d.key);
      if (a && a.length >= 20) {
        const mx = Math.max(...a), mn = Math.min(...a);
        if (isNum(d.tmax)) diffs.push({ i, dmax: mx - d.tmax, dmin: mn - d.tmin });
        d.tmax = mx; d.tmin = mn; d.src = 'MOSMIX'; lastCovered = i;
      }
    });
    if (lastCovered >= 0 && diffs.length) {
      const tail = diffs.slice(-3);
      const avg = tail.reduce((s, x) => s + (x.dmax + x.dmin) / 2, 0) / tail.length;
      if (Math.abs(avg) >= 0.05) {
        adjust = avg;
        days.forEach((d, i) => { if (i > lastCovered && isNum(d.tmax)) { d.tmax += avg; d.tmin += avg; d.adj = true; } });
      }
    }
  }

  // ---- Ensemble ----
  if (ens?.daily?.time) {
    const dd = ens.daily;
    const kk = Object.keys(dd);
    const members = (pref) => kk.filter((k) => k.startsWith(pref) && Array.isArray(dd[k]));
    const mx = members('temperature_2m_max'), mn = members('temperature_2m_min'), pr = members('precipitation_sum');
    ens.daily.time.forEach((k, i) => {
      const d = days.find((x) => x.key === k);
      if (!d) return;
      const col = (arr) => arr.map((a) => dd[a][i]).filter(isNum).sort((a, b) => a - b);
      const A = col(mx), B = col(mn), C = col(pr);
      if (A.length < 5) return;
      const shift = d.adj && adjust ? adjust : 0;
      d.ens = {
        n: A.length,
        tmax: [percentile(A, 0.1) + shift, percentile(A, 0.5) + shift, percentile(A, 0.9) + shift],
        tmin: B.length ? [percentile(B, 0.1) + shift, percentile(B, 0.5) + shift, percentile(B, 0.9) + shift] : null,
        regenChance: C.length ? C.filter((v) => v >= 0.1).length / C.length : null,
        regenP50: C.length ? percentile(C, 0.5) : null, regenP90: C.length ? percentile(C, 0.9) : null,
      };
    });
  }

  return {
    v: 1, loc, fetchedAt: nowUtc, off, tz, elev,
    now, hours, hourly: [...hourMap.values()].filter((h) => isNum(h.temp) && h.t >= hourNow - 24 * 3600000).sort((a, b) => a.t - b.t).map((h) => ({ t: h.t, temp: h.temp, feels: h.feels, precip: h.precip, code: h.code, isDay: h.isDay, wind: h.wind, gust: h.gust, dir: h.dir })), past, min15, days, yesterday, adjust,
    mosmixStation: mosmix?.station ? { name: mosmix.station.station_name, km: mosmix.station.distance / 1000 } : null,
    sources: { d2: d2ok, ifs: ifsok, mosmix: !!mosmix, ens: !!ens?.daily },
  };
}

// ---- Cache (nur auf diesem Gerät) ----
const KEY = (loc) => `wf:wx:${loc.id}`;
export function saveCache(loc, model) {
  try { localStorage.setItem(KEY(loc), JSON.stringify(model)); } catch { /* voll */ }
}
export function readCache(loc) {
  try { const s = localStorage.getItem(KEY(loc)); return s ? JSON.parse(s) : null; } catch { return null; }
}
