'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEngine, makeRng, makeTrial, applyResponse, summarise,
  SHAPES, SHAPES_L, RESPONSE_WINDOW, difficultyIndex,
} from '../lib/engine.mjs';

const BLOCK_TRIALS = 60; // ACTIVE used 10 sessions; a daily dose is one short block
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const GAP_MS = 190; // inter-trial beat, long enough to read the verdict

function Glyph({ shape }) {
  const l = SHAPES_L[shape];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={SHAPES[shape].d} fill={`oklch(${l}% 0.02 ${60 + l * 0.6})`} />
    </svg>
  );
}

/* Scheduling: setTimeout drifts by tens of milliseconds once the tab is warm,
 * which is exactly the margin this task measures in. So every stimulus is
 * measured against performance.now() and reaction time is computed from the
 * true deadline rather than from when the timeout handler happened to fire. */
export default function Warmup({ onFinish, onSkip, onCancel, onLive }) {
  const [phase, setPhase] = useState('intro'); // intro | run | done
  const [engine, setEngine] = useState(() => createEngine());
  const [trial, setTrial] = useState(null);
  const [verdict, setVerdict] = useState(null); // 'ok' | 'no' | null
  const [index, setIndex] = useState(0);
  const [flash, setFlash] = useState(false);

  const rng = useRef(makeRng((Date.now() & 0xffffffff) || 1));
  const timers = useRef([]);
  const deadline = useRef(0);
  const answered = useRef(false);
  // one mutable cell holding the live trial state, so timers never close over
  // stale React state (the bug that made a timed-out trial restart from n0)
  const live = useRef({ e: createEngine(), i: 0 });

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const at = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const publish = () => {
    setEngine(live.current.e);
    setIndex(live.current.i);
  };

  const schedule = useCallback((e, tr) => {
    clear();
    answered.current = false;
    setVerdict(null);
    setFlash(true);
    setTrial(tr);
    deadline.current = performance.now() + tr.duration;

    at(() => setFlash(false), tr.duration);

    // no answer inside the window => recorded as a miss, then advance
    at(() => {
      if (answered.current) return;
      const cur = live.current.e;
      const next = applyResponse(cur, tr, null, 0);
      live.current = { e: next, i: live.current.i + 1 };
      publish();
      setVerdict('no');
      at(() => {
        if (next.trials >= BLOCK_TRIALS) return setPhase('done');
        schedule(next, makeTrial(next, rng.current));
      }, GAP_MS);
    }, tr.duration + RESPONSE_WINDOW);
  }, []);

  function start() {
    const e = createEngine();
    live.current = { e, i: 0 };
    rng.current = makeRng((Date.now() & 0xffffffff) || 1);
    setEngine(e);
    setIndex(0);
    setPhase('run');
    setTimeout(() => schedule(e, makeTrial(e, rng.current)), 260);
  }

  const respond = useCallback((answer) => {
    if (!trial || !flash || answered.current) return;
    answered.current = true;
    // measured against the real deadline, not against the setTimeout callback
    const elapsed = performance.now() - deadline.current + trial.duration;
    const ok = answer === trial.expected;
    const next = applyResponse(live.current.e, trial, answer, elapsed);
    clear();
    setFlash(false);
    setVerdict(ok ? 'ok' : 'no');
    if (next.trials >= BLOCK_TRIALS) {
      live.current = { e: next, i: next.trials };
      publish();
      setPhase('done');
      return;
    }
    live.current = { e: next, i: live.current.i + 1 };
    publish();
    at(() => schedule(next, makeTrial(next, rng.current)), GAP_MS);
  }, [trial, flash]);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.repeat || phase !== 'run') return;
      const k = ev.key.toLowerCase();
      if (k === 'f' || ev.key === 'ArrowLeft') { ev.preventDefault(); respond('same'); }
      else if (k === 'j' || ev.key === 'ArrowRight') { ev.preventDefault(); respond('diff'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, respond]);

  useEffect(() => () => clear(), []);

  /* Report liveness upward so the app can lock navigation. Switching tabs
   * mid-warm-up unmounts this component and throws away every trial answered
   * so far with no warning; see the comment on `sessionLive` in page.js. */
  useEffect(() => {
    if (!onLive) return;
    onLive(phase === 'run');
    return () => onLive(false);
  }, [phase, onLive]);

  const s = summarise(engine);

  if (phase === 'intro') {
    return (
      <div className="card">
        <div className="card-head">
          <h2>热身 · 处理速度</h2>
          <span className="sub">约 3 分钟 · {BLOCK_TRIALS} 题</span>
        </div>
        <p style={{ color: 'var(--ink-2)' }}>
          屏幕中间会闪一个图形，同时四周某一个位置也会闪一个。你要判断的是
          <b>两处是同一个形状，还是不同形状</b>。呈现窗口会随着你答对自动缩短。
        </p>
        <div className="keys">
          <span className="key"><span className="touch-only">点下方</span><kbd className="kbd-hide-touch">F</kbd> 相同</span>
          <span className="key"><span className="touch-only">点下方</span><kbd className="kbd-hide-touch">J</kbd> 不同</span>
        </div>
        <div className="note">
          这套「中央 + 周边分裂注意」是 ACTIVE 试验里唯一显示出长期收益的题型。
          它不测记忆力，只测你能在多短的时间里做出一次判断。
        </div>
        <div className="note">
          不想热身也可以直接开始专注块，只是这一次不会有速度指标。想看热身趋势就做完它——
          窗口会随着你答对自动压缩。
        </div>
        <div className="cta-row">
          <button className="btn lg" onClick={start}>开始热身</button>
          <button className="btn ghost lg" onClick={onSkip}>跳过，直接开始</button>
          <button className="btn ghost lg" onClick={onCancel}>返回</button>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="card">
        <div className="card-head">
          <h2>热身完成</h2>
          <span className="tag">难度 {Math.round(difficultyIndex(engine) * 100)}</span>
        </div>
        <div className="grid-2">
          <div className="metric"><span className="v">{Math.round(s.accuracy * 100)}%</span><span className="k">判断正确率</span></div>
          <div className="metric"><span className="v">{s.medianRt}ms</span><span className="k">中位反应时</span></div>
          <div className="metric"><span className="v">{s.duration}ms</span><span className="k">当前呈现窗口</span></div>
          <div className="metric"><span className="v">{s.throughput}</span><span className="k">每分钟判断次数</span></div>
        </div>
        <div className="note">
          这些数字只说明你在这个题型上的表现。它不等于你全天的专注状态，也不代表记忆力。
        </div>
        <div className="cta-row">
          <button className="btn lg" onClick={() => onFinish(s)}>进入专注块</button>
        </div>
      </div>
    );
  }

  const rad = trial ? trial.radius : 0.3;

  return (
    <div>
      <div className="hud">
        <div className="cell"><span className="k">进度</span><span className="v">{Math.min(index + 1, BLOCK_TRIALS)}/{BLOCK_TRIALS}</span></div>
        <div className="cell"><span className="k">正确率</span><span className="v">{s.trials ? Math.round(s.accuracy * 100) + '%' : '—'}</span></div>
        <div className="cell"><span className="k">窗口</span><span className="v">{s.duration}ms</span></div>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => { clear(); onSkip(); }}>不练了，直接开始</button>
        {/* Before this, the only way out of a running warm-up was forward into a
         * focus block — a user who started by mistake, or who has an urgent
         * reason to stop, had no exit. It drops the block entirely: a partial
         * warm-up is not a sample, and recording it would let a 4-trial run
         * masquerade as a real speed measurement in the report. */}
        <button className="btn ghost warm-exit" onClick={() => { clear(); onCancel(); }}>退出</button>
      </div>

      <button
        className="stage"
        style={{ '--rad': rad }}
        onPointerDown={(e) => respond(e.clientX < window.innerWidth / 2 ? 'same' : 'diff')}
        disabled={!flash}
        aria-label="判断两处图形是否相同：相同按 F 或点左半屏，不同按 J 或点右半屏"
      >
        <span className="stage-inner">
          {flash && trial && (
            <>
              <span className="central"><Glyph shape={trial.central} /></span>
              <span
                className="periphery"
                /* Offset is a share of the stage's own height (top:50% centre,
                 * minus a radius in stage-height percent), NOT vmin. vmin is the
                 * *viewport's* short side: on a tall phone that throws the
                 * stimulus off-stage, so the trial silently degrades into an
                 * easier central-only task than the difficulty curve assumes.
                 * Percentage in translateY would resolve against the element's
                 * own 19% height instead, so positioning goes through `top`. */
                style={{ top: `calc(50% - var(--rad) * 34%)`, transform: `rotate(${ANGLES[trial.position]}deg)` }}
              >
                <Glyph shape={trial.peripheral} />
              </span>
            </>
          )}
        </span>
      </button>

      {/* Touch targets. On a phone the stage halves are out of thumb reach and
       * F/J do not exist, so the two buttons are the primary control; the
       * keyboard and the stage halves stay as secondary paths for desktop. */}
      <div className="answer-row" role="group" aria-label="作答">
        <button
          className="answer same"
          onPointerDown={(e) => { e.preventDefault(); respond('same'); }}
          disabled={!flash}
          aria-label="相同"
        >
          <span className="answer-k">相同</span>
          <span className="answer-hint">F / 左半屏</span>
        </button>
        <button
          className="answer diff"
          onPointerDown={(e) => { e.preventDefault(); respond('diff'); }}
          disabled={!flash}
          aria-label="不同"
        >
          <span className="answer-k">不同</span>
          <span className="answer-hint">J / 右半屏</span>
        </button>
      </div>

      <div className="keys">
        {verdict && (
          <span className="key" style={{ color: verdict === 'ok' ? 'var(--good)' : 'var(--bad)' }}>
            {verdict === 'ok' ? '对' : '错'}
          </span>
        )}
      </div>
    </div>
  );
}
