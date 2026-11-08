// Kleine Helfer: Formatierung, Zeit, Datum
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const pad = (n) => String(n).padStart(2, '0');
export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WD_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function de(n, d = 0) {
  if (n == null || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const deg = (n) => (n == null || Number.isNaN(n) ? '–' : `${Math.round(n)}°`);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Java String.hashCode: gleicher Seed wie in der Android-App
export function javaHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// "2026-11-08T08:00" (Ortszeit) -> epoch ms, offSec = UTC-Offset des Ortes
export function parseLocal(str, offSec) {
  const m = String(str).match(/(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
  if (!m) return NaN;
  return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offSec * 1000;
}

// epoch ms -> Ortszeit-Teile
export function parts(ms, offSec) {
  const d = new Date(ms + offSec * 1000);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
    key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  };
}
export const fmtTime = (ms, off) => { const p = parts(ms, off); return `${pad(p.h)}:${pad(p.mi)}`; };
export const dayKey = (ms, off) => parts(ms, off).key;

export function dateFromKey(key) { // "YYYY-MM-DD" -> epochDay
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
export function dowOfKey(key) { return new Date(dateFromKey(key) * 86400000).getUTCDay(); }

export function ago(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tg.`;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function compass(deg) {
  if (!isNum(deg)) return '';
  return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
