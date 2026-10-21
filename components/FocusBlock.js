'use client';
import { useEffect, useRef, useState } from 'react';
import { useDrift, useElapsed } from '../lib/useDrift';
import { useWakeLock } from '../lib/useWakeLock';

const fmt = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
};

/* Two ways to run a block, and the difference is not cosmetic.
 *
 * 'screen' keeps the display awake and measures切屏. It is the default because
 * it is the only mode whose drift number means anything.
 *
 * 'off' is face-down mode: you turn the phone over and work. The screen sleeps,
 * which fires the same event as opening another app, so drift cannot be told
 * from normal use and is therefore not recorded. Focus time still counts. */
const MODES = {
  screen: {
    label: '亮屏 · 记录切屏',
    hint: '屏幕会保持点亮。你可以在手机上看文档、查资料，切到别的 App 会被记成分心。适合「手机就是工作台」的场景。',
  },
  off: {
    label: '扣屏 · 只记时长',
    hint: '把手机扣下就行，屏幕会休眠。这一次不记录切屏——因为扣屏时页面看不见和「拿起手机」用的是同一个事件，测出来的数一定是假的。专注时长照常计入。',
  },
};

export default function FocusBlock({ targetMin, warm, onFinish, onCancel, onAbort }) {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [mode, setMode] = useState('screen');
  const [toast, setToast] = useState('');

  /* Drift is only attached in modes that can measure it. */
  const measuring = mode === 'screen';
  const { drifts } = useDrift(running && measuring, paused, measuring);
  const wake = useWakeLock(running && measuring);

  const driftMs = drifts.reduce((s, d) => s + d.ms, 0);
  const lastDriftRef = useRef(null);

  /* Paused time is accumulated separately, otherwise the wall-clock span
   * includes the minutes the user spent paused and the report overstates it. */
  const pausedMsRef = useRef(0);
  const pauseStartedAt = useRef(null);
  const driftsRef = useRef([]);
  driftsRef.current = drifts;

  const targetMs = targetMin * 60000;
  const doneRef = useRef(false);

  const elapsed = useElapsed(running && !paused, startedAt, (e) => {
    if (e >= targetMs && !doneRef.current) {
      doneRef.current = true;
      setRunning(false);
      setPaused(false);
      return false; // stop the loop; onDone effect below commits
    }
    return undefined;
  });

  // Refs so commit() never reads a stale render's props.
  const startedRef = useRef(null);
  startedRef.current = startedAt;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  function commit() {
    const base = startedRef.current;
    const finalMs = base ? Math.max(0, Date.now() - base - pausedMsRef.current) : 0;
    onFinish({ focusMs: finalMs, drift: driftsRef.current, warm, driftMode: modeRef.current });
  }

  // Auto-commit when the target is reached.
  useEffect(() => {
    if (doneRef.current && running === false && startedAt) {
      doneRef.current = 'committed';
      commit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, running]);

  function togglePause() {
    if (paused) {
      const was = pauseStartedAt.current;
      if (was != null) pausedMsRef.current += Date.now() - was;
      pauseStartedAt.current = null;
      setPaused(false);
    } else {
      pauseStartedAt.current = Date.now();
      setPaused(true);
    }
  }

  function endNow() {
    if (pauseStartedAt.current != null) {
      pausedMsRef.current += Date.now() - pauseStartedAt.current;
      pauseStartedAt.current = null;
    }
    setRunning(false);
    setPaused(false);
    commit();
  }

  /* Quitting mid-block is a real decision with two legitimate answers, so it
   * gets a question rather than a single destructive button.
   *
   * "结束并记录" is right when the time was genuinely spent — a 15-minute block
   * cut short is real focus time and belongs in the data. "放弃" is right when
   * it wasn't: the phone rang, the meeting started, the user opened the app by
   * mistake. Writing that as a 20-second block would poison every average and
   * the decay curve with a session that never happened.
   *
   * This distinction is the whole point of the prompt. A single "退出" button
   * could only pick one, and picking wrong is the more damaging error: the
   * user loses trust in the report rather than in one block. */
  const [askQuit, setAskQuit] = useState(false);
  const quitRef = useRef(null);

  function abort() {
    setRunning(false);
    setPaused(false);
    // Nothing is written to storage — the block is dropped whole, warm-up
    // summary included.
    onAbort();
  }

  /* Escape is the keyboard route out of the confirm dialog. Scoped to the
   * dialog only: while the block is running, Escape must not do anything,
   * because a stray keypress should never discard a session. */
  useEffect(() => {
    if (!askQuit) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setAskQuit(false); return; }
      if (e.key !== 'Tab') return;
      /* Trap focus inside the dialog. Tabbing out would land on a page control
       * that is inert during a live block, which reads as a broken app. */
      const f = quitRef.current;
      if (!f) return;
      const items = [...f.querySelectorAll('button')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    // move focus in so the dialog is reachable without hunting for it
    const first = quitRef.current && quitRef.current.querySelector('button');
    if (first) first.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [askQuit]);

  // New drift -> acknowledge it briefly. Silent success over a modal: the user
  // is mid-task and must not be interrupted by their own data.
  useEffect(() => {
    if (!drifts.length) return;
    const last = drifts[drifts.length - 1];
    if (lastDriftRef.current === last.at) return;
    lastDriftRef.current = last.at;
    setToast(`离开了 ${(last.ms / 1000).toFixed(0)} 秒`);
    const id = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(id);
  }, [drifts]);

  /* Returning from a long absence must not silently resume the clock: on a
   * phone the common case is "locked the screen an hour ago". Ask.
   *
   * The away span is measured from the moment the page was hidden, not from the
   * last time this handler ran — measuring from "last check" would fold the
   * pre-hide stretch into the absence and invent drift that never happened. */
  const [askResume, setAskResume] = useState(null);
  const hiddenAt = useRef(null);
  useEffect(() => {
    if (!running || paused || !startedAt) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const from = hiddenAt.current;
      hiddenAt.current = null;
      if (from == null) return;
      const away = Date.now() - from;
      /* An absence longer than the whole block is not a glance at another app —
       * it is a locked screen we slept through. Resuming silently would credit
       * the user with focus time they were not present for. */
      if (away > Math.max(targetMs, 10 * 60000)) {
        setRunning(false);
        pausedMsRef.current += away;
        pauseStartedAt.current = null;
        setAskResume(away);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running, paused, startedAt, targetMs]);

  // beforeunload: the block data is unsaved until it closes
  useEffect(() => {
    if (!running) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [running]);

  if (!startedAt) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>专注块 · {targetMin} 分钟</h2>
          {warm && <span className="sub">热身已就绪 · 窗口 {warm.duration}ms</span>}
        </div>

        <p style={{ color: 'var(--ink-2)' }}>
          先选这一次怎么跑。两种模式的「分心」数字含义不同，混在一起会让报告失真。
        </p>

        <div className="seg wide" role="group" aria-label="专注块模式" style={{ marginTop: 'var(--space-4)' }}>
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>
              {m.label}
            </button>
          ))}
        </div>
        <p style={{ color: 'var(--ink-2)', marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
          {MODES[mode].hint}
        </p>

        {!warm && (
          <div className="note">这次没有热身数据。跳过热身也能跑，只是报告里不会有速度指标。</div>
        )}

        <div className="cta-row">
          <button className="btn lg focus-go" onClick={() => { setStartedAt(Date.now()); setRunning(true); }}>
            开始 {targetMin} 分钟
          </button>
          <button className="btn ghost lg" onClick={onCancel}>取消</button>
        </div>
      </div>
    );
  }

  if (askResume) {
    const mins = Math.round(askResume / 60000);
    return (
      <div className="card">
        <div className="card-head">
          <h2>刚才离开了 {mins >= 60 ? Math.round(mins / 60) + ' 小时' : mins + ' 分钟'}</h2>
          <span className="tag">已暂停</span>
        </div>
        <p style={{ color: 'var(--ink-2)' }}>
          这段离开时间已经排除在专注时长之外，不会算成你盯着屏幕发呆。
          {measuring ? '这段时间的切屏也没有计入——离开太久更像锁屏休眠，而不是切到别的 App。' : ''}
        </p>
        <div className="cta-row">
          <button className="btn lg" onClick={() => { setAskResume(null); setRunning(true); }}>
            继续专注
          </button>
          <button className="btn ghost lg" onClick={() => { setAskResume(null); setAskQuit(true); }}>退出</button>
          <button className="btn ghost lg" onClick={endNow}>结束并记录</button>
        </div>
      </div>
    );
  }

  if (askQuit) {
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.round((elapsed % 60000) / 1000);
    const got = mins > 0 ? `${mins} 分钟` : `${secs} 秒`;
    const partial = elapsed < targetMs * 0.2;
    return (
      /* role=dialog + aria-modal: it is modal in the sense that matters — the
       * block is still logically running behind it, and the two answers have
       * different consequences for the data. */
      <div className="card quit-ask" role="dialog" aria-modal="true" aria-labelledby="quit-h"
        ref={quitRef}>
        <div className="card-head">
          <h2 id="quit-h">要退出这一轮吗</h2>
          <span className="tag">已专注 {got}</span>
        </div>
        <p style={{ color: 'var(--ink-2)' }}>
          这次专注块已经跑了 {got}，目标是 {targetMin} 分钟。
          这段时间是不是你真的在专注，决定了它该不该进报告。
        </p>
        <div className="cta-row">
          <button className="btn lg quit-keep" onClick={() => { setAskQuit(false); endNow(); }}>
            结束并记录
          </button>
          <button className="btn ghost lg" onClick={() => setAskQuit(false)}>继续专注</button>
          <button className="btn ghost lg quit-drop" onClick={abort}>放弃，不记录</button>
        </div>
        <p className="note">
          {partial
            ? '这次的时长还不到目标的 20%。如果刚才是被别的事打断而不是真的专注，用「放弃」——'
              + '否则报告里会出现一个 20 秒的块，把平均值和衰减曲线一起拉低。'
            : '「放弃」不会写入任何数据，热身记录也一并丢弃。「结束并记录」会把这段时间如实计入。'}
          按 Esc 回到专注块。
        </p>
      </div>
    );
  }

  const ratio = elapsed / targetMs;
  const driftRate = driftMs / Math.max(1, elapsed + driftMs);

  return (
    <div>
      <div className="hud">
        <div className="cell"><span className="k">目标</span><span className="v">{targetMin} 分钟</span></div>
        <div className="cell"><span className="k">已专注</span><span className="v">{fmt(elapsed)}</span></div>
        {measuring
          ? <div className="cell"><span className="k">切屏</span><span className="v">{drifts.length} 次</span></div>
          : <div className="cell"><span className="k">切屏</span><span className="v">未测量</span></div>}
        <span className="spacer" />
        <button className="btn ghost" onClick={togglePause} disabled={!running}>
          {paused ? '继续' : '暂停'}
        </button>
        {/* 退出 opens the two-answer dialog; 结束并记录 stays inline because
         * finishing a block on purpose is the common case and should not cost
         * a confirmation. Quitting is the rarer, less reversible-feeling one. */}
        <button className="btn ghost focus-quit" onClick={() => setAskQuit(true)}>退出</button>
        <button className="btn" onClick={endNow}>结束并记录</button>
      </div>

      <div className="card timer-face">
        <div className={`clock${paused ? ' paused' : ''}`}>{fmt(paused ? elapsed : Math.max(0, targetMs - elapsed))}</div>
        {measuring ? (
          <span className={`drift-chip${driftRate < 0.12 ? ' calm' : ''}`}>
            {paused ? '已暂停 · 不计入' : `分心占比 ${(driftRate * 100).toFixed(0)}%`}
          </span>
        ) : (
          <span className="drift-chip calm">扣屏模式 · 不记录切屏</span>
        )}
        {measuring && !wake.supported && (
          <div className="note" style={{ maxWidth: '30rem', marginTop: 'var(--space-4)' }}>
            这个浏览器不支持屏幕常亮（iOS 需 Safari 16.4 以上）。屏幕自动熄灭时会被记成一次切屏，
            数字会偏高。想要干净数据就改用扣屏模式。
          </div>
        )}
        {measuring && wake.supported && wake.state !== 'held' && running && (
          <div className="note" style={{ maxWidth: '30rem', marginTop: 'var(--space-4)' }}>
            没能保持屏幕常亮（可能被系统省电策略拒绝）。切屏数据这次会偏高。
          </div>
        )}
        <div style={{ width: '100%', maxWidth: '30rem', marginTop: 'var(--space-5)' }}>
          <div className="bar-track" style={{ height: '0.5rem' }}>
            <div className="bar" style={{ height: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        </div>
      </div>

      {measuring && drifts.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>本次切屏</h3><span className="sub">按时间倒序</span></div>
          <table className="table">
            <thead><tr><th>发生在第</th><th className="num">时长</th></tr></thead>
            <tbody>
              {[...drifts].reverse().slice(0, 8).map((d) => {
                const off = Math.max(0, d.at - startedAt);
                return (
                  <tr key={d.at}>
                    <td>{fmt(off)}</td>
                    <td className="num">{(d.ms / 1000).toFixed(1)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
