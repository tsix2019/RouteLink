// Shared vector source for every RouteLink icon variant (1024x1024 canvas).
// A router body with status-light cutouts (even-odd) and three Wi-Fi arcs above it.

export const BRAND_FROM = '#0A5BFF';
export const BRAND_TO = '#14C8C8';

const body =
  'M304,580 H720 A72,72 0 0 1 792,652 V708 A72,72 0 0 1 720,780 H304 A72,72 0 0 1 232,708 V652 A72,72 0 0 1 304,580 Z ' +
  'M316,680 a24,24 0 1 0 48,0 a24,24 0 1 0 -48,0 Z ' +
  'M396,680 a24,24 0 1 0 48,0 a24,24 0 1 0 -48,0 Z ' +
  'M476,680 a24,24 0 1 0 48,0 a24,24 0 1 0 -48,0 Z ' +
  'M608,664 H700 A16,16 0 0 1 716,680 A16,16 0 0 1 700,696 H608 A16,16 0 0 1 592,680 A16,16 0 0 1 608,664 Z';

const arcs = [
  'M434.2,482.2 A110,110 0 0 1 589.8,482.2',
  'M370.6,418.6 A200,200 0 0 1 653.4,418.6',
  'M306.9,354.9 A290,290 0 0 1 717.1,354.9',
];

/** White glyph markup; `scale` shrinks it around the canvas centre (used for the splash). */
export function glyph(color = '#FFFFFF', scale = 1): string {
  const t = scale === 1 ? '' : ` transform="translate(${512 * (1 - scale)} ${512 * (1 - scale)}) scale(${scale})"`;
  return (
    `<g${t}>` +
    `<path d="${body}" fill="${color}" fill-rule="evenodd"/>` +
    arcs.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="56" stroke-linecap="round"/>`).join('') +
    `</g>`
  );
}

export function gradientDefs(id = 'bg'): string {
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${BRAND_FROM}"/><stop offset="1" stop-color="${BRAND_TO}"/>` +
    `</linearGradient></defs>`
  );
}

export const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;
