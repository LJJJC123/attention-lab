/* Zero-dependency static server for the exported site.
 *
 *   node tools/serve.mjs [--port 4310] [--dir out]
 *
 * Why not `next start`: with `output: 'export'` there is no server build to
 * start — the deliverable is a folder of files. And why not `npx serve`: that
 * pulls a package over the network, which fails exactly when you are trying to
 * check whether the site works offline.
 *
 * The two behaviours a static host must get right, and that this reproduces:
 *   1. directory URLs serve their index.html (trailingSlash: true means the
 *      export emits `/index.html`, `/404.html`, ...)
 *   2. an unknown path falls back to 404.html with a real 404 status, so the
 *      service worker's navigation fallback has something coherent to serve.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize, resolve } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

/* PORT env first, --port second.
 *
 * Order matters and the reason is deployment, not preference: hosting platforms
 * (and this project's own publish flow) assign the public port through the
 * environment and reach the app through a reverse proxy. A server that only
 * reads --port listens somewhere the proxy cannot reach, the health check
 * fails, and the platform silently keeps serving the *previous* deployment —
 * which looks exactly like "my deploy did nothing". Reading PORT first makes
 * the same command work unchanged locally and on a host. */
const PORT = Number(process.env.PORT || arg('--port', 4310));
const DIR = resolve(arg('--dir', 'out'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  // Strip the query/hash, decode, and refuse any traversal outside DIR.
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const safe = normalize(clean).replace(/^(\.\.[/\\])+/, '');
  const full = join(DIR, safe);
  if (!full.startsWith(DIR)) return null; // traversal attempt

  try {
    const st = statSync(full);
    if (st.isDirectory()) {
      const idx = join(full, 'index.html');
      statSync(idx);
      return idx;
    }
    return full;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  let file = resolveFile(req.url || '/');

  // A service worker must be served from the root of its scope, never from a
  // redirect or a 404 page, or the browser rejects it with a MIME-type error.
  if (!file && req.url) {
    const fallback = join(DIR, '404.html');
    // The 404 page is optional — a directory served at a sub-path may not have
    // one at its own root. Crashing here would take the server down on the very
    // first stray request, so fall back to a plain-text response.
    if (existsSync(fallback)) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(fallback).on('error', () => res.end('404')).pipe(res);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
    return;
  }

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }

  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type };
  // A service worker must not be held by an intermediary cache.
  if (file.endsWith('sw.js')) headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers);
  // A stream error after the headers are sent cannot change the status, but it
  // must not take the whole server down either.
  createReadStream(file)
    .on('error', () => res.end())
    .pipe(res);
});

server.listen(PORT, () => {
  console.log(`attention-lab serving ${DIR}`);
  console.log(`  local:    http://localhost:${PORT}`);
  for (const [k, v] of Object.entries(networkAddresses())) {
    console.log(`  network:  http://${v}:${PORT}   (${k})`);
  }
  console.log('  phone on the same wifi can open the network address');
});

function networkAddresses() {
  const out = {};
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out[name] = ni.address;
    }
  }
  return out;
}
