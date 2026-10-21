/* Deploy-time configuration.
 *
 * Next rewrites asset URLs from next.config at build time, but two things are
 * runtime strings it cannot know about:
 *
 *  - the <link rel="manifest">, whose href ends up in the installed-app manifest
 *  - the service worker registration URL, which determines the SW's *scope*
 *
 * Both must respect the base path, or a site hosted under /<repo>/ will register
 * a worker scoped to the domain root (where it cannot control the page) or fail
 * to load its manifest at all.
 *
 * Read by the server (layout.js) and by client components, so it must stay free
 * of 'use client' and of function exports — those are errors across that
 * boundary rather than strings.
 *
 * On Windows a shell can hand us a mangled value ("C:/.../attention-lab" where
 * "/attention-lab" was meant), so anything that is not a clean absolute path is
 * discarded and treated as domain-root hosting.
 */
const RAW = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const BASE_PATH = /^\/[A-Za-z0-9._\-/]*$/.test(RAW) ? RAW.replace(/\/+$/, '') : '';

export const assetUrl = (p) => `${BASE_PATH}${p}`;

/* Client components cannot import this and expect a literal: inside a
 * 'use client' module Next keeps the expression rather than inlining the value,
 * so the registration URL would resolve to "/sw.js" even under a base path.
 * Instead the resolved value is stamped onto <html> at render time and read back
 * from the DOM, which is a genuine single source of truth. */
export const BASE_PATH_ATTR = 'data-base-path';
