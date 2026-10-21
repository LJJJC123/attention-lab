/* Contrast self-check. Reads the real token values out of tokens.css so the
 * numbers below can never drift from what the app actually renders.
 *
 *   node tools/contrast.mjs
 *
 * Exits non-zero if any pair fails, so it can gate a build. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* OKLCH -> sRGB, then WCAG relative luminance. */
function oklch2rgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const f = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055);
  return [f(r), f(g), f(bl)].map((v) => Math.min(1, Math.max(0, v)));
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* Pull `--name: oklch(L% C H)` out of tokens.css. OKLCH's L is a 0-1 scale and
 * tokens.css writes it as a percentage, so divide by 100 — feeding `16` in as
 * L clips every channel to 1 and silently reports 1.00:1 for every pair. */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)%?\\s+([\\d.]+)\\s+([\\d.]+)`));
  if (!m) throw new Error(`token --${name} not found or not an oklch() literal`);
  const L = parseFloat(m[1]);
  return oklch2rgb(m[1].includes('%') || L > 1 ? L / 100 : L, +m[2], +m[3]);
}

/* [foreground, background, minimum, what it is] — 4.5 for body text, 3 for
 * large text (>=18.66px bold / 24px), borders and focus rings. */
const PAIRS = [
  ['ink-1', 'paper-0', 4.5, 'body text on the page'],
  ['ink-2', 'paper-0', 4.5, 'secondary prose'],
  ['ink-2', 'paper-1', 4.5, 'prose inside a card'],
  ['ink-3', 'paper-0', 4.5, 'muted label on the page'],
  ['ink-3', 'paper-1', 4.5, 'muted label in a card'],
  ['ink-3', 'paper-2', 4.5, 'table header / axis label'],
  ['accent', 'paper-0', 4.5, 'tag text on the page'],
  ['accent', 'paper-1', 4.5, 'tag text in a card'],
  ['accent', 'paper-2', 4.5, 'tag text on a raised chip'],
  ['accent-dim', 'paper-1', 4.5, 'secondary series (bars) — needs to read as data'],
  ['accent-dim', 'paper-2', 4.5, 'series on a raised surface'],
  ['on-accent', 'accent', 4.5, 'text on the primary button'],
  ['good', 'paper-0', 4.5, 'correct / calm verdict'],
  ['good', 'paper-1', 4.5, 'correct inside a card'],
  ['warn', 'paper-0', 4.5, 'drift warning'],
  ['bad', 'paper-0', 4.5, 'wrong verdict'],
  ['focus', 'paper-0', 3, 'focus ring against the page'],
  ['focus', 'paper-1', 3, 'focus ring against a card'],
];

let failed = 0;
const rows = PAIRS.map(([fg, bg, need, what]) => {
  const r = ratio(token(fg), token(bg));
  const ok = r >= need;
  if (!ok) failed++;
  const label = `${fg} on ${bg}`.padEnd(28);
  return `${ok ? 'PASS' : 'FAIL'}  ${label} ${r.toFixed(2).padStart(5)}:1  need ${need}  ${what}`;
});

console.log(rows.join('\n'));
console.log(`\n${rows.length - failed}/${rows.length} contrast pairs pass`);
if (failed) {
  console.log('Fix the token, not the usage: a colour that cannot clear 4.5:1 on its own surface');
  console.log('has no business being used as text on that surface.');
}
process.exit(failed ? 1 : 0);