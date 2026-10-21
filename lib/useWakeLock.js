'use client';
/* Screen Wake Lock — the thing that makes a focus block measurable on a phone.
 *
 * Why this file exists at all:
 *
 * On a desktop the focus block works because you leave the tab on purpose —
 * you go work in another window, this page stays visible, and every
 * `visibilitychange` is a genuine distraction. On a phone that model breaks.
 * The realistic phone usage is "put the phone face-down and work", and the
 * moment the screen sleeps the page fires `visibilitychange` and a 25-minute
 * block reports 25 minutes of drift. The measurement is worse than useless:
 * it is confidently wrong.
 *
 * So the block offers two honest modes instead of one silently-broken one:
 *
 *   'screen' — hold a screen wake lock, the display stays on, and leaving the
 *              page really does mean you picked up another app. Drift is
 *              measured and comparable with desktop blocks.
 *   'off'    — face-down mode. The screen may sleep; that is the point. Focus
 *              time is still counted, drift is not measured at all, and the
 *              block is stored with driftMode:'off' so the report can exclude
 *              it from drift statistics instead of averaging in a 100% figure.
 *
 * The browser releases a wake lock whenever the page is hidden, so it has to be
 * re-acquired on every return. That is not a bug to work around — it is the
 * signal we want: if we hold a lock the whole time, every hidden period was a
 * real app switch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const WAKE_STATE = {
  UNSUPPORTED: 'unsupported',
  IDLE: 'idle',
  HELD: 'held',
  DENIED: 'denied',
};

/* Browsers cap how long a wake lock stays valid. Renew well before that. */
const RENEW_MS = 20000;

export function useWakeLock(active) {
  const [state, setState] = useState(
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? WAKE_STATE.IDLE : WAKE_STATE.UNSUPPORTED
  );
  const sentinel = useRef(null);
  const timer = useRef(0);

  const release = useCallback(() => {
    clearTimeout(timer.current);
    const s = sentinel.current;
    sentinel.current = null;
    if (s && typeof s.release === 'function') {
      // release() rejects with NotAllowedError if the document is not visible;
      // that is the expected path on teardown, not a failure.
      const p = s.release();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }, []);

  const acquire = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setState(WAKE_STATE.UNSUPPORTED);
      return;
    }
    try {
      const s = await navigator.wakeLock.request('screen');
      sentinel.current = s;
      setState(WAKE_STATE.HELD);
      s.addEventListener('release', () => {
        if (sentinel.current === s) setState(WAKE_STATE.IDLE);
      });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // Renew rather than assume: a dropped lock must show up as 'idle',
        // because the report's trust flag reads this state.
        if (sentinel.current === s) {
          release();
          acquire();
        }
      }, RENEW_MS);
    } catch {
      setState(WAKE_STATE.DENIED);
    }
  }, [release]);

  useEffect(() => {
    if (!active) {
      release();
      setState(
        typeof navigator !== 'undefined' && 'wakeLock' in navigator ? WAKE_STATE.IDLE : WAKE_STATE.UNSUPPORTED
      );
      return;
    }
    let cancelled = false;
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible' && !sentinel.current) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      release();
    };
  }, [active, acquire, release]);

  return { state, held: state === WAKE_STATE.HELD, supported: state !== WAKE_STATE.UNSUPPORTED };
}
