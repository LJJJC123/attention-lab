import './globals.css';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { BASE_PATH, BASE_PATH_ATTR } from '../lib/basePath';

/* Two faces, and the pairing is load-bearing rather than decorative:
 *
 * Plex Sans carries prose and the Chinese falls through to the platform CJK
 * face (Plex has no CJK coverage, and shipping a full CJK webfont here would
 * cost megabytes for a page whose whole promise is "the data stays with you" —
 * a privacy promise that a 4MB font download quietly undercuts).
 *
 * Plex Mono carries every number in the app: the clock, reaction times, the
 * presentation window, bar labels, table columns. Tabular figures that don't
 * reflow are what make a measuring instrument look like one; with the previous
 * sans-everywhere stack, `11:07` jittered as digits changed.
 *
 * next/font downloads and self-hosts at build time, so there is no runtime
 * request to a third party — which matters here, since a Google Fonts <link>
 * would hand a tracking beacon to every user of a tool whose entire pitch is
 * that nothing leaves the browser. */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata = {
  title: '注意力工作台 · Attention Lab',
  description: '处理速度热身 + 分心感知专注块。只统计你愿意交给它的数据。',
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: '注意力',
    // "black-translucent" would put content under the status bar on a dark
    // theme; "default" keeps the status bar readable and lets
    // env(safe-area-inset-top) do its job without guessing.
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: `${BASE_PATH}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${BASE_PATH}/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: `${BASE_PATH}/apple-touch-icon.png`, sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: '#1a1712',
  width: 'device-width',
  initialScale: 1,
  // Required for env(safe-area-inset-*) to be non-zero on notched phones.
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    /* The base path is stamped here so client code can read the resolved value
     * from the DOM. Inside a 'use client' module Next keeps the *expression*
     * `process.env.NEXT_PUBLIC_BASE_PATH` instead of inlining it, so importing
     * this constant from a component yields "/sw.js" even under a base path. */
    <html
      lang="zh-CN"
      className={`${plexSans.variable} ${plexMono.variable}`}
      {...{ [BASE_PATH_ATTR]: BASE_PATH }}
    >
      <body>{children}</body>
    </html>
  );
}
