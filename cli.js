// cli.js — node cli.js [seeds=40] [noise=0]
const { createSim, MODES, CFG } = require('./engine');
const N = +process.argv[2] || 40, NOISE = +process.argv[3] || 0;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const win = (a, lo, hi) => mean(a.slice(lo, hi));
const f3 = (x) => x.toFixed(3);
console.log(`seeds=${N} noise=${NOISE} trials=${CFG.trials} maxPool=${CFG.maxPool}`);

for (const scenario of ['stationary', 'drift']) {
  const R = Object.fromEntries(MODES.map((m) => [m, []]));
  for (let seed = 1; seed <= N; seed++) {
    const sim = createSim({ scenario, seed, noise: NOISE });
    for (let t = 0; t < CFG.trials; t++) sim.step();
    for (const m of MODES) R[m].push(sim.modes[m].metrics);
  }
  const drift = scenario === 'drift';
  const cols = drift
    ? [['pre 100-149', (l) => win(l.cur, 100, 150)], ['post early', (l) => win(l.cur, 150, 180)], ['post late', (l) => win(l.cur, 270, 300)]]
    : [['early 0-49', (l) => win(l.cur, 0, 50)], ['late 250-299', (l) => win(l.cur, 250, 300)]];
  cols.push(['extrap', (l) => win(l.extrap, 270, 300)], ['pool', (l) => win(l.pool, 250, 300)],
            ['rule size', (l) => win(l.csize, 250, 300)], ['grown', (l) => l.acc.reduce((a, b) => a + b, 0)]);
  console.log(`\n== ${scenario.toUpperCase()} ==\n${'mode'.padEnd(11)}${cols.map(([n]) => n.padStart(17)).join('')}`);
  for (const m of MODES) console.log(m.padEnd(11) + cols.map(([, fn]) => { const v = R[m].map(fn); return `${f3(mean(v))}±${f3(sd(v))}`.padStart(17); }).join(''));
  const key = drift ? (l) => win(l.cur, 150, 300) : (l) => win(l.cur, 0, 300);
  const cmp = (a, b) => { const d = R[a].map((l, i) => key(l) - key(R[b][i]));
    console.log(`${a} − ${b}: ${f3(mean(d))}  pergalių ${d.filter((x) => x > 0.0005).length}/${N}, pralaimėjimų ${d.filter((x) => x < -0.0005).length}/${N}`); };
  cmp('lifecycle', 'flat'); cmp('graph', 'flat'); cmp('graph', 'lifecycle');
}
