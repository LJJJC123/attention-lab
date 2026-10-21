/* Session store — localStorage only. No account, no server.
 * Shape: { v, blocks: [ {id, day, startedAt, targetMin, focusMs, drift: [{at,ms}], warm: {...}|null} ] }
 */

export const KEY = 'attnlab.v1';
export const SCHEMA = 1;
const KEEP = 180; // ~6 months of blocks; ponytail: bounded array, no pruning job

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function emptyState() {
  return { v: SCHEMA, blocks: [], workouts: [] };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    // ponytail: validate at the trust boundary — a hand-edited backup must not
    // crash the render. Anything unrecognised is discarded, not repaired.
    if (!parsed || parsed.v !== SCHEMA || !Array.isArray(parsed.blocks)) return emptyState();
    return {
      v: SCHEMA,
      workouts: Array.isArray(parsed.workouts) ? parsed.workouts.filter((w) => w && typeof w.id === 'string' && typeof w.module === 'string' && typeof w.day === 'string' && Number.isFinite(w.durationMs) && w.score && typeof w.score === 'object') : [],
      blocks: parsed.blocks.filter(
        // startedAt is load-bearing: hourHistogram and decayCurve both parse it,
        // and a block without it crashed the whole report.
        (b) =>
          b &&
          typeof b.day === 'string' &&
          typeof b.startedAt === 'string' &&
          !Number.isNaN(new Date(b.startedAt).getTime()) &&
          Number.isFinite(b.focusMs) &&
          Array.isArray(b.drift)
      ).map((b) => ({
        // Only the literal 'off' means "deliberately not measured". Anything
        // else — including the field being absent in a pre-PWA backup — is
        // treated as a fully measured block, so old data keeps its meaning.
        ...b,
        driftMode: b.driftMode === 'off' ? 'off' : 'screen',
      })),
    };
  } catch {
    return emptyState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  if (!storage) return;
  const previous = load(storage);
  const trimmed = { v: SCHEMA, blocks: (state.blocks || []).slice(-KEEP), workouts: (state.workouts ?? previous.workouts ?? []).slice(-KEEP * 4) };
  try {
    storage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded: keep the most recent half and retry once. Losing the
    // oldest half is better than losing everything or throwing mid-session.
    try {
      storage.setItem(KEY, JSON.stringify({ v: SCHEMA, blocks: trimmed.blocks.slice(-Math.floor(KEEP / 2)), workouts: trimmed.workouts.slice(-KEEP * 2) }));
    } catch { /* give up silently; the in-memory state is still correct */ }
  }
}

export function newBlock(targetMin, driftMode = 'screen') {
  return {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    day: dayKey(),
    startedAt: new Date().toISOString(),
    targetMin,
    focusMs: 0,
    drift: [],
    warm: null,
    /* 'screen' = drift was measured; 'off' = face-down mode, deliberately not
     * measured. See driftMeasured(). */
    driftMode,
  };
}

export function closeBlock(block, elapsedMs) {
  return { ...block, focusMs: Math.max(0, Math.round(elapsedMs)), closedAt: new Date().toISOString() };
}

/* ---- aggregation: everything the report page needs, derived on read ---- */

const byDay = (blocks) => {
  const m = new Map();
  for (const b of blocks) {
    if (!m.has(b.day)) m.set(b.day, []);
    m.get(b.day).push(b);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

/* Single source of truth for "how much drift does this block contain".
 * Exported because the report renders it too, and a hand-rolled
 * `b.drift.reduce(...)` in a component is exactly what crashed the page. */
export function driftMsOf(b) {
  return (Array.isArray(b && b.drift) ? b.drift : []).reduce(
    (s, d) => s + (d && Number.isFinite(d.ms) ? d.ms : 0),
    0
  );
}

export function driftCountOf(b) {
  return Array.isArray(b && b.drift) ? b.drift.length : 0;
}

/* Was drift actually *measured* for this block?
 *
 * Blocks written before this field existed (and every desktop block) measured
 * it. Blocks run in face-down mode on a phone deliberately did not, and their
 * drift array is empty — averaging those in as "0% drift" would bias the
 * report toward looking better than it is, so they are excluded from drift
 * statistics while still counting toward focus time.
 *
 * Default to true: an absent field means an older, fully-measured block. */
export function driftMeasured(b) {
  return !(b && b.driftMode === 'off');
}

/* Drift figures from the blocks that actually measured it. */
export function measuredDrift(blocks) {
  const list = blocks.filter(driftMeasured);
  return {
    ms: list.reduce((s, b) => s + driftMsOf(b), 0),
    count: list.reduce((s, b) => s + driftCountOf(b), 0),
    blocks: list.length,
  };
}

/* `dailyTotals` drift columns carry only *measured* drift, so the 7-day bars and
 * any ratio built on them never mix in an unmeasured block's zero. */
export function dailyTotals(blocks) {
  return byDay(blocks).map(([day, bs]) => ({
    day,
    focusMs: bs.reduce((s, b) => s + (Number.isFinite(b.focusMs) ? b.focusMs : 0), 0),
    driftMs: measuredDrift(bs).ms,
    driftCount: measuredDrift(bs).count,
    blocks: bs.length,
    measuredBlocks: bs.filter(driftMeasured).length,
    completion: bs.reduce((s, b) => s + Math.min(1, (b.focusMs || 0) / 60000 / (b.targetMin || 25)), 0) / bs.length,
  }));
}

export function latestBlocks(blocks, n = 14) {
  return blocks.slice(-n);
}

/* Attention curve: does focus decay within a block? Bin every block into
 * 5 slots and report the fraction of the target each slot actually reached.
 * This is the honest signal — a block that ends early shows up as decay. */
export function decayCurve(block, slots = 5) {
  const focusMs = Number.isFinite(block.focusMs) ? block.focusMs : 0;
  const per = focusMs / slots;
  const base = new Date(block.startedAt).getTime() || 0;
  const active = (Array.isArray(block.drift) ? block.drift : []).filter((d) => d && d.ms > 800);
  return Array.from({ length: slots }, (_, i) => {
    const from = i * per;
    const to = (i + 1) * per;
    const lost = active
      .filter((d) => {
        const start = d.at - base;
        return start > from && start <= to;
      })
      .reduce((s, d) => s + d.ms, 0);
    return clamp01((per - lost) / Math.max(per, 1));
  });
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function hourHistogram(blocks) {
  const h = new Array(24).fill(0);
  const c = new Array(24).fill(0);
  for (const b of blocks) {
    const hr = new Date(b.startedAt).getHours();
    if (Number.isNaN(hr)) continue;
    h[hr] += Number.isFinite(b.focusMs) ? b.focusMs : 0;
    c[hr] += 1;
  }
  return h.map((ms, i) => ({ hour: i, ms, blocks: c[i], avg: c[i] ? ms / c[i] : 0 }));
}

/* Advice is generated from the data, never invented. Every branch below
 * needs an actual observation behind it or it does not fire. */
export function advise(blocks) {
  const out = [];
  if (blocks.length === 0) {
    return [{ tag: '开始', text: '还没有任何数据。先跑一次热身加一个专注块，明天的建议才有依据。' }];
  }

  const totals = dailyTotals(blocks);
  const recent = blocks.slice(-10);
  const prev = blocks.slice(-20, -10);

  const avg = (list, f) => (list.length ? list.reduce((s, b) => s + f(b), 0) / list.length : 0);
  /* Drift rate over measured blocks only. An unmeasured (face-down) block has
   * an empty drift array; including it as 0% would quietly flatter the user. */
  const driftRate = (list) => {
    const m = measuredDrift(list);
    if (m.blocks === 0) return null;
    const w = avg(list.filter(driftMeasured), (b) => (Number.isFinite(b.focusMs) ? b.focusMs : 0));
    return w > 0 ? m.ms / (m.ms + w) : 0;
  };

  /* A single block still deserves to be told what it means — otherwise the
   * report renders an advice heading followed by nothing, which reads as a bug.
   * These are descriptions of the data in hand, not trends. */
  if (blocks.length < 3) {
    const b = blocks[blocks.length - 1];
    const mins = Math.round((b.focusMs || 0) / 60000);
    const target = b.targetMin || 25;
    const done = Math.round(Math.min(1, (b.focusMs || 0) / 60000 / target) * 100);
    const driftNote = !driftMeasured(b)
      ? '这一次是扣屏模式，没有测量切屏。'
      : driftCountOf(b)
        ? `期间切屏 ${driftCountOf(b)} 次。`
        : '期间没有记录到切屏。';
    out.push({
      tag: '这一次',
      text: `目标 ${target} 分钟，实际 ${mins} 分钟，完成度 ${done}%。${driftNote}样本还太少，先积累几天再看趋势。`,
    });
    if (b.warm) {
      out.push({
        tag: '热身',
        text: `本次热身 ${b.warm.trials} 题，正确率 ${Math.round(b.warm.accuracy * 100)}%，呈现窗口停在 ${b.warm.duration}ms。再做几次，窗口会随表现继续压缩。`,
      });
    }
    out.push({
      tag: '边界',
      text: '这里只统计窗口内的切屏分心。拿起手机、纸质笔记走神这些看不到，别把数据当成全天专注度的完整描述。',
    });
    return out;
  }

  // 1. time-of-day signal — needs at least two distinct hours with data
  const hist = hourHistogram(blocks).filter((h) => h.blocks >= 2);
  if (hist.length >= 2) {
    const best = [...hist].sort((a, b) => b.avg - a.avg)[0];
    const worst = [...hist].sort((a, b) => b.blocks - a.blocks)[0];
    if (best && worst && best.hour !== worst.hour && best.avg > worst.avg * 1.4) {
      out.push({
        tag: '时段',
        text: `${String(best.hour).padStart(2, '0')}:00 前后你的单块有效专注最长（均值 ${(best.avg / 60000).toFixed(0)} 分钟），${String(worst.hour).padStart(2, '0')}:00 最短。把最难的任务挪到前者。`,
      });
    }
  }

  // 2. streak
  const days = new Set(totals.map((t) => t.day));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (!days.has(dayKey(d))) break;
    streak++;
  }
  if (streak >= 3) out.push({ tag: '连续', text: `已连续 ${streak} 天出现专注块。这个连续性本身比单次时长更值得保护。` });
  else if (streak === 0 && blocks.length >= 3) out.push({ tag: '连续', text: '今天还没有完成专注块。先做一个短的把连续接上。' });

  // 3. drift trend — only when there is a real baseline to compare against
  if (prev.length >= 3 && recent.length >= 3) {
    const dr = driftRate(recent);
    const dp = driftRate(prev);
    if (dr != null && dp != null && dp - dr >= 0.08) {
      out.push({ tag: '分心', text: `分心占比从 ${(dp * 100).toFixed(0)}% 降到 ${(dr * 100).toFixed(0)}%，抗干扰在变好，保持同样的日程安排。` });
    } else if (dr != null && dp != null && dr - dp >= 0.08) {
      out.push({ tag: '分心', text: `分心占比从 ${(dp * 100).toFixed(0)}% 升到 ${(dr * 100).toFixed(0)}%。这通常是任务难度上去了，不是退步——可以把专注块目标时长降一档。` });
    }
  } else if (blocks.length >= 3) {
    const dr = driftRate(recent);
    if (dr == null) {
      out.push({ tag: '分心', text: '最近的专注块都是扣屏模式，没有测量切屏，所以这里不给分心结论。切到亮屏模式跑几次，才谈得上抗干扰。' });
    } else if (dr > 0.3) {
      out.push({ tag: '分心', text: `当前分心占比约 ${(dr * 100).toFixed(0)}%。切屏之外的注意力流失这个网页看不见，别把它当成全部真相。` });
    } else if (dr < 0.12) {
      out.push({ tag: '分心', text: `分心占比约 ${(dr * 100).toFixed(0)}%，窗口内的干扰控制得不错。` });
    }
  }

  // 4. warm-up trend — throughput is the headline cognitive metric
  const warms = blocks.filter((b) => b.warm && b.warm.trials >= 8);
  if (warms.length >= 4) {
    const first = warms[0].warm;
    const last = warms[warms.length - 1].warm;
    const dThroughput = last.throughput - first.throughput;
    const dAcc = last.accuracy - first.accuracy;
    if (dThroughput >= 3) out.push({ tag: '热身', text: `热身速度从每分钟 ${first.throughput} 次提到 ${last.throughput} 次，呈现时长被自适应压短了 ${last.duration - first.duration}ms。准确率同时${dAcc >= 0 ? '上升' : '下降'} ${(Math.abs(dAcc) * 100).toFixed(0)} 个点。` });
    else out.push({ tag: '热身', text: `热身难度停在每分钟 ${last.throughput} 次。呈现时长已到 ${last.duration}ms 的下限附近，如果准确率长期高于 90% 说明天花板到了，需要更快的识别任务而不是更短的窗口。` });
  }

  // 5. honest ceiling note — always after enough data, once
  if (blocks.length >= 10 && !out.some((o) => o.tag === '热身')) {
    out.push({ tag: '边界', text: '这里只统计窗口内的切屏分心。拿起手机、纸质笔记走神这些看不到，别把数据当成全天专注度的完整描述。' });
  }

  return out.slice(0, 4);
}
