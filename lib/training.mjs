export const MODULES = ['warmup', 'focus', 'schulte', 'tracking', 'gonogo', 'nback'];

export function makeSchulteGrid(size = 5, random = Math.random) {
  if (!Number.isInteger(size) || size < 2 || size > 7) throw new RangeError('size must be 2..7');
  const values = Array.from({ length: size * size }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function makeNBackSequence(length = 12, n = 1, random = Math.random, alphabet = ['○', '△', '□', '◇']) {
  if (!Number.isInteger(length) || length < 1 || !Number.isInteger(n) || n < 1 || !alphabet.length) throw new RangeError('invalid sequence settings');
  const sequence = [];
  for (let i = 0; i < length; i++) {
    const match = i >= n && random() < 0.35;
    let value;
    if (match) value = sequence[i - n].value;
    else {
      const choices = i >= n ? alphabet.filter((item) => item !== sequence[i - n].value) : alphabet;
      value = choices[Math.floor(random() * choices.length)];
    }
    sequence.push({ value, match });
  }
  return sequence;
}

export function scoreGoNoGo(trials) {
  const hits = trials.filter((t) => t.go && t.pressed).length;
  const correctRejections = trials.filter((t) => !t.go && !t.pressed).length;
  const misses = trials.filter((t) => t.go && !t.pressed).length;
  const falseAlarms = trials.filter((t) => !t.go && t.pressed).length;
  const total = trials.length;
  return { hits, correctRejections, misses, falseAlarms, accuracy: total ? (hits + correctRejections) / total : 0 };
}

export function makeDailyPlan(date = new Date().toISOString().slice(0, 10)) {
  const pool = ['schulte', 'tracking', 'gonogo', 'nback', 'warmup', 'focus'];
  const day = Math.floor(new Date(`${date}T00:00:00`).getTime() / 86400000) || 0;
  const start = ((day % pool.length) + pool.length) % pool.length;
  return [0, 2, 4].map((offset) => pool[(start + offset) % pool.length]);
}

export function validateBackup(data) {
  const legacy = data && data.v === 1 && Array.isArray(data.blocks) && data.workouts === undefined;
  if (!data || (!legacy && (data.version !== 2 || !Array.isArray(data.blocks) || !Array.isArray(data.workouts)))) return null;
  if (legacy) data = { ...data, workouts: [] };
  if (data.workouts.some((w) => !w || !MODULES.includes(w.module) || typeof w.day !== 'string' || !Number.isFinite(w.durationMs) || w.durationMs < 0 || !w.score || typeof w.score !== 'object')) return null;
  if (data.blocks.some((b) => !b || typeof b.day !== 'string' || typeof b.startedAt !== 'string' || Number.isNaN(Date.parse(b.startedAt)) || !Number.isFinite(b.focusMs) || !Array.isArray(b.drift))) return null;
  return { v: 1, blocks: data.blocks, workouts: data.workouts };
}

export function trainingTotals(workouts) {
  return workouts.reduce((out, w) => {
    if (!w || !MODULES.includes(w.module)) return out;
    const item = out[w.module] ||= { sessions: 0, durationMs: 0, days: 0, _days: new Set() };
    item.sessions++;
    item.durationMs += Number.isFinite(w.durationMs) ? w.durationMs : 0;
    item._days.add(w.day);
    item.days = item._days.size;
    return out;
  }, {});
}
