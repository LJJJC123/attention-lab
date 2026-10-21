/** @type {import('next').NextConfig} */

/* Deploy base path.
 *
 * Next emits root-absolute asset URLs ("/_next/static/..."). That works when the
 * site is served from a domain root, and breaks completely on GitHub Pages,
 * where every project lives under "/<repo>/" — the CSS and JS would 404 and the
 * page would render as unstyled text.
 *
 * So the base path is configurable at build time and defaults to empty:
 *
 *   BASE_PATH=/attention-lab npm run build      # project pages
 *   npm run build                                # domain root (default)
 *
 * `NEXT_PUBLIC_BASE_PATH` is read by the app itself (manifest link, service
 * worker registration) because those two are runtime values, not build-time
 * asset rewrites. Both must be set, or the SW will register at the wrong scope.
 */
const basePath = process.env.BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,

  /* Pure static export.
   *
   * The app has no server component, no API route, no image optimisation and no
   * session — all state lives in localStorage. A Node process on someone's
   * server buys nothing, while `output: 'export'` buys the one thing that
   * matters here: the built site is a folder of files that can be dropped on
   * GitHub Pages, any static host, or a USB stick, and keeps working with the
   * server switched off.
   *
   * `sw.js` and the icons must stay un-fingerprinted real files — the service
   * worker registers by a fixed URL and its own cache version is the only thing
   * that can invalidate it.
   */
  output: 'export',
  images: { unoptimized: true },
  // A directory-style URL ("/about/") is what every static host serves
  // correctly from a folder; "/about" works on some and 404s on others.
  trailingSlash: true,

  ...(basePath ? { basePath, assetPrefix: basePath + '/' } : {}),
};

export default nextConfig;
