'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { makeSchulteGrid, makeNBackSequence, scoreGoNoGo } from '../lib/training.mjs';

const GAMES = [
  ['schulte', '舒尔特方格', '按顺序找到数字，练习视觉搜索。', '约 1–3 分钟', '从 1 开始，按顺序点击方格里的数字，直到本轮最大数字。点错不会前进；入门、进阶、挑战分别是 4×4、5×5、6×6。'],
  ['tracking', '视觉追踪', '跟随目标位置变化，保持视线专注。', '约 12–30 秒', '留意九宫格中亮起的圆点，圆点移动后尽快点击它。目标会持续移动，时间结束后显示命中次数。'],
  ['gonogo', '抑制控制', '看到圆形目标按下，看到方形目标忍住。', '约 10–26 秒', '看到圆形时尽快点按钮或按空格；看到方形时不要操作。每个图形停留不到一秒，结束后查看命中、漏按和误按。'],
  ['nback', '工作记忆', '判断当前图形是否与前几项相同。', '约 10–20 秒', '比较当前图形与前 N 项：相同就点按钮或按空格，不同就不操作。难度决定 N=1、2 或 3；每个图形停留不到一秒。'],
  ['warmup', '处理速度热身', '比较屏幕中央与周边闪现的图形。', '约 3 分钟', '每题同时看中央图形和周边图形，判断形状是否相同。相同按 F / ←，不同按 J / →；手机可点屏幕按钮。共 60 题，题目会随表现调整呈现速度。'],
  ['focus', '专注计时', '设定一段时间，专心完成手头任务。', '15 / 25 / 45 分钟', '先选择时长与亮屏或扣屏模式，再开始计时。亮屏模式记录离开页面的时间；扣屏模式只记录时长。中途可暂停或放弃，放弃不会记入报告。'],
];
const randomTrials = (n) => Array.from({ length: n }, () => ({ go: Math.random() > 0.3 }));

export default function TrainingLab({ onSave, onLegacy, initialModule }) {
  const [game, setGame] = useState('');
  const [level, setLevel] = useState(0);
  const didAutoStart = useRef(false);
  const [grid, setGrid] = useState([]);
  const [nextNumber, setNextNumber] = useState(1);
  const [mistakes, setMistakes] = useState(0);
  const [sequence, setSequence] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [trial, setTrial] = useState([]);
  const [target, setTarget] = useState(0);
  const [hits, setHits] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const hitsRef = useRef(0);
  const [result, setResult] = useState(null);

  const finish = (score) => {
    const durationMs = Math.max(1000, Date.now() - startedAt);
    const item = { id: `${Date.now()}`, module: game, day: new Date().toLocaleDateString('en-CA'), durationMs, score };
    onSave(item); setResult(item); setGame('');
  };
  const start = (id) => {
    setGame(id); setResult(null); setStartedAt(Date.now()); setIndex(0); setAnswers([]); setHits(0); setMistakes(0); hitsRef.current = 0;
    if (id === 'schulte') { setGrid(makeSchulteGrid(4 + level)); setNextNumber(1); }
    if (id === 'tracking') setTarget(0);
    if (id === 'gonogo') setTrial(randomTrials([12, 20, 30][level]));
    if (id === 'nback') setSequence(makeNBackSequence([12, 18, 24][level], level + 1));
  };

  useEffect(() => {
    if (initialModule && !didAutoStart.current) { didAutoStart.current = true; if (['schulte','tracking','gonogo','nback'].includes(initialModule)) start(initialModule); }
  }, [initialModule]);

  useEffect(() => {
    if (!['gonogo', 'nback'].includes(game)) return;
    const list = game === 'gonogo' ? trial : sequence;
    if (index >= list.length) {
      if (game === 'gonogo') finish(scoreGoNoGo(trial.map((x, i) => ({ go: x.go, pressed: answers[i] === true }))));
      else finish({ correct: answers.filter((x, i) => x === sequence[i].match).length, trials: sequence.length, accuracy: answers.length ? answers.filter((x, i) => x === sequence[i].match).length / sequence.length : 0 });
      return;
    }
    const timer = setTimeout(() => {
      setAnswers((old) => old[index] === undefined ? [...old, false] : old);
      setIndex((i) => i + 1);
    }, 850);
    return () => clearTimeout(timer);
  }, [game, index, trial, sequence]);

  useEffect(() => {
    if (game !== 'tracking') return;
    const timer = setInterval(() => setTarget((t) => (t + 1) % 9), 1100);
    const seconds = [12, 20, 30][level];
    const end = setTimeout(() => finish({ hits: hitsRef.current, targets: Math.ceil(seconds / 1.1), accuracy: hitsRef.current / Math.ceil(seconds / 1.1), level: level + 1 }), seconds * 1000);
    return () => { clearInterval(timer); clearTimeout(end); };
  }, [game, level]);

  const press = () => {
    if (game === 'gonogo' && index < trial.length) {
      setAnswers((a) => { const b = [...a]; b[index] = true; return b; });
    }
    if (game === 'nback' && index < sequence.length) {
      setAnswers((a) => { const b = [...a]; b[index] = true; return b; });
    }
  };
  useEffect(() => {
    if (!game) return;
    const key = (e) => { if (e.code === 'Space' && ['gonogo','nback'].includes(game)) { e.preventDefault(); press(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [game, index, trial, sequence]);

  const abort = () => { setGame(''); setResult(null); };
  const current = game === 'gonogo' ? trial[index] : sequence[index];
  const pos = useMemo(() => Array.from({ length: 9 }, (_, i) => i), []);

  return <div className="training-lab">
    {!game && <>
      <div className="hero"><p className="console-label">ATTENTION LAB · 练习空间</p><h1>选择一项训练</h1><p className="lede">短时、可重复的任务。成绩只描述本次练习表现，不代表认知能力。</p></div>
      <div className="level-picker" role="group" aria-label="练习难度"><span>难度</span>{['入门','进阶','挑战'].map((name, i) => <button key={name} className={level === i ? 'selected' : ''} aria-pressed={level === i} onClick={() => setLevel(i)}>{name}</button>)}</div>
      {result && <div className="card result-card"><div className="card-head"><h2>本次完成</h2><span className="tag">{GAMES.find((x) => x[0] === result.module)?.[1]}</span></div><p>用时 {Math.round(result.durationMs / 1000)} 秒 · 正确率 {Math.round((result.score.accuracy || 0) * 100)}%</p><p className="result-detail">{Object.entries(result.score).filter(([key]) => key !== 'accuracy').map(([key, value]) => `${({hits:'命中', correctRejections:'正确忍住', misses:'漏按', falseAlarms:'误按', correct:'正确判断', trials:'题数', targets:'目标数', errors:'误触'}[key] || key)} ${value}`).join('　·　')}</p><button className="btn ghost" onClick={() => setResult(null)}>关闭</button></div>}
      <div className="game-grid">{GAMES.map(([id, name, desc, time, guide], i) => <article className="card game-card" key={id}><span className="game-index">0{i + 1}</span><h2>{name}</h2><p>{desc}</p><details className="game-guide"><summary>玩法说明</summary><p>{guide}</p></details><div className="game-foot"><span>{time}</span><button className="btn" onClick={() => id === 'warmup' ? onLegacy('warmup') : id === 'focus' ? onLegacy('focus') : start(id)}>开始练习</button></div></article>)}</div>
      
    </>}
    {game && <div className="narrow game-stage"><div className="card"><div className="card-head"><h2>{GAMES.find((x) => x[0] === game)?.[1]}</h2><button className="btn ghost" onClick={abort}>退出本轮</button></div><div className="game-instructions"><strong>玩法说明</strong><p>{GAMES.find((x) => x[0] === game)?.[4]}</p></div>
      {game === 'schulte' && <><p>依次点击数字 <b>{nextNumber}</b> / {grid.length}</p><div className="schulte-grid" style={{ '--grid-size': Math.sqrt(grid.length) }}> {grid.map((n, i) => <button key={i} className="schulte-cell" onClick={() => { if (n === nextNumber) { if (n === grid.length) finish({ correct: grid.length, trials: grid.length + mistakes, errors: mistakes, accuracy: grid.length / (grid.length + mistakes), level: level + 1 }); else setNextNumber(n + 1); } else setMistakes((m) => m + 1); }}>{n}</button>)}</div></>}
      {game === 'tracking' && <><p>跟随移动目标并点击它，保持稳定的视觉追踪。</p><div className="track-board">{pos.map((i) => <button key={i} className={`track-dot${target === i ? ' active' : ''}`} aria-label={target === i ? '移动目标' : '空位'} onClick={() => { if (target === i) { hitsRef.current++; setHits((h) => h + 1); } }} />)}</div><p>命中 {hits} 次</p></>}
      {['gonogo','nback'].includes(game) && <div className="stimulus-wrap"><div aria-live="polite" className={`stimulus ${game === 'gonogo' && current?.go ? 'go' : ''}`}>{game === 'gonogo' ? (current ? (current.go ? '●' : '■') : '完成') : (current?.value || '完成')}</div><p>{index < (game === 'gonogo' ? trial.length : sequence.length) ? `${index + 1} / ${game === 'gonogo' ? trial.length : sequence.length}` : '正在汇总…'}</p><button className="btn lg" onClick={press}>{game === 'gonogo' ? '按下 / 空格' : '与上一项相同 / 空格'}</button></div>}
    </div></div>}
  </div>;
}
