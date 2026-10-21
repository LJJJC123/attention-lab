'use client';
import { useEffect, useState } from 'react';
import { load, save, newBlock, closeBlock, driftMsOf, driftCountOf } from '../lib/store.mjs';
import { BASE_PATH_ATTR } from '../lib/basePath';
import Warmup from '../components/Warmup';
import FocusBlock from '../components/FocusBlock';
import Report from '../components/Report';
import TrainingLab from '../components/TrainingLab';
import { makeDailyPlan, trainingTotals, validateBackup } from '../lib/training.mjs';

const TABS = [
  { id: 'run', label: '今天' },
  { id: 'training', label: '训练库' },
  { id: 'report', label: '报告' },
  { id: 'about', label: '关于' },
];

const TAB_IDS = new Set(TABS.map((t) => t.id));
const tabFromUrl = () => {
  if (typeof window === 'undefined') return 'run';
  const q = new URLSearchParams(window.location.search).get('t');
  return TAB_IDS.has(q) ? q : 'run';
};

export default function Page() {
  /* Seeded from the URL so ?t=report is shareable and survives a reload —
   * the report is the one tab anyone has a reason to link to or bookmark.
   * useState's initializer runs once per mount, not on every render. */
  const [tab, setTabState] = useState(tabFromUrl);
  const [blocks, setBlocks] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [preferredModule, setPreferredModule] = useState(null);
  const [targetMin, setTargetMin] = useState(25);
  const [phase, setPhase] = useState('warm'); // warm | focus | summary
  const [block, setBlock] = useState(null);
  const [toast, setToast] = useState('');
  /* True only while the warm-up is actually running (not on its intro or done
   * screens). On the intro screen nothing is at stake, so the tabs stay live. */
  const [warming, setWarming] = useState(false);

  /* An in-progress session owns the screen. Switching tabs unmounts the
   * component holding the block's clock and drift state, and that data is not
   * recoverable: `beforeunload` only guards real page unloads, not an internal
   * re-render. So during a live warm-up or focus block the other tabs are
   * disabled outright rather than allowed to throw the session away.
   *
   * This is the same reason a running timer app disables its navigation. The
   * alternative — silently discarding twenty minutes of work — is worse than
   * an inert button. */
  const sessionLive = phase === 'focus' || (phase === 'warm' && !!block && warming);

  /* Leaving via the browser's own Back button must be blocked too, or the
   * disabled buttons are theatre: the user hits Back and loses the block. */
  useEffect(() => {
    if (!sessionLive) return;
    const onPop = () => {
      /* Put the URL back before doing anything else, so the address bar never
       * shows a tab the app is not on. */
      setTabState('run');
      window.history.replaceState(null, '', window.location.pathname);
      setToast('练习进行中，先退出这一轮才能切换页面');
      setTimeout(() => setToast(''), 2400);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [sessionLive]);

  /* replaceState, not pushState: switching tabs is not a place the user wants
   * the Back button to walk. Back/forward still works because we listen for
   * popstate and re-read the URL. */
  const setTab = (next) => {
    if (sessionLive && next !== 'run') return;
    setTabState(next);
    const url = next === 'run' ? window.location.pathname : `${window.location.pathname}?t=${next}`;
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    const onPop = () => setTabState(tabFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // localStorage is unavailable during SSR and in some privacy modes; load in
  // an effect and treat a failed read as "no data" rather than crashing.
  useEffect(() => {
    const state = load(); setBlocks(state.blocks); setWorkouts(state.workouts || []);
  }, []);

  /* Register the offline shell. Production only: a service worker in front of
   * the dev server caches stale modules and makes HMR lie to you. */
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // file:// and other opaque origins throw on register; swallow, the app works.
    // Read the base path from <html> rather than importing it: inside a 'use
    // client' module Next keeps the env expression rather than inlining the
    // value, so an imported constant would register at the domain root and the
    // worker would not control this page on a sub-path host.
    const base = document.documentElement.getAttribute(BASE_PATH_ATTR) || '';
    navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {});
  }, []);

  const commit = (next) => {
    const closed = closeBlock(next.block, next.focusMs);
    // Normalise here rather than trusting every producer: this array is read
    // by the report, and one undefined here blanks the entire page.
    const withDrift = { ...closed, drift: Array.isArray(next.drift) ? next.drift : [] };
    // driftMode decides whether the report is allowed to quote this block's
    // drift figure at all. Default to 'screen' so an older caller still records
    // a measured block rather than silently dropping it from the statistics.
    const mode = next.driftMode === 'off' ? 'off' : 'screen';
    const all = [...blocks, { ...withDrift, driftMode: mode }];
    setBlocks(all);
    save({ v: 1, blocks: all, workouts });
  };

  const startDay = () => {
    setBlock(newBlock(targetMin));
    setPhase('warm');
  };

  function onWarmDone(warm) {
    setBlock((b) => ({ ...b, warm }));
    setPhase('focus');
  }

  function onFocusDone(res) {
    // driftMode must travel with the result: dropping it here is what would make
    // a face-down block look like a measured, perfectly clean one.
    commit({ block, focusMs: res.focusMs, drift: res.drift, driftMode: res.driftMode });
    setPhase('summary');
  }

  const last = blocks[blocks.length - 1];

  return (
    <div className="app">
      <nav className="nav">
        <div className="wrap">
          <div className="nav-in" role="tablist" aria-label="主导航">
            {TABS.map((t) => {
              /* `today` is never disabled: it is the current tab, and the
               * back-out is the exit button inside the session itself. */
              const locked = sessionLive && t.id !== 'run';
              return (
                <button
                  key={t.id}
                  role="tab"
                  className={`tab${locked ? ' locked' : ''}`}
                  aria-current={tab === t.id ? 'page' : undefined}
                  /* Kept focusable-but-inert via `aria-disabled` rather than the
                   * `disabled` attribute: a disabled button is removed from the
                   * tab order, so a keyboard user tabbing past it would land on
                   * nothing and never learn why it is unavailable. The title
                   * carries the reason, which is also announced. */
                  aria-disabled={locked || undefined}
                  title={locked ? '练习进行中，先退出这一轮才能切换' : undefined}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="wrap">
        {tab === 'run' && (
          <>
            {!block && phase === 'warm' && <DailyCard onStart={(module) => { if (module === 'warmup') { startDay(); return; } if (module === 'focus') { setBlock(newBlock(targetMin)); setPhase('focus'); return; } setPreferredModule(module); setTab('training'); }} workouts={workouts} />}
            {phase === 'warm' && !block && (
              <>
                {/* The control surface comes first. This is a tool, not a
                 * landing page: someone opening it on a phone has already decided
                 * to train and is looking for the button, not for a paragraph
                 * explaining what the product is. The prose that used to sit above
                 * the controls now sits below them, and the headline shrank to a
                 * label so it doesn't push the button under a scroll. */}
                <div className="console">
                  <div className="console-main">
                    <p className="console-label">专注块</p>
                    <h1>开始今天</h1>

                    <div className="console-controls">
                      <div className="seg" role="group" aria-label="专注块时长">
                        {[15, 25, 45].map((m) => (
                          <button key={m} aria-pressed={targetMin === m} onClick={() => setTargetMin(m)}>
                            <span className="seg-n">{m}</span>
                            <span className="seg-u">分钟</span>
                          </button>
                        ))}
                      </div>
                      <button className="btn lg console-go" onClick={startDay}>
                        开始 {targetMin} 分钟
                      </button>
                    </div>
                    <p className="console-hint">
                      下一步是 3 分钟处理速度热身，也可以直接跳过。
                    </p>
                  </div>

                  <aside className="console-aside">
                    <h2>先热身，再开始。</h2>
                    <p>
                      这是一个对抗分心的专注块工具，加上一个基于 ACTIVE 试验范式的处理速度热身。
                      数据全部存在你自己的浏览器里，没有账号，也没有服务端。
                    </p>
                    <div className="console-facts">
                      <div>
                        <span className="k">会做</span>
                        <ul className="list-reset">
                          <li>处理速度热身，窗口随表现自适应</li>
                          <li>{targetMin} 分钟专注块，全程可用</li>
                          <li>记录切屏次数与时长，不打断你</li>
                          <li>亮屏（记录）或扣屏（只记时长）</li>
                        </ul>
                      </div>
                      <div>
                        <span className="k">不会做</span>
                        <ul className="list-reset">
                          <li>不读其他标签页，不做屏幕录制</li>
                          <li>不给「大脑年龄」或综合评分</li>
                          <li>看不见你拿起手机走神</li>
                        </ul>
                      </div>
                    </div>
                  </aside>
                </div>

                <div className="card console-install">
                  <div className="card-head"><h3>装到手机上</h3></div>
                  <p style={{ color: 'var(--ink-2)' }}>
                    用手机浏览器打开这个网址，选「添加到主屏幕」。之后它会像原生应用一样全屏运行、
                    离线可用，数据存在手机本地。
                  </p>
                  <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
                    iPhone 需要 Safari 16.4 以上，屏幕常亮功能才可用；不支持时会明确告诉你，
                    不会假装测到了。
                  </p>
                </div>
              </>
            )}

            {phase === 'warm' && block && (
              <div className="narrow" style={{ paddingTop: 'var(--space-5)' }}>
                <Warmup
                  block={block}
                  onFinish={onWarmDone}
                  onLive={setWarming}
                  /* Skipping is not cancelling. On a phone a 3-minute warm-up
                   * before a 25-minute block is a real barrier, and bouncing to
                   * the home screen meant there was no way past it except doing
                   * it. Skipping goes straight to the block with warm:null, and
                   * the report simply has no speed metric for that day. */
                  onSkip={() => onWarmDone(null)}
                  onCancel={() => { setBlock(null); setPhase('warm'); }}
                />
              </div>
            )}

            {phase === 'focus' && block && (
              <FocusBlock
                targetMin={targetMin}
                warm={block.warm}
                onFinish={onFocusDone}
                /* Abandoning is not "finish with a tiny number". A block cut off
                 * after three minutes would otherwise be written to storage as a
                 * real 3-minute session and show up in the report as a legitimately
                 * low-completion block — dragging down the average and the decay
                 * curve with a session the user never intended to record. Nothing
                 * is written; the block is simply dropped. */
                onAbort={() => { setBlock(null); setPhase('warm'); }}
                /* Both of these must clear `phase` too, not just `block`. Setting
                 * only the block left phase==='focus' with block===null, and the
                 * very next render read `block.warm` — a hard TypeError and a white
                 * screen instead of the home console. */
                onCancel={() => { setBlock(null); setPhase('warm'); }}
              />
            )}

            {phase === 'summary' && last && (
              <div className="narrow" style={{ paddingTop: 'var(--space-5)' }}>
                <div className="card">
                  <div className="card-head">
                    <h2>这一轮结束了</h2>
                    <span className="tag">{last.day}</span>
                  </div>
                  <div className="grid-2">
                    <div className="metric">
                      <span className="v">{Math.round(last.focusMs / 60000)}</span>
                      <span className="k">有效专注分钟 / 目标 {last.targetMin}</span>
                    </div>
                    <div className="metric">
                      <span className="v">{last.driftMode === 'off' ? '—' : driftCountOf(last)}</span>
                      <span className="k">
                        {last.driftMode === 'off'
                          ? '扣屏模式 · 未测量切屏'
                          : `切屏次数 · 共 ${Math.round(driftMsOf(last) / 1000)}s`}
                      </span>
                    </div>
                  </div>
                  {last.driftMode === 'off' && (
                    <div className="note">
                      这一次是扣屏模式，专注时长已计入，但切屏没有被测量（扣屏和拿起手机会触发同一个事件，
                      分不清）。所以报告里不会引用这一次的分心数据。
                    </div>
                  )}
                  <div className="cta-row">
                    <button className="btn lg" onClick={() => setTab('report')}>看报告</button>
                    <button className="btn ghost lg" onClick={startDay}>再来一轮</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'training' && <TrainingLab initialModule={preferredModule} onSave={(w) => { const all = [...workouts, w]; setWorkouts(all); setPreferredModule(null); save({ v: 1, blocks, workouts: all }); }} onLegacy={(mode) => { setTab('run'); if (mode === 'focus') { setBlock(newBlock(targetMin)); setPhase('focus'); } else startDay(); }} />}

        {tab === 'report' && <><TrainingReport workouts={workouts} blocks={blocks} /><Report blocks={blocks} onGoRun={() => setTab('run')} /></>}

        {tab === 'about' && (
          <div className="narrow">
            <div className="hero">
              <h1>它凭什么这么设计。</h1>
            </div>
            <div className="card">
              <h3>热身的依据</h3>
              <p style={{ color: 'var(--ink-2)', marginTop: 'var(--space-3)' }}>
                范式取自 ACTIVE 试验（Advanced Cognitive Training for Independent and Vital Elderly，
                2832 人，随访二十年）。三类训练里只有「处理速度」这一类显示出长期效果：
                10 次训练后，10 年痴呆风险低 29%，完成强化训练的组低 33%，且车责事故大约减半。
                记忆训练和推理训练在同一试验里没有表现出这个效果。
              </p>
              <p style={{ color: 'var(--ink-2)', marginTop: 'var(--space-3)' }}>
                这不代表你能预防痴呆，也不代表效果会在你身上出现。
                它只说明这类题型值得作为每日热身的底座。
              </p>
            </div>
            <div className="card">
              <h3>刻意不做的事</h3>
              <ul className="list-reset" style={{ color: 'var(--ink-2)', display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <li>· 不做「大脑年龄」评分——没有经验证的单一数字能对应认知功能</li>
                <li>· 不卖记忆补剂，也不做任何疾病预防宣称</li>
                <li>· 不宣称注意力训练能提升智商：2016 年的元分析对远迁移的结论是否定性的</li>
                <li>· 不使用固定难度——那类设计几周内就会到平台期</li>
              </ul>
            </div>
            <div className="card">
              <h3>在手机上，分心到底能不能测</h3>
              <p style={{ color: 'var(--ink-2)', marginTop: 'var(--space-3)' }}>
                桌面上这件事很清楚：你离开这个标签页去干别的，页面知道。
                但手机上，你必须把手机扣下——而屏幕一休眠，网页和「你拿起手机刷抖音」触发的是同一个事件。
                分不出来的时候，报告不会猜。
              </p>
              <ul className="list-reset" style={{ color: 'var(--ink-2)', display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <li>· 亮屏模式会申请屏幕常亮，屏幕不熄，此时离开页面才算切屏</li>
                <li>· 扣屏模式不测切屏，只记专注时长，并在数据里标记为「未测量」</li>
                <li>· 报告只用实测过的块来谈分心占比，不把未测量的当成 0%</li>
                <li>· 浏览器不给常亮权限、或系统把它掐了，界面会直接说这次数据偏高</li>
              </ul>
              <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
                另外一个诚实的边界：扣屏之后把手机翻过来看时间，本页面同样看不见。
              </p>
            </div>
            <div className="card">
              <h3>你的数据</h3>
              <p style={{ color: 'var(--ink-2)', marginTop: 'var(--space-3)' }}>
                全部存在浏览器的 localStorage 里，键名 <code>attnlab.v1</code>。
                清除浏览器数据会一并清掉它们，没有服务端副本可以恢复。
                热身、专注块、明细都可以导出成 JSON 自己保管。
              </p>
              <div className="cta-row">
                <button
                  className="btn ghost"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({ version: 2, blocks, workouts }, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `attention-lab-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    setToast('已导出');
                    setTimeout(() => setToast(''), 2000);
                  }}
                >
                  导出 JSON
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (!confirm('清空全部训练记录？此操作不可恢复。')) return;
                    setBlocks([]);
                    save({ v: 1, blocks: [], workouts: [] }); setWorkouts([]);
                    setToast('已清空');
                    setTimeout(() => setToast(''), 2000);
                  }}
                >
                  清空全部数据
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="foot">
        <div className="wrap">
          <p>
            数据只存在这台机器上。这个工具能看见的注意力，仅仅是注意力的一小部分。
          </p>
        </div>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function DailyCard({ onStart, workouts }) {
  const [rotation, setRotation] = useState(0);
  const now = new Date(); const day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const shifted = new Date(`${day}T00:00:00`); shifted.setDate(shifted.getDate() + rotation); const plan = makeDailyPlan(`${shifted.getFullYear()}-${String(shifted.getMonth()+1).padStart(2,'0')}-${String(shifted.getDate()).padStart(2,'0')}`); const labels = { schulte:'舒尔特方格', tracking:'视觉追踪', gonogo:'抑制控制', nback:'工作记忆', warmup:'处理速度热身', focus:'专注计时' };
  const done = workouts.some((w) => w.day === day);
  return <section className="daily-card"><div className="daily-copy"><span className="console-label">今日推荐 · 约 10 分钟</span><h2>{done ? '今天已经开始练习' : '给自己十分钟，完成一组短练习'}</h2><p>{plan.map((x) => labels[x]).join('　·　')}</p><div className="daily-actions">{plan.map((module) => <button key={module} className="btn ghost" onClick={() => onStart(module)}>开始{labels[module]}</button>)}<button className="btn ghost" onClick={() => setRotation((r) => r + 1)}>换一组</button><button className="btn" onClick={() => onStart('schulte')}>自由选练</button></div></div></section>;
}
function TrainingReport({ workouts, blocks }) {
  const totals = trainingTotals(workouts); const labels = { schulte:'舒尔特方格', tracking:'视觉追踪', gonogo:'抑制控制', nback:'工作记忆' };
  const activity = new Map(); [...workouts, ...blocks.map((b) => ({ day: b.day }))].forEach((x) => activity.set(x.day, (activity.get(x.day) || 0) + 1));
  const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (27 - i)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  return <div className="narrow training-report"><div className="card"><div className="card-head"><h2>训练记录</h2><span className="sub">仅显示本设备保存的数据</span></div>{Object.keys(totals).length ? <div className="grid-2">{Object.entries(totals).map(([id, t]) => <div className="metric" key={id}><span className="v">{t.sessions}</span><span className="k">{labels[id] || id} · 次数 {t.sessions} · 练习天数 {t.days} · 共 {Math.round(t.durationMs/60000)} 分钟</span></div>)}</div> : <p>完成一项训练后，这里会出现你的练习次数和用时。这里不推断能力或疗效。</p>}<h3 className="calendar-title">最近 28 天 · 练习打卡</h3><div className="training-calendar" aria-label="最近 28 天的训练记录">{days.map((day) => <span key={day} title={`${day} · ${activity.get(day) || 0} 项`} aria-label={`${day}，${activity.get(day) || 0} 项`} className={activity.has(day) ? 'active' : ''}>{day.slice(-2)}</span>)}</div></div></div>;
}
