// engine.js — vienas variklio šaltinis CLI ir viewer'iui (Node: require, naršyklė: <script src>)
(function (root) {
'use strict';
const D = 300, DOM = 100, TRAIN = 200;
const CFG = { trials: 300, driftAt: 150, minNode: 20, minGain: 0.02, lambda: 0.002,
  maxPool: 10, maxDepth: 5, topStable: 3, edgesM: 4, ema: 0.7, decay: 0.93, deadUse: 0.02, minAge: 30 };
// flat ignoruoja dedupe/prune/lambda perrašymus: tai bazinė linija
const resolveCfg = (mode, o = {}) => { const c = { ...CFG, ...o }, flat = mode === 'flat';
  c.dedupe = flat ? 'name' : o.dedupe || 'key';
  c.prune = flat ? false : o.prune !== undefined ? o.prune : true;
  c.lambda = flat ? 0 : c.lambda;
  c.pairing = mode === 'graph' ? 'graph' : 'top';
  return c; };
const MODES = ['flat', 'lifecycle', 'graph'];

const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const vec = (f) => Uint8Array.from({ length: D }, (_, n) => (f(n) ? 1 : 0));
const W2 = vec((n) => (n < 25 ? n % 2 === 0 : n < 50 ? n % 3 === 0 : n < 75 ? n % 4 === 0 : n % 5 === 0));
const W2C = vec((n) => (n < 25 ? n % 5 === 0 : n < 50 ? n % 4 === 0 : n < 75 ? n % 3 === 0 : n % 2 === 0));
const W2B = vec((n) => (n < 25 ? n % 3 === 0 : n < 50 ? n % 2 === 0 : n < 75 ? n % 5 === 0 : n % 4 === 0));
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

function newMode(mode, cfg) {
  const st = { mode, cfg, nextId: 0, grown: 0, edges: new Map(), conflictNodes: new Set(),
    metrics: { cur: [], extrap: [], train: [], pool: [], csize: [], acc: [] } };
  st.mk = (name, out, depth, size, parents, born, base = false) =>
    ({ id: st.nextId++, name, out, key: out.join(''), depth, size, parents, born, use: 0, base });
  st.pool = [2, 3, 4, 5].map((k) => st.mk(`n%${k}==0`, vec((n) => n % k === 0), 0, 1, [], 0, true));
  st.thr = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => st.mk(`n<${x}`, vec((n) => n < x), 0, 1, [], 0, true));
  st.bestP = st.pool[0];
  return st;
}

function stepMode(st, t, world, ns, y) {
  const cfg = st.cfg, M = st.metrics;
  const corrOf = (p) => Uint8Array.from(ns, (n, i) => (p.out[n] === y[i] ? 1 : 0));
  const C = new Map(st.pool.map((p) => [p.id, corrOf(p)]));
  const accs = st.pool.map((p) => ({ p, a: sum(C.get(p.id)) / TRAIN })).sort((x, z) => z.a - x.a);
  const bestP = accs[0].p, curTrain = accs[0].a;
  let h = 0, e = 0;
  for (let n = 0; n < DOM; n++) h += bestP.out[n] === world[n] ? 1 : 0;
  for (let n = DOM; n < D; n++) e += bestP.out[n] === world[n] ? 1 : 0;
  M.cur.push(h / DOM); M.extrap.push(e / (D - DOM)); M.train.push(curTrain);

  const spl = st.thr.concat(st.pool.filter((p) => p.depth < cfg.maxDepth));
  const nodeOf = (p1, p2) => { const r = []; for (let k = 0; k < TRAIN; k++) if (p1.out[ns[k]] !== p2.out[ns[k]]) r.push(k); return r; };

  const evalPair = (p1, p2) => {
    const c1 = C.get(p1.id), c2 = C.get(p2.id), node = nodeOf(p1, p2);
    if (node.length < cfg.minNode) return null;
    let nodeC1 = 0; for (const k of node) nodeC1 += c1[k];
    const agree = sum(c1) - nodeC1;
    let bestS = null, bestN = -1;
    for (const s of spl) { let r = 0; for (const k of node) r += s.out[ns[k]] ? c1[k] : c2[k]; if (r > bestN) { bestN = r; bestS = s; } }
    return { p1, p2, s: bestS, node, score: (agree + bestN) / TRAIN };
  };

  const pairs = [];
  if (cfg.pairing !== 'graph') {
    const top = accs.slice(0, cfg.topStable).map((x) => x.p);
    for (const p1 of top) for (const p2 of top) if (p1 !== p2) pairs.push([p1, p2]);
  } else {
    const live = new Set(st.pool.map((p) => p.id));
    for (const k of [...st.edges.keys()]) { const [a, b] = k.split('|').map(Number); if (!live.has(a) || !live.has(b)) st.edges.delete(k); }
    const cand = [];
    for (let i = 0; i < st.pool.length; i++) for (let j = i + 1; j < st.pool.length; j++) {
      const p1 = st.pool[i], p2 = st.pool[j], node = nodeOf(p1, p2);
      let tension = 0;
      if (node.length >= cfg.minNode) {
        let bestOn = 0;
        for (const p of st.pool) { const c = C.get(p.id); let s = 0; for (const k of node) s += c[k]; bestOn = Math.max(bestOn, s / node.length); }
        tension = (node.length / TRAIN) * (1 - bestOn);
      }
      const key = `${p1.id}|${p2.id}`, old = st.edges.get(key);
      const ema = old ? cfg.ema * old.t + (1 - cfg.ema) * tension : tension;
      st.edges.set(key, { t: ema });
      if (node.length >= cfg.minNode) cand.push({ p1, p2, t: ema });
    }
    cand.sort((x, z) => z.t - x.t);
    for (const c of cand.slice(0, cfg.edgesM)) { pairs.push([c.p1, c.p2]); pairs.push([c.p2, c.p1]); }
  }

  let best = null;
  for (const [p1, p2] of pairs) { const r = evalPair(p1, p2); if (r && (!best || r.score > best.score)) best = r; }

  let accepted = null;
  if (best) {
    const size = 1 + best.s.size + best.p1.size + best.p2.size;
    if (best.score > curTrain + cfg.minGain + cfg.lambda * size) {
      const out = new Uint8Array(D);
      for (let n = 0; n < D; n++) out[n] = best.s.out[n] ? best.p1.out[n] : best.p2.out[n];
      const name = `if ${best.s.name} then ${best.p1.name} else ${best.p2.name}`;
      const c = st.mk(name, out, Math.max(best.s.depth, best.p1.depth, best.p2.depth) + 1, size,
        [best.s.id, best.p1.id, best.p2.id], t);
      const dupe = st.pool.some((p) => (cfg.dedupe === 'name' ? p.name === name : p.key === c.key));
      if (!dupe) { c.use = 1; st.pool.push(c); accepted = { c, best }; st.grown++; }
    }
  }
  M.acc.push(accepted ? 1 : 0);

  if (cfg.prune) {
    for (const p of st.pool) p.use *= cfg.decay;
    bestP.use += 1;
    if (accepted) for (const q of [best.s, best.p1, best.p2]) q.use += 1;
    st.pool = st.pool.filter((p) => p.base || t - p.born < cfg.minAge || p.use >= cfg.deadUse);
  }
  while (st.pool.length > cfg.maxPool) {
    const rem = st.pool.filter((p) => !p.base);
    if (!rem.length) break;
    const key = (p) => (cfg.prune ? p.use + 1e-3 * (sum(corrOf(p)) / TRAIN) : sum(corrOf(p)) / TRAIN);
    rem.sort((x, z) => key(x) - key(z));
    st.pool = st.pool.filter((p) => p !== rem[0]);
  }

  const cs = st.pool.filter((p) => !p.base);
  M.pool.push(st.pool.length);
  M.csize.push(cs.length ? cs.reduce((s, p) => s + p.size, 0) / cs.length : 0);
  st.bestP = bestP;
  st.conflictNodes = best ? new Set(best.node.map((k) => ns[k])) : new Set();
}

// Visi režimai gauna tuos pačius duomenis kiekviename žingsnyje (porinis palyginimas)
function createSim({ scenario = 'stationary', seed = 42, noise = 0, cfg = {}, driftType = 'W2B' } = {}) {
  const driftWorld = { W2B, W2C }[driftType];
  if (!driftWorld) throw new Error('unknown driftType ' + driftType);
  const driftAt = cfg.driftAt || CFG.driftAt;
  const rand = mulberry32(seed);
  const sim = { t: 0, scenario, cfg, modes: Object.fromEntries(MODES.map((m) => [m, newMode(m, resolveCfg(m, cfg))])) };
  sim.step = () => {
    const t = sim.t;
    const world = scenario === 'drift' && t >= driftAt ? driftWorld : W2;
    const ns = Array.from({ length: TRAIN }, () => Math.floor(rand() * DOM));
    const y = ns.map((n) => { let v = world[n]; if (noise > 0 && rand() < noise) v ^= 1; return v; });
    for (const m of MODES) stepMode(sim.modes[m], t, world, ns, y);
    sim.t++;
  };
  return sim;
}

const API = { createSim, MODES, CFG, D, DOM, TRAIN, W2, W2B, W2C, mulberry32 };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.BudiEngine = API;
})(typeof self !== 'undefined' ? self : this);
