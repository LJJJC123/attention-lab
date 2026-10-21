/* End-to-end check against the running app, in a real browser, with real timers.
 *
 *   node tests/e2e.mjs [url]        (default http://localhost:4310)
 *
 * How it works: tests/harness.html is copied into public/ (same origin as the
 * app, so the driver may reach into the iframe's DOM), loaded headlessly, and
 * it clicks through the entire product the way a user would. The harness writes
 * its verdict into <pre id="out">; we read it back. The copy in public/ is
 * deliberately left in place: Next.js only serves what existed at build time,
 * so deleting it here would make the next run 404 before the page even loads.
 * Delete public/e2e-harness.html by hand once you no longer need this test.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = process.argv[2] || 'http://localhost:4310/';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// resolve the harness URL against the app's origin, ignoring any query/hash.
// Must match the filename copied into public/ below.
const harnessUrl = new URL('e2e-harness.html', new URL('/', target)).href;
if (!harnessUrl.includes('e2e-harness.html')) {
  console.error('FAIL  harness URL did not resolve: ' + harnessUrl);
  process.exit(1);
}

if (!existsSync(EDGE)) {
  console.error('BLOCKED: Edge not found at ' + EDGE);
  process.exit(2);
}

const src = join(here, 'harness.html');
const dst = join(root, 'public', 'e2e-harness.html');

const copy = spawn('cmd', ['/c', 'mkdir', join(root, 'public')], { stdio: 'ignore' });
await new Promise((r) => copy.on('close', r));
copyFileSync(src, dst);

// The static export is a build-time snapshot, so a harness copied after the
// last `next build` is absent from out/ and the server 404s on it. Copying it
// into both trees keeps `npm run serve` (out/) and `next start`-style setups
// working without asking the caller to remember a build step.
const exported = join(root, 'out', 'e2e-harness.html');
if (existsSync(join(root, 'out'))) {
  try { copyFileSync(src, exported); } catch { /* export not built yet */ }
}

const profile = mkdtempSync(join(tmpdir(), 'al-e2e-'));

const runEdge = () =>
  new Promise((resolve) => {
    const p = spawn(
      EDGE,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        `--user-data-dir=${profile}`,
        // virtual time lets the 60-trial warm-up finish without waiting in real time
        '--virtual-time-budget=120000',
        '--dump-dom',
        harnessUrl,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ out, err, code }));
  });

const { out } = await runEdge();
rmSync(profile, { recursive: true, force: true });
// The harness stays in public/ — Next.js only serves what was present at build
// time, so removing it here would make the next run 404 before it can even
// load the page. Delete it manually once you no longer need this test.
void dst;

// The verdict sits in <pre id="out">. Extract by node boundaries rather than by
// a regex over the raw dump: JSON containing "<\/pre>"-adjacent text and
// HTML-escaped quotes both defeat a naive pattern.
const preMatch = out.match(/<pre[^>]*\bid="out"[^>]*>([\s\S]*?)<\/pre>/);
if (!preMatch) {
  console.error('FAIL  harness produced no verdict — page did not boot or threw early');
  console.error('       dump bytes: ' + out.length + '  title: ' + (out.match(/<title[^>]*>([^<]*)/)?.[1] || '?'));
  console.error('       ' + (out.includes('pending') ? 'harness never finished (app failed to load in the iframe)' : 'no #out node in the dump'));
  process.exit(1);
}
const verdictText = preMatch[1];
const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

let r, errs;
try {
  r = JSON.parse(unescapeHtml(verdictText).match(/RESULT (\{.*?\}) ERRS (\[.*\])/s)[1]);
  errs = JSON.parse(unescapeHtml(verdictText).match(/RESULT (\{.*?\}) ERRS (\[.*\])/s)[2]);
} catch (e) {
  console.error('FAIL  could not parse verdict: ' + e.message);
  console.error('       raw: ' + verdictText.slice(0, 300));
  process.exit(1);
}

console.log('e2e — ' + r.total + ' browser assertions');
for (const l of r.log) {
  console.log((l.ok ? '  ok  ' : 'FAIL  ') + l.name + (l.extra ? '   [' + l.extra + ']' : ''));
}
if (errs.length) {
  console.log('\npage errors captured:');
  for (const e of errs.slice(0, 10)) console.log('  ! ' + e);
}
console.log('\n' + (r.total - r.failed) + '/' + r.total + ' passed');
process.exit(r.failed ? 1 : 0);
