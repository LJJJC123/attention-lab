/* The one runnable check ponytail asks for: no framework, no fixtures.
 * node tests/run.mjs
 */
import assert from 'node:assert/strict';
import {
  createEngine, makeRng, makeTrial, applyResponse, summarise, difficultyIndex,
  LIMITS,
} from '../lib/engine.mjs';
import {
  emptyState, load, save, newBlock, closeBlock, dailyTotals, decayCurve, hourHistogram, advise,
  driftMsOf, driftCountOf, driftMeasured, measuredDrift,
} from '../lib/store.mjs';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('engine');

t('a strong player ratchets difficulty down to the floor', () => {
  let e = createEngine();
  const rnd = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const tr = makeTrial(e, rnd);
    e = applyResponse(e, tr, tr.expected, 300); // always right
  }
  assert.equal(e.duration, LIMITS.duration.min);
  assert.ok(e.accuracy > 0.9);
  assert.equal(summarise(e).accuracy, 1);
});

t('a struggling player ratchets difficulty back up to the ceiling', () => {
  let e = createEngine();
  const rnd = makeRng(9);
  for (let i = 0; i < 200; i++) {
    const tr = makeTrial(e, rnd);
    e = applyResponse(e, tr, tr.expected === 'same' ? 'diff' : 'same', 900); // always wrong
  }
  assert.equal(e.duration, LIMITS.duration.max);
  assert.equal(summarise(e).accuracy, 0);
});

t('no response counts as a miss, not a pass', () => {
  const e = createEngine();
  const tr = makeTrial(e, makeRng(3));
  const next = applyResponse(e, tr, null, 0);
  assert.equal(next.correct, 0);
  assert.equal(next.trials, 1);
});

t('difficulty never steps more than once per 4 trials', () => {
  let e = createEngine();
  const rnd = makeRng(11);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const tr = makeTrial(e, rnd);
    e = applyResponse(e, tr, tr.expected, 300);
    seen.push(e.duration);
  }
  // durations must be non-increasing, and change at most 3 times in 12 trials
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], 'difficulty must never rise on correct answers');
  let changes = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) changes++;
  assert.ok(changes <= 3, `too many retunes: ${changes}`);
});

t('difficulty index is bounded and monotonic', () => {
  const easy = difficultyIndex({ duration: LIMITS.duration.max, radius: LIMITS.radius.max });
  const hard = difficultyIndex({ duration: LIMITS.duration.min, radius: LIMITS.radius.min });
  assert.equal(easy, 0);
  assert.equal(hard, 1);
});

t('the same seed reproduces the same block', () => {
  let a = createEngine(), b = createEngine();
  const ra = makeRng(42), rb = makeRng(42);
  for (let i = 0; i < 30; i++) {
    const ta = makeTrial(a, ra), tb = makeTrial(b, rb);
    assert.deepEqual(ta, tb);
    a = applyResponse(a, ta, ta.expected, 250);
    b = applyResponse(b, tb, tb.expected, 250);
  }
  assert.deepEqual(a, b);
  assert.ok(a.trials === 30);
});

t('peripheral position and shape stay in range', () => {
  const e = createEngine();
  const rnd = makeRng(5);
  for (let i = 0; i < 500; i++) {
    const tr = makeTrial(e, rnd);
    assert.ok(tr.position >= 0 && tr.position < 8);
    assert.ok(tr.central >= 0 && tr.central < 8);
    assert.ok(tr.peripheral >= 0 && tr.peripheral < 8);
    assert.ok(['same', 'diff'].includes(tr.expected));
    if (tr.expected === 'same') assert.equal(tr.central, tr.peripheral);
    else assert.notEqual(tr.central, tr.peripheral);
  }
});

console.log('store');

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

t('empty and corrupted storage both degrade to empty state', () => {
  assert.deepEqual(load(memStore()), emptyState());
  const bad = memStore();
  bad.setItem('attnlab.v1', '{not json');
  assert.deepEqual(load(bad), emptyState());
  bad.setItem('attnlab.v1', JSON.stringify({ v: 99, blocks: [] }));
  assert.deepEqual(load(bad), emptyState(), 'wrong schema version must be discarded');
});

t('garbage blocks are filtered out, good ones survive a round trip', () => {
  const s = memStore();
  const good = newBlock(25);
  save({ v: 1, blocks: [good, { nope: true }, null, { day: 'x' }] }, s);
  const back = load(s);
  assert.equal(back.blocks.length, 1);
  assert.equal(back.blocks[0].day, good.day);
});

t('dailyTotals sums focus and drift correctly', () => {
  const b1 = { ...newBlock(25), day: '2026-01-01', focusMs: 600000, drift: [{ at: 0, ms: 5000 }, { at: 1, ms: 3000 }] };
  const b2 = { ...newBlock(25), day: '2026-01-01', focusMs: 300000, drift: [] };
  const b3 = { ...newBlock(25), day: '2026-01-02', focusMs: 900000, drift: [] };
  const rows = dailyTotals([b1, b2, b3]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, '2026-01-01');
  assert.equal(rows[0].focusMs, 900000);
  assert.equal(rows[0].driftMs, 8000);
  assert.equal(rows[0].driftCount, 2);
  assert.ok(rows[0].completion > 0 && rows[0].completion <= 1);
  assert.equal(rows[1].focusMs, 900000);
});

t('decayCurve is 5 bounded slots and drops when drift lands inside', () => {
  const base = new Date('2026-01-01T10:00:00Z').getTime();
  const clean = { startedAt: new Date(base).toISOString(), focusMs: 600000, drift: [] };
  assert.deepEqual(decayCurve(clean), [1, 1, 1, 1, 1]);
  const lost = { startedAt: clean.startedAt, focusMs: 600000, drift: [{ at: base + 300000, ms: 60000 }] };
  const c = decayCurve(lost);
  assert.equal(c.length, 5);
  assert.ok(c[2] < 1, 'the slot containing the drift must show a loss');
  assert.ok(c.every((v) => v >= 0 && v <= 1));
  // sub-second blips are noise, must not dent the curve
  const blip = { startedAt: clean.startedAt, focusMs: 600000, drift: [{ at: base + 300000, ms: 400 }] };
  assert.deepEqual(decayCurve(blip), [1, 1, 1, 1, 1]);
});

t('hourHistogram buckets by start hour and averages per block', () => {
  const a = { startedAt: '2026-01-01T09:30:00', focusMs: 600000, drift: [] };
  const b = { startedAt: '2026-01-01T09:10:00', focusMs: 300000, drift: [] };
  const c = { startedAt: '2026-01-01T14:00:00', focusMs: 1200000, drift: [] };
  const h = hourHistogram([a, b, c]);
  assert.equal(h.length, 24);
  assert.equal(h[9].blocks, 2);
  assert.equal(h[9].avg, 450000);
  assert.equal(h[14].blocks, 1);
});

console.log('advice');

const fake = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

t('no data yields exactly the starter advice', () => {
  const a = advise([]);
  assert.equal(a.length, 1);
  assert.equal(a[0].tag, '开始');
});

t('advice never invents: an hour pattern needs repeated blocks in those hours', () => {
  const one = [{ ...newBlock(25), startedAt: new Date().setHours(9, 0, 0, 0) ? new Date(new Date().setHours(9, 0, 0, 0)).toISOString() : '', focusMs: 9e5, drift: [] }];
  assert.equal(advise(one).some((x) => x.tag === '时段'), false, 'single block must not produce a 时段 claim');
});

t('advice output is capped at 4 and never empty once there is data', () => {
  const many = fake(30, (i) => ({
    ...newBlock(25),
    day: '2026-01-01',
    startedAt: new Date(2026, 0, 1, 8 + (i % 12)).toISOString(),
    focusMs: 900000,
    drift: [{ at: Date.now(), ms: 30000 }],
    warm: { trials: 12, accuracy: 0.8, throughput: 60 + i, duration: 300 },
  }));
  const a = advise(many);
  assert.ok(a.length > 0 && a.length <= 4);
  assert.ok(a.every((x) => typeof x.tag === 'string' && typeof x.text === 'string' && x.text.length > 0));
});

t('throughput improvement is reported as a real observation', () => {
  const blocks = fake(6, (i) => ({
    ...newBlock(25),
    day: '2026-01-01',
    startedAt: new Date(2026, 0, 1 + i, 9).toISOString(),
    focusMs: 9e5,
    drift: [],
    warm: { trials: 12, accuracy: 0.8, throughput: i === 0 ? 40 : 70, duration: i === 0 ? 700 : 300 },
  }));
  const hit = advise(blocks).find((x) => x.tag === '热身');
  assert.ok(hit, 'expected a 热身 observation');
  assert.match(hit.text, /70/);
});

t('a block missing startedAt is dropped, not crashed on', () => {
  // regression: hourHistogram and decayCurve both parse startedAt. A block
  // without it once threw "reading reduce" and blanked the whole report.
  const s = memStore();
  const bad = { day: '2026-01-01', focusMs: 600000, drift: [{ at: 1, ms: 1000 }] }; // no startedAt
  const good = newBlock(25);
  good.day = '2026-01-01';
  good.focusMs = 600000;
  save({ v: 1, blocks: [bad, good] }, s);
  const back = load(s);
  assert.equal(back.blocks.length, 1);
  assert.doesNotThrow(() => dailyTotals(back.blocks));
  assert.doesNotThrow(() => hourHistogram(back.blocks));
  assert.doesNotThrow(() => decayCurve(back.blocks[0]));
  assert.doesNotThrow(() => advise(back.blocks));
});

t('an unparseable startedAt is rejected as well', () => {
  const s = memStore();
  const b = newBlock(25);
  b.startedAt = 'not-a-date';
  save({ v: 1, blocks: [b] }, s);
  assert.equal(load(s).blocks.length, 0);
});

t('aggregation survives malformed drift entries', () => {
  const weird = [
    { ...newBlock(25), day: '2026-01-01', focusMs: 600000, drift: [null, { ms: 'x' }, { at: 1, ms: 2000 }] },
  ];
  assert.doesNotThrow(() => dailyTotals(weird));
  assert.equal(dailyTotals(weird)[0].driftMs, 2000);
  assert.equal(dailyTotals(weird)[0].driftCount, 3);
  assert.doesNotThrow(() => decayCurve(weird[0]));
  assert.doesNotThrow(() => advise(weird));
});

t('drift accessors never throw, whatever the block looks like', () => {
  // regression: the report used a raw b.drift.reduce, so one block with a
  // missing drift array unmounted the entire React tree. These helpers are now
  // the only sanctioned way to read drift.
  assert.equal(driftMsOf(undefined), 0);
  assert.equal(driftMsOf({}), 0);
  assert.equal(driftMsOf({ drift: null }), 0);
  assert.equal(driftMsOf({ drift: [null, { ms: 'x' }, { at: 1, ms: 2000 }] }), 2000);
  assert.equal(driftCountOf({}), 0);
  assert.equal(driftCountOf({ drift: [{ ms: 1 }, { ms: 2 }] }), 2);

  // and the aggregation must survive a poisoned block mixed with good ones
  const mixed = [newBlock(25), { day: '2026-01-01', focusMs: 60000 }, newBlock(25)];
  assert.doesNotThrow(() => dailyTotals(mixed));
  assert.doesNotThrow(() => advise(mixed));
});

t('advice is never empty once there is data, however few blocks', () => {
  // regression: one block produced [] and the report rendered a heading with
  // nothing under it. Short-sample advice must describe what is in hand.
  for (const n of [1, 2, 3, 5]) {
    const list = Array.from({ length: n }, (_, i) => {
      const b = newBlock(25);
      b.id = 'b' + i;
      b.day = '2026-01-0' + (i + 1);
      b.startedAt = new Date(2026, 0, i + 1, 9 + i).toISOString();
      b.focusMs = 900000;
      b.drift = [{ at: Date.now() - 60000, ms: 12000 }];
      b.warm = { trials: 60, accuracy: 0.82, duration: 300, throughput: 200 };
      return b;
    });
    const a = advise(list);
    assert.ok(a.length > 0, `n=${n} produced no advice`);
    assert.ok(a.length <= 4, `n=${n} exceeded the cap`);
    assert.ok(a.every((x) => x.tag && x.text), `n=${n} has a malformed entry`);
  }
});

t('single-block advice reports the actual numbers', () => {
  const b = newBlock(25);
  b.day = '2026-01-01';
  b.focusMs = 300000; // 5 of 25 minutes
  b.drift = [{ at: 1, ms: 3000 }];
  b.warm = { trials: 60, accuracy: 0.9, duration: 250, throughput: 240 };
  const a = advise([b]);
  const flat = a.map((x) => x.text).join(' ');
  assert.match(flat, /目标 25 分钟/, 'should name the target');
  assert.match(flat, /实际 5 分钟/, 'should name the real duration');
  assert.match(flat, /切屏 1 次/, 'should name the drift count');
});

/* ---- phone / face-down mode ------------------------------------------------
 * The whole reason driftMode exists: a phone block run face-down has its screen
 * sleep, which fires the same visibilitychange as picking up another app. If
 * those empty drift arrays were averaged in as zero, the report would show a
 * flawless 0% drift for exactly the sessions where it knows nothing. */

console.log('\nface-down mode');

t('an unmeasured block is excluded from drift, not counted as zero', () => {
  const measured = newBlock(25, 'screen');
  measured.focusMs = 1500000;
  measured.drift = [{ at: 1, ms: 120000 }];
  const facedown = newBlock(25, 'off');
  facedown.focusMs = 1500000;
  facedown.drift = []; // nothing recorded, by design

  assert.equal(driftMeasured(measured), true);
  assert.equal(driftMeasured(facedown), false);

  const md = measuredDrift([measured, facedown]);
  assert.equal(md.blocks, 1, 'only the measured block should count');
  assert.equal(md.ms, 120000, 'the facedown block must contribute no drift');
  assert.equal(md.count, 1);

  // focus time, by contrast, must include both
  const rows = dailyTotals([measured, facedown]);
  assert.equal(rows[0].focusMs, 3000000, 'focus time covers every block');
  assert.equal(rows[0].measuredBlocks, 1);
});

t('blocks with no driftMode field count as measured (pre-PWA backups)', () => {
  assert.equal(driftMeasured({}), true);
  assert.equal(driftMeasured({ driftMode: undefined }), true);
  assert.equal(driftMeasured({ driftMode: 'screen' }), true);
  // and load() normalises them so downstream code never sees a missing field
  const st = load({
    getItem: () => JSON.stringify({ v: 1, blocks: [{ day: '2026-01-01', startedAt: new Date().toISOString(), focusMs: 1000, drift: [] }] }),
  });
  assert.equal(st.blocks[0].driftMode, 'screen');
});

t('a garbage driftMode never turns a real block into an unmeasured one', () => {
  const st = load({
    getItem: () => JSON.stringify({
      v: 1,
      blocks: [
        { day: '2026-01-01', startedAt: new Date().toISOString(), focusMs: 1000, drift: [], driftMode: 'nonsense' },
        { day: '2026-01-02', startedAt: new Date().toISOString(), focusMs: 1000, drift: [], driftMode: 'off' },
      ],
    }),
  });
  assert.equal(st.blocks[0].driftMode, 'screen', 'unknown value should default to measured');
  assert.equal(st.blocks[1].driftMode, 'off');
});

t('advice refuses to state a drift rate when nothing was measured', () => {
  const list = Array.from({ length: 6 }, (_, i) => {
    const b = newBlock(25, 'off');
    b.id = 'x' + i;
    b.day = '2026-01-0' + (i + 1);
    b.startedAt = new Date(2026, 0, i + 1, 9).toISOString();
    b.focusMs = 1200000;
    b.drift = [];
    return b;
  });
  const flat = advise(list).map((x) => x.text).join(' ');
  assert.ok(!/\d+%/.test(flat.replace(/\d+ 个点/g, '')), 'must not quote a drift percentage: ' + flat);
  assert.match(flat, /没有测量切屏|不测量/, 'should say why there is no drift figure');
});

t('a single facedown block does not claim zero drift', () => {
  const b = newBlock(25, 'off');
  b.day = '2026-01-01';
  b.focusMs = 300000;
  b.drift = [];
  const flat = advise([b]).map((x) => x.text).join(' ');
  assert.match(flat, /扣屏模式|没有测量切屏/, 'should label the block: ' + flat);
  assert.doesNotMatch(flat, /没有记录到切屏/, 'must not imply a measured clean block');
});

console.log(`\n${n} checks passed`);
