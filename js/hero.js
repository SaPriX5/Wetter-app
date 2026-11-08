// Wettersymbole: Meteocons von Bas Milius (MIT), Stil "fill". Kopfbereich animiert, Listen ruhig (ohne Animation).
const pick = (c, d) => {
  const day = (a, b) => (d ? a : b);
  if (c === 0 || c === 1) return day('clear-day', 'clear-night');
  if (c === 2) return day('partly-cloudy-day', 'partly-cloudy-night');
  if (c === 45 || c === 48) return 'fog';
  if ([51, 53, 55].includes(c)) return 'drizzle';
  if ([61, 63].includes(c)) return 'rain';
  if ([65].includes(c)) return 'extreme-rain';
  if ([56, 57, 66, 67].includes(c)) return 'sleet';
  if ([80, 81].includes(c)) return day('partly-cloudy-day-rain', 'partly-cloudy-night-rain');
  if (c === 82) return 'extreme-rain';
  if ([71, 73, 77, 85].includes(c)) return 'snow';
  if ([75, 86].includes(c)) return 'extreme-snow';
  if (c === 95) return 'thunderstorms-rain';
  if (c === 96 || c === 99) return 'thunderstorms-extreme-rain';
  return 'overcast';
};
export const iconName = pick;
export const heroIcon = (code, isDay = true) => `<img class="hero-img" src="wx/anim/${pick(code, isDay)}.svg" alt="" draggable="false">`;
export const smallIcon = (code, isDay, size) => `<img class="wi" src="wx/static/${pick(code, isDay)}.svg" width="${size}" height="${size}" alt="" draggable="false">`;

export const svgIcon = (code, isDay, size) => `<image href="wx/static/${pick(code, isDay)}.svg" width="${size}" height="${size}"/>`;

const C = { drop: '#5aa2f0', l: 'var(--cl-l,#f3f7fc)', m: 'var(--cl-m,#b9c5d4)' };
const fill = (c) => `style="fill:${c}"`;
const cloud = (x, y, s, tone) => `<g transform="translate(${x} ${y}) scale(${s})"><g ${fill(C[tone])}><circle cx="62" cy="108" r="26"/><circle cx="96" cy="90" r="36"/><circle cx="132" cy="106" r="28"/><rect x="40" y="104" width="118" height="30" rx="15"/></g></g>`;
const svg = (inner, cls, extra = '') => `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true" ${extra}>${inner}</svg>`;


export function stateIcon(kind) {
  if (kind === 'laedt') return svg(`<g class="spin"><circle cx="100" cy="100" r="46" fill="none" stroke="${C.drop}" stroke-width="12" stroke-linecap="round" stroke-dasharray="90 200"/></g>`, 'hero-svg');
  if (kind === 'offline') return svg(cloud(0, 6, 1.04, 'm') + '<path d="M52 170 148 52" stroke="#e15b4d" stroke-width="10" stroke-linecap="round"/>', 'hero-svg');
  if (kind === 'fehler') return svg(cloud(0, 0, 1.04, 'm') + '<text x="100" y="128" text-anchor="middle" font-size="64" font-weight="700" fill="#e15b4d">!</text>', 'hero-svg');
  return heroIcon(0, true);
}
