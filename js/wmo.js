import { smallIcon, svgIcon } from './hero.js';
// WMO-Wettercodes -> deutscher Text, Klasse und kleine SVG-Icons
export const RAIN = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82];
export const SNOW = [71, 73, 75, 77, 85, 86];
export const FOG = [45, 48];
export const STORM = [95, 96, 99];

export function kindOf(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (FOG.includes(code)) return 'fog';
  if (RAIN.includes(code)) return 'rain';
  if (SNOW.includes(code)) return 'snow';
  if (STORM.includes(code)) return 'storm';
  return 'cloud';
}

const TEXT = {
  0: 'Sonnig', 1: 'Sonnig', 2: 'Teils bewölkt', 3: 'Wolkig',
  45: 'Nebel', 48: 'Nebel mit Reif',
  51: 'Leichter Regen', 53: 'Leichter Regen', 55: 'Regen',
  56: 'Gefrierender Regen', 57: 'Gefrierender Regen',
  61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
  66: 'Gefrierender Regen', 67: 'Gefrierender Regen',
  71: 'Leichter Schnee', 73: 'Schnee', 75: 'Starker Schnee', 77: 'Schneegriesel',
  80: 'Leichter Regen', 81: 'Regen', 82: 'Starkregen',
  85: 'Schneeschauer', 86: 'Starker Schnee',
  95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel',
};
export function wmoText(code, isDay = true, temp = null) {
  if (code === 0 || code === 1) return isDay ? 'Sonnig' : 'Klar';
  if (RAIN.includes(code) && temp != null && temp > -0.5 && temp < 1.5 && ![56, 57, 66, 67].includes(code)) {
    if (code >= 61 || code >= 80) return 'Schneeregen';
  }
  return TEXT[code] ?? 'Wolkig';
}

// Schweregrad für die Tageszusammenfassung (höher = auffälliger)
export function severity(code) {
  if ([96, 99].includes(code)) return 100;
  if (code === 95) return 95;
  if ([65, 82, 75, 86].includes(code)) return 80;
  if ([66, 67, 56, 57].includes(code)) return 75;
  if ([63, 81, 73, 85].includes(code)) return 60;
  if ([61, 80, 71, 77, 55].includes(code)) return 45;
  if ([51, 53].includes(code)) return 35;
  if (FOG.includes(code)) return 25;
  if (code === 3) return 15;
  if (code === 2) return 8;
  return 0;
}

export const iconSvg = (code, isDay = true, size = 28) => svgIcon(code, isDay, size);
export const icon = (code, isDay = true, size = 28) => smallIcon(code, isDay, size);
