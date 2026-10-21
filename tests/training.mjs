import {
  makeSchulteGrid, makeNBackSequence, scoreGoNoGo, makeDailyPlan,
  validateBackup, trainingTotals,
} from '../lib/training.mjs';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (error) { console.error('FAIL ' + name + '\n  ' + error.message); process.exitCode = 1; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

console.log('training');
test('Schulte grid contains every number exactly once', () => {
  const grid = makeSchulteGrid(5, () => 0.42);
  assert(grid.length === 25 && new Set(grid).size === 25 && Math.min(...grid) === 1 && Math.max(...grid) === 25, 'expected permutation 1..25');
});
test('N-back sequence exposes the correct prior-match answer', () => {
  const sequence = makeNBackSequence(12, 1, () => 0.7);
  assert(sequence.length === 12, 'expected 12 stimuli');
  assert(sequence.every((item, index) => item.match === (index >= 1 && item.value === sequence[index - 1].value)), 'match flags must agree with prior stimulus');
});
test('Go/No-Go score counts hits, correct rejections, misses and false alarms', () => {
  const score = scoreGoNoGo([{ go: true, pressed: true }, { go: false, pressed: false }, { go: true, pressed: false }, { go: false, pressed: true }]);
  assert(score.hits === 1 && score.correctRejections === 1 && score.misses === 1 && score.falseAlarms === 1, 'classification counts are incorrect');
  assert(score.accuracy === 0.5, 'accuracy should be 2/4');
});
test('daily plan rotates deterministically by local date', () => {
  const a = makeDailyPlan('2026-10-21');
  assert(a.length === 3 && new Set(a).size === 3, 'daily plan should contain three distinct modules');
  assert(JSON.stringify(a) === JSON.stringify(makeDailyPlan('2026-10-21')), 'same date should give same plan');
  assert(JSON.stringify(a) !== JSON.stringify(makeDailyPlan('2026-10-22')), 'adjacent dates should rotate');
});
test('backup validation rejects unknown schema without accepting partial state', () => {
  assert(validateBackup({ version: 2, workouts: [] }) === null, 'unknown schema must be rejected');
  assert(validateBackup({ version: 2, blocks: [], workouts: [{ module: 'unknown' }] }) === null, 'invalid module must be rejected');
  assert(validateBackup({ v: 1, blocks: [] })?.workouts.length === 0, 'legacy local backup should migrate');
});
test('training totals are grouped by module and day', () => {
  const totals = trainingTotals([
    { id: '1', module: 'schulte', day: '2026-10-21', durationMs: 60000, score: { accuracy: 0.8 } },
    { id: '2', module: 'schulte', day: '2026-10-21', durationMs: 30000, score: { accuracy: 1 } },
    { id: '3', module: 'nback', day: '2026-10-20', durationMs: 45000, score: { accuracy: 0.6 } },
  ]);
  assert(totals.schulte.sessions === 2 && totals.schulte.durationMs === 90000, 'Schulte total mismatch');
  assert(totals.nback.days === 1 && totals.nback.sessions === 1, 'N-back total mismatch');
});
