// sweep.js — node sweep.js list | explore [seeds=40] | confirm <exp> [seeds=100]
'use strict';
const fs = require('fs');
const E = require('./engine');
const { MODES, CFG } = E;

// variants: [label, cfg-perrašymas]; base – su kuo lyginami kiti variantai (ta pati ašis).
// Ašys: scen (scenarijai), noise, drift (dreifo tipas). flatInvariant: flat TURI nesikeisti.
const EXPERIMENTS = {
  ema:       { scen: ['drift'], base: 'ema=0.7', flatInvariant: true,
               variants: [['ema=0', { ema: 0 }], ['ema=0.3', { ema: 0.3 }], ['ema=0.7', {}], ['ema=0.9', { ema: 0.9 }]] },
  ablation:  { scen: ['stationary', 'drift'], base: 'full', flatInvariant: true,
               variants: [['full', {}], ['no-dedupe', { dedupe: 'name' }], ['no-penalty', { lambda: 0 }], ['no-prune', { prune: false }]] },
  noise:     { scen: ['stationary', 'drift'], noise: [0, 0.05, 0.1, 0.2], variants: [['default', {}]] },
  driftType: { scen: ['drift'], drift: ['W2B', 'W2C'], variants: [['default', {}]] },
  pool:      { scen: ['stationary', 'drift'], base: 'maxPool=10', flatInvariant: false,
               variants: [['maxPool=5', { maxPool: 5 }], ['maxPool=10', {}], ['maxPool=20', { maxPool: 20 }]] },
  edges:     { scen: ['drift'], base: 'edgesM=4', flatInvariant: true,
               variants: [['edgesM=2', { edgesM: 2 }], ['edgesM=4', {}], ['edgesM=8', { edgesM: 8 }]] },
};

const MIN_EFFECT = 0.01, ALPHA = 0.05, TIE = 0.0005, BOOT = 20000;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sumOf = (a) => a.reduce((s, x) => s + x, 0);

function measure(sim, scenario) {
  const out = {};
  for (const m of MODES) {
    const M = sim.modes[m].metrics;
    out[m] = { primary: mean(scenario === 'drift' ? M.cur.slice(150) : M.cur.slice(250)),
               extrap: mean(M.extrap.slice(-50)), pool: mean(M.pool.slice(-50)),
               csize: mean(M.csize.slice(-50)), grown: sumOf(M.acc) };
  }
  return out;
}

function runCell(cfg, scenario, noise, driftType, seeds, offset) {
  const rows = [];
  for (let s = 1 + offset; s <= seeds + offset; s++) {
    const sim = E.createSim({ scenario, seed: s, noise, cfg, driftType });
    for (let t = 0; t < CFG.trials; t++) sim.step();
    rows.push(measure(sim, scenario));
  }
  return rows;
}

function bootCI(d, alpha, rand) {
  const n = d.length, ms = new Float64Array(BOOT);
  for (let b = 0; b < BOOT; b++) { let s = 0; for (let i = 0; i < n; i++) s += d[Math.floor(rand() * n)]; ms[b] = s / n; }
  ms.sort();
  return [ms[Math.floor(BOOT * alpha / 2)], ms[Math.min(BOOT - 1, Math.floor(BOOT * (1 - alpha / 2)))]];
}

function collect(name, seeds, offset) {
  const exp = EXPERIMENTS[name];
  const rows = [], checks = [];
  for (const scenario of exp.scen) for (const noise of exp.noise || [0]) for (const drift of exp.drift || ['W2B']) {
    const cell = { scenario, noise, drift };
    const data = {};
    for (const [label, cfg] of exp.variants) { process.stderr.write('.'); data[label] = runCell(cfg, scenario, noise, drift, seeds, offset); }
    const col = (label, m) => data[label].map((r) => r[m].primary);
    for (const [label] of exp.variants) {
      for (const [a, b] of [['graph', 'lifecycle'], ['lifecycle', 'flat'], ['graph', 'flat']])
        rows.push({ exp: name, ...cell, variant: label, contrast: `${a} − ${b}`,
                    d: col(label, a).map((v, i) => v - col(label, b)[i]) });
      if (exp.base && label !== exp.base) for (const m of MODES) {
        const d = col(label, m).map((v, i) => v - col(exp.base, m)[i]);
        rows.push({ exp: name, ...cell, variant: label, contrast: `${m}: ${label} − ${exp.base}`, d, kind: 'variant', mode: m });
        if (m === 'flat' && exp.flatInvariant) checks.push({ ...cell, variant: label, maxAbs: Math.max(...d.map(Math.abs)) });
      }
    }
    cell.diag = Object.fromEntries(exp.variants.map(([label]) => [label, Object.fromEntries(MODES.map((m) => [m, {
      pool: mean(data[label].map((r) => r[m].pool)), csize: mean(data[label].map((r) => r[m].csize)),
      extrap: mean(data[label].map((r) => r[m].extrap)), grown: mean(data[label].map((r) => r[m].grown)) }]))]));
    rows.diag = (rows.diag || []).concat([{ ...cell }]);
  }
  return { rows, checks, diag: rows.diag };
}

function report(names, seeds, offset, tag) {
  const all = [], checks = [], diags = [];
  for (const n of names) { const r = collect(n, seeds, offset); all.push(...r.rows); checks.push(...r.checks.map((c) => ({ exp: n, ...c }))); diags.push(...r.diag.map((d) => ({ exp: n, ...d }))); }
  process.stderr.write('\n');
  const m = all.length, alpha = ALPHA / m, rand = E.mulberry32(12345);
  console.log(`\n${tag}  seeds=${seeds} (offset ${offset})  kontrastų=${m}  Bonferroni α=${alpha.toExponential(1)}  |efektas|≥${MIN_EFFECT}`);

  const out = [];
  let lastKey = '';
  for (const r of all) {
    const mu = mean(r.d), [lo, hi] = bootCI(r.d, alpha, rand);
    const wins = r.d.filter((x) => x > TIE).length, losses = r.d.filter((x) => x < -TIE).length;
    const sig = (lo > 0 || hi < 0) && Math.abs(mu) >= MIN_EFFECT;
    out.push({ exp: r.exp, scenario: r.scenario, noise: r.noise, drift: r.drift, variant: r.variant, contrast: r.contrast, mean: mu, lo, hi, wins, losses, n: r.d.length, sig });
    const key = `${r.exp} | ${r.scenario} noise=${r.noise} drift=${r.drift}` + (r.kind ? '' : ` | ${r.variant}`);
    if (key !== lastKey) { console.log(`\n── ${key}`); lastKey = key; }
    console.log(`  ${sig ? '✔' : '·'} ${r.contrast.padEnd(34)} ${(mu >= 0 ? '+' : '') + mu.toFixed(4)}  [${lo.toFixed(4)}, ${hi.toFixed(4)}]  ${wins}/${losses}/${r.d.length - wins - losses} (W/L/T)`);
  }

  console.log('\n── H0 sanity: flat vs. parametrai, kuriuos jis ignoruoja (turi būti 0)');
  if (!checks.length) console.log('  (šiame eksperimente netaikoma)');
  for (const c of checks) console.log(`  ${c.maxAbs === 0 ? '✔' : '✘ KLAIDA'} ${c.exp} ${c.scenario} ${c.variant}: max|Δ|=${c.maxAbs}`);

  console.log('\n── Diagnostika (vidurkiai, paskutiniai 50 trial\'ų): pool / rule size / extrap / grown');
  for (const d of diags) for (const [v, per] of Object.entries(d.diag))
    console.log(`  ${d.exp} ${d.scenario} n=${d.noise} ${d.drift} ${v.padEnd(11)} ` + MODES.map((mm) => `${mm}: ${per[mm].pool.toFixed(1)}/${per[mm].csize.toFixed(1)}/${per[mm].extrap.toFixed(3)}/${per[mm].grown.toFixed(1)}`).join('  '));

  fs.mkdirSync('results', { recursive: true });
  const file = `results/${tag}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify({ tag, seeds, offset, alpha, results: out, checks, diags }, null, 1));
  console.log(`\n✓ išsaugota → ${file}`);
}

const [cmd = 'list', arg, arg2] = process.argv.slice(2);
if (cmd === 'list') console.log(Object.keys(EXPERIMENTS).join('\n'));
else if (cmd === 'explore') report(Object.keys(EXPERIMENTS), +arg || 40, 0, 'explore');
else if (cmd === 'confirm') {
  if (!EXPERIMENTS[arg]) { console.error('nežinomas eksperimentas; node sweep.js list'); process.exit(1); }
  report([arg], +arg2 || 100, 100, `confirm-${arg}`);
} else { console.error('node sweep.js list | explore [seeds] | confirm <exp> [seeds]'); process.exit(1); }
