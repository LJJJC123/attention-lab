/* Speed-of-processing engine (ACTIVE-trial "Double Decision" pattern).
 * Pure functions + a tiny state object — no DOM, no timers, no React.
 * Lives in .mjs so tests/run.mjs can import it under plain node.
 */

export const SHAPES = [
  { id: 'circle', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  { id: 'square', d: 'M4 4h16v16H4z' },
  { id: 'triangle', d: 'M12 3l9 17H3z' },
  { id: 'diamond', d: 'M12 2l10 10-10 10L2 12z' },
  { id: 'hexagon', d: 'M7 3h10l5 9-5 9H7l-5-9z' },
  { id: 'star', d: 'M12 2l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.5L5.8 21l1.4-7L2 9.3l7-.8z' },
  { id: 'cross', d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z' },
  { id: 'arrow', d: 'M12 2l9 9h-5v11h-8V11H3z' },
];

/* Discriminability comes from lightness, not hue: a dark UI must not fight
 * itself with eight competing accent colours. ponytail: swap SHAPES_L to
 * hues if a future study needs colour as a second channel. */
export const SHAPES_L = [95, 88, 80, 72, 64, 57, 50, 43];

export const LIMITS = {
  duration: { min: 200, max: 900, start: 700, stepUp: -45, stepDown: 70 },
  radius: { min: 0.13, max: 0.30, start: 0.30, stepUp: -0.028, stepDown: 0.03 },
};

export const RESPONSE_WINDOW = 1400; // ms allowed to answer before a miss is recorded

export function createEngine(overrides) {
  const l = LIMITS;
  const s = {
    duration: l.duration.start,
    radius: l.radius.start,
    accuracy: 0.7, // EMA seed: start mid-band so trial 1 behaves
    rt: 620, // EMA of reaction time, ms
    trials: 0,
    correct: 0,
    sinceStep: 0,
    history: [],
  };
  return overrides ? { ...s, ...overrides } : s;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Deterministic RNG so a seed reproduces a whole block — used by tests. */
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    return a / 4294967296;
  };
}

export function makeTrial(engine, rng) {
  const same = rng() < 0.5;
  const central = Math.floor(rng() * SHAPES.length);
  const peripheral = same ? central : (central + 1 + Math.floor(rng() * (SHAPES.length - 1))) % SHAPES.length;
  return {
    central,
    peripheral,
    position: Math.floor(rng() * 8),
    duration: Math.round(engine.duration),
    radius: engine.radius,
    expected: same ? 'same' : 'diff',
  };
}

/* Adjust difficulty only on an accuracy EMA, and only every 4 trials.
 * Raw windowed accuracy on 4 samples is too jumpy to steer a difficulty curve. */
function retune(engine) {
  if (engine.sinceStep < 4) return engine;
  let next = { ...engine, sinceStep: 0 };
  const l = LIMITS;
  if (engine.accuracy >= 0.85) {
    next.duration = clamp(engine.duration + l.duration.stepUp, l.duration.min, l.duration.max);
    next.radius = clamp(engine.radius + l.radius.stepUp, l.radius.min, l.radius.max);
  } else if (engine.accuracy <= 0.62) {
    next.duration = clamp(engine.duration + l.duration.stepDown, l.duration.min, l.duration.max);
    next.radius = clamp(engine.radius + l.radius.stepDown, l.radius.min, l.radius.max);
  }
  return next;
}

export function applyResponse(engine, trial, response, elapsed) {
  // response null/empty => never answered inside the window => a miss
  const correct = response === trial.expected;
  const rt = correct && elapsed > 0 ? Math.round(elapsed) : engine.rt;
  const next = {
    ...engine,
    trials: engine.trials + 1,
    correct: engine.correct + (correct ? 1 : 0),
    accuracy: engine.accuracy * 0.65 + (correct ? 1 : 0) * 0.35,
    rt: correct ? engine.rt * 0.65 + rt * 0.35 : engine.rt,
    sinceStep: engine.sinceStep + 1,
    history: [...engine.history, { correct, rt, duration: trial.duration }],
  };
  return retune(next);
}

export function summarise(engine) {
  return {
    trials: engine.trials,
    accuracy: engine.trials ? engine.correct / engine.trials : 0,
    medianRt: Math.round(engine.rt),
    duration: Math.round(engine.duration),
    radius: Number(engine.radius.toFixed(3)),
    /* the headline number: how fast can you still make the call */
    throughput: engine.duration > 0 ? Math.round(60000 / engine.duration) : 0,
  };
}

export const difficultyIndex = (e) =>
  ((LIMITS.duration.max - e.duration) / (LIMITS.duration.max - LIMITS.duration.min)) * 0.6 +
  ((LIMITS.radius.max - e.radius) / (LIMITS.radius.max - LIMITS.radius.min)) * 0.4;
