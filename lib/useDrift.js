'use client';
/* Drift detection.
 *
 * The whole product claim rests on this file, so the root-cause decisions:
 *
 * 1. Two independent signals, not one. `visibilitychange` catches tab switches
 *    and window minimising. `blur` alone misses some of those and fires on
 *    devtools / permission prompts, so it is corroborating evidence only.
 * 2. Timestamps are taken from Date.now(), never from a frame counter. The
 *    block's elapsed clock and the drift record must share one time base.
 * 3. A drift under 800ms is dropped downstream as noise (tab-strip hover,
 *    accidental focus loss). Trimming here keeps the payload small.
 * 4. Suppressed while a modal is open so the report's own UI never inflates
 *    the drift count.
 * 5. `measured` exists because on a phone the page is *expected* to go
 *    hidden: you put the phone face down and the screen sleeps, which fires
 *    the exact same event as picking up Instagram. Without this flag a
 *    face-down 25-minute block reports 100% drift. When the caller says the
 *    block is not measuring drift, we attach no listeners at all and record
 *    nothing — silence beats a confidently wrong number.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const NOISE_MS = 800;

export function useDrift(active, paused, measured = true) {
  const [drifts, setDrifts] = useState([]);
  const awayAt = useRef(null);

  const close = useCallback(() => {
    const at = awayAt.current;
    if (at == null) return;
    awayAt.current = null;
    const ms = Date.now() - at;
    if (ms < NOISE_MS) return;
    setDrifts((prev) => [...prev, { at, ms }]);
  }, []);

  const open = useCallback(() => {
    if (!active || paused || awayAt.current != null) return;
    awayAt.current = Date.now();
  }, [active, paused]);

  useEffect(() => {
    if (!active || !measured) return;
    const onVis = () => (document.hidden ? open() : close());
    const onBlur = () => open();
    const onFocus = () => close();

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, paused, measured, open, close]);

  return { drifts, reset: () => setDrifts([]) };
}

/* Elapsed clock. Driven by a wall-clock deadline rather than by counting
 * ticks: a throttled background tab still lands on the right number.
 *
 * Both rAF and a 1s interval drive it. rAF alone is not enough: it is starved
 * whenever the tab is backgrounded or the main thread is busy, and this clock
 * is the one number the whole report is built on. The interval is cheap and
 * guarantees the value keeps moving. */
export function useElapsed(running, startedAt, onDone) {
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef(0);
  const tickRef = useRef(onDone);
  tickRef.current = onDone;

  useEffect(() => {
    if (!running || !startedAt) return;
    const base = Date.now() - elapsed;
    let finished = false;

    const tick = () => {
      const e = Date.now() - base;
      setElapsed(e);
      if (!finished && tickRef.current && tickRef.current(e) === false) {
        finished = true;
        return;
      }
      if (!finished) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const iv = setInterval(tick, 1000);

    return () => {
      cancelAnimationFrame(raf.current);
      clearInterval(iv);
    };
    // elapsed is intentionally read as a starting offset, not a dependency:
    // including it would restart the loop on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, startedAt]);

  return elapsed;
}
