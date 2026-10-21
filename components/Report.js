'use client';
import { useMemo, useState } from 'react';
import { dailyTotals, decayCurve, hourHistogram, advise, latestBlocks, driftMsOf, driftCountOf, driftMeasured, measuredDrift } from '../lib/store.mjs';

const dayLabel = (day) => {
  const d = new Date(day + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const min = (ms) => Math.round(ms / 60000);

export default function Report({ blocks, onGoRun }) {
  const [showAll, setShowAll] = useState(false);

  const data = useMemo(() => {
    const totals = dailyTotals(blocks);
    const week = totals.slice(-7);
    const recent = latestBlocks(blocks, 10);
    const focusMs = blocks.reduce((s, b) => s + (Number.isFinite(b.focusMs) ? b.focusMs : 0), 0);
    /* Drift statistics come only from blocks that actually measured it. A
     * face-down block on a phone has no drift data, and counting its empty
     * array as "0% drift" would make the tool look better than the evidence
     * supports — the single most dishonest thing this report could do. */
    const md = measuredDrift(blocks);
    const unmeasured = blocks.filter((b) => !driftMeasured(b)).length;
    const focusOfMeasured = blocks
      .filter(driftMeasured)
      .reduce((s, b) => s + (Number.isFinite(b.focusMs) ? b.focusMs : 0), 0);
    const warms = blocks.filter((b) => b.warm);
    const last = recent[recent.length - 1];
    return {
      totals,
      week,
      recent,
      focusMs,
      driftMs: md.ms,
      measuredBlocks: md.blocks,
      unmeasured,
      driftRate: focusOfMeasured > 0 ? md.ms / (md.ms + focusOfMeasured) : null,
      advice: advise(blocks),
      hist: hourHistogram(blocks),
      curve: last ? decayCurve(last) : null,
      warmThroughput: warms.length ? warms[warms.length - 1].warm : null,
      best: week.length ? Math.max(...week.map((w) => w.focusMs)) : 0,
    };
  }, [blocks]);

  if (blocks.length === 0) {
    /* An empty report with no way out is a dead end: the reader is told what
     * the report needs, but not how to produce it. One action closes the loop. */
    return (
      <div className="empty-state">
        <h2>还没有数据</h2>
        <p style={{ maxWidth: '32rem', margin: 'var(--space-4) auto 0' }}>
          报告不会凭空生成洞察。它需要至少一次完整的「热身 + 专注块」才能算出可对比的基线，
          通常三到四次之后建议才会开始指向具体规律。
        </p>
        {onGoRun && (
          <div className="cta-row" style={{ justifyContent: 'center' }}>
            <button className="btn lg" onClick={onGoRun}>去跑第一个专注块</button>
          </div>
        )}
      </div>
    );
  }

  /* The table lists *blocks*, not days. It used to render `dailyTotals` rows
   * here, which are per-day aggregates: every per-block column (target, warm-up
   * window, the block's own drift) read undefined, so the table silently showed
   * one row per day with blank cells and a meaningless "′" target. */
  const shown = showAll ? blocks.slice(-30) : blocks.slice(-7);

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      {/* headline metrics — no invented numbers, only measured ones */}
      <div className="card">
        <div className="card-head">
          <h2>累计</h2>
          <span className="sub">{blocks.length} 个专注块</span>
        </div>
        <div className="grid-2">
          <div className="metric"><span className="v">{min(data.focusMs)}</span><span className="k">有效专注（分钟）</span></div>
          <div className="metric">
            <span className="v">{data.driftRate == null ? '—' : (data.driftRate * 100).toFixed(0) + '%'}</span>
            <span className="k">{data.measuredBlocks ? '切屏分心占比' : '切屏分心占比 · 无实测数据'}</span>
          </div>
          <div className="metric"><span className="v">{min(data.driftMs)}</span><span className="k">切屏时长（分钟）</span></div>
          <div className="metric">
            <span className="v">{data.warmThroughput ? data.warmThroughput.throughput : '—'}</span>
            <span className="k">热身每分钟判断数</span>
          </div>
        </div>
        {data.unmeasured > 0 && (
          <div className="note">
            其中 {data.unmeasured} 个块是扣屏模式，没有测量切屏，因此不计入上面的分心数字——
            把它们的空数据当成「0% 分心」会让报告好看得没有依据。
            专注时长仍然全部计入。
          </div>
        )}
        <div className="note">
          刻意不提供「大脑年龄」或综合评分。这类单一数字没有经过验证，
          只会让一个真实但有限的数据集看起来比实际更权威。
        </div>
      </div>

      {/* 7-day bars — hand-built divs, no chart library needed for 7 bars */}
      <div className="card">
        <div className="card-head">
          <h3>近 7 天</h3>
          <span className="sub">每日有效专注分钟</span>
        </div>
        <div className="bars">
          {data.week.map((w, i) => {
            const h = data.best ? Math.max(3, (w.focusMs / data.best) * 100) : 3;
            return (
              <div className="bar-col" key={w.day}>
                <div className="bar-track">
                  <div
                    className={`bar${i === data.week.length - 1 ? ' today' : ''}${w.focusMs ? '' : ' empty'}`}
                    style={{ height: `${h}%` }}
                    title={`${w.day} · ${min(w.focusMs)} 分钟`}
                  />
                </div>
                <span className="bar-x">{dayLabel(w.day)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* advice */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div className="card-head">
          <h3>下一步做什么</h3>
          <span className="sub">只从已有数据里推，样本不够就不说</span>
        </div>
        <div className="advice-list">
          {data.advice.map((a, i) => (
            <div className="advice" key={i}>
              <span className="tag">{a.tag}</span>
              <p style={{ color: 'var(--ink-2)' }}>{a.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* decay curve of the most recent block */}
      {data.curve && (
        <div className="card">
          <div className="card-head">
            <h3>上一次的专注衰减</h3>
            <span className="sub">块内五等分，越暗表示那段损失越多</span>
          </div>
          <div className="decay">
            {data.curve.map((v, i) => (
              <i key={i} style={{ opacity: 0.2 + v * 0.8 }} />
            ))}
          </div>
          <div className="note">
            一个提前结束的块，这里会明显变暗。这比总时长更能看出你是不是撑不住全程。
          </div>
        </div>
      )}

      {/* hour histogram */}
      <div className="card">
        <div className="card-head">
          <h3>时段分布</h3>
          <span className="sub">每格 = 该时段开过的专注块数</span>
        </div>
        <div className="bars" style={{ height: '5rem' }}>
          {data.hist.map((h) => {
            const max = Math.max(1, ...data.hist.map((x) => x.blocks));
            return (
              <div className="bar-col" key={h.hour}>
                <div className="bar-track">
                  <div
                    className={`bar${h.blocks ? '' : ' empty'}`}
                    style={{ height: `${(h.blocks / max) * 100}%`, background: h.blocks ? 'var(--accent-dim)' : undefined }}
                    title={h.blocks ? `${h.hour}:00 · ${h.blocks} 个块 · 均 ${min(h.avg)} 分钟` : ''}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="bar-x" style={{ textAlign: 'left' }}>0:00 — 23:00</div>
      </div>

      {/* per-block table */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-head">
          <h3>专注块明细</h3>
          <button className="btn ghost" onClick={() => setShowAll((s) => !s)}>
            {showAll ? '只看最近 7 个' : '看全部'}
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>日期</th>
                <th className="num">目标</th>
                <th className="num">实际</th>
                <th className="num">完成度</th>
                <th className="num">切屏</th>
                <th className="num">热身窗口</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((b) => {
                const drift = driftMsOf(b);
                const measured = driftMeasured(b);
                return (
                  <tr key={b.id}>
                    <td>{b.day}</td>
                    <td className="num">{b.targetMin}′</td>
                    <td className="num">{min(b.focusMs)}′</td>
                    <td className="num">{Math.round(Math.min(1, (b.focusMs || 0) / 60000 / (b.targetMin || 25)) * 100)}%</td>
                    <td className="num">{measured ? `${driftCountOf(b)} 次 / ${Math.round(drift / 1000)}s` : '未测量'}</td>
                    <td className="num">{b.warm ? b.warm.duration + 'ms' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
