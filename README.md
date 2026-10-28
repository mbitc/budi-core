# budi-core

A research laboratory for **conflict crystallization** — a minimal compositional
rule-learning system, written in dependency-free JavaScript, that studies how
expert procedures can grow by resolving disagreement rather than by maximising
accuracy.

This is not a product. It is not a model. It is a **laboratory**: three
selection strategies, one shared engine, one visual viewer, one CLI, and a
growing record of what has been tested and what has not.

---

## What this is

The premise is deliberately narrow. A concept without a job is an empty label.
The question this project asks is operational:

> When two stable procedures disagree on the same input, does the
> disagreement itself carry information that can be used to compose a
> better procedure?

That is the whole research programme. Everything else — the grid viewer,
the CLI, the sweeps — serves to answer this question with numbers rather
than with intuition.

## What this is not

- Not a language model
- Not a Mixture-of-Experts implementation
- Not a P2P network
- Not a demonstration of artificial general intelligence

If any of those things appear in earlier notes or discussions, they are
aspirational framings, not claims about the code in this repository. The
code here is deliberately small enough that its behaviour can be measured.

---

## Core idea

Given:

- a **world** `w : N → {0, 1}` (a hidden boolean function over some domain)
- a **pool** of **procedures** `p : N → {0, 1}`
- a small, fixed set of **base procedures** (`n % k == 0`, `n < t`)
- a **composition operator** `if s then p₁ else p₂`, where `s` is itself a
  procedure used as a splitter

the laboratory compares three ways of choosing which pair `(p₁, p₂)` to
compose next:

| Mode | Pair selection | Lifecycle |
|------|----------------|-----------|
| `flat` | top-3 by training accuracy | prune by accuracy when pool full |
| `lifecycle` | top-3 by training accuracy | prune by use × accuracy; penalise size; require `use` above `deadUse` |
| `graph` | top-`edgesM` pairs by **conflict tension** | same as `lifecycle` |

The `graph` mode maintains a persistent edge map `(pᵢ, pⱼ) → tension`, where
tension combines the size of the conflict node and how poorly any existing
procedure resolves it. Pairs with high tension are preferred for composition.

The hypothesis under test: **conflict-based selection composes better
procedures than accuracy-based selection**, particularly under drift (when
the world changes at some trial `t`).

---

## Empirical findings

These numbers come from the `confirm-ema` run (100 fresh seeds, offset 100,
drift at `t=150`, W2B, noise=0) unless otherwise stated. Alpha is Bonferroni-
corrected to `0.0024`.

### Finding 1 — Graph outperforms lifecycle on post-drift accuracy

| EMA | graph − lifecycle | Wins / Losses | Significant |
|-----|-------------------|---------------|-------------|
| 0 | +0.027 | 74 / 19 | ✔ |
| 0.3 | +0.025 | 72 / 20 | ✔ |
| 0.7 | +0.030 | 71 / 19 | ✔ |
| 0.9 | +0.035 | 73 / 18 | ✔ |

This survives fresh seeds. The effect size is approximately **+0.03 accuracy**,
or roughly three percentage points of post-drift prediction accuracy.

### Finding 2 — Edge memory (EMA) has no effect

`graph: ema=0 − ema=0.7` = −0.0025 (39/31, **not significant**).
`graph: ema=0.9 − ema=0.7` = +0.0048 (41/29, **not significant**).

The advantage of `graph` over `lifecycle` is therefore **orthogonal to the
memory mechanism**. It is not the persistence of edge tension that helps.
Whatever is helping is in the *selection criterion itself* or in the size
of the search space (graph evaluates all pairs, lifecycle only the top-3).

**This distinction is unresolved.** See *Open questions*.

### Finding 3 — Lifecycle is not reliably better than flat

In the 40-seed exploration, `lifecycle − flat` in stationary was +0.019
(27/40). In the 100-seed confirmation, `lifecycle − flat` in drift was
+0.002 (47/47, **not significant**). The earlier result appears to have
been a smaller-sample effect.

Lifecycle reduces pool size (5.9 vs 10.0) and rule size (15.9 vs 30.2) but
does not reliably improve accuracy.

### Finding 4 — Flat wins on extrapolation

On the held-out extrapolation domain (n ∈ [100, 299]), the ordering reverses:

| | pool | rule size | extrap accuracy |
|--|------|-----------|-----------------|
| flat | 10.0 | 30.2 | **0.993** |
| lifecycle | 5.9 | 15.9 | 0.989 |
| graph | 5.7 | 12.2 | 0.964–0.981 |

Graph's post-drift accuracy advantage is **specific to the training domain
and its immediate neighbourhood**. It does not generalise better. If
anything, graph over-fits to the post-drift regime more quickly, which
costs it on data it has never seen.

This is consistent with a **speed-versus-stability trade-off**: graph adapts
faster, at the cost of broader generalisation.

### Finding 5 — Noise reverses the ordering

In the exploration, at `noise = 0.2` in the drift scenario:

| | csize | extrap |
|--|-------|--------|
| flat | **173.2** | **0.988** |
| lifecycle | 13.9 | 0.957 |
| graph | 9.6 | 0.882 |

At high noise, flat's rules become lookup tables (csize grows to ~170)
and the coverage-ensemble strategy wins on extrapolation. Neither
lifecycle nor graph recovers.

There appears to be a **noise threshold** beyond which coverage dominates
compression and conflict-resolution. We have not located this threshold
precisely. It lies somewhere between `noise = 0.1` and `noise = 0.2` for
the W2B world.

---

## File layout

```
budi-core/
├── engine.js       # the simulation engine (Node + browser)
├── cli.js          # command-line experiment runner
├── index.html      # interactive visual viewer (loads engine.js)
├── sweep.js        # parameter sweep harness (optional)
└── README.md       # this file
```

`engine.js` is the **single source of truth** for the algorithm. The CLI and
the viewer both import it. This means that any change to the algorithm is
immediately reflected in both the measurements and the visualisation,
which prevents the two from drifting apart.

## Running it

### Requirements

- Node.js (any recent version; tested on Node 18 and 20)
- A web browser with canvas support (for the viewer)

There are no dependencies. No package installation is required.

### CLI — run the experiment

```bash
node cli.js [seeds=40] [noise=0]
```

The CLI runs 300 trials × 3 modes × 2 scenarios × `seeds` fresh seeds, prints
paired comparisons with `mean ± sd`, and reports wins/losses against a
bonferroni-style threshold.

Example:

```bash
node cli.js 40 0       # clean run, 40 seeds
node cli.js 100 0      # confirmation run, 100 seeds
node cli.js 40 0.1     # noise robustness check
```

Expected runtime: ~30 s for `seeds=40`, ~75 s for `seeds=100`.

### Viewer — watch it in real time

Open `index.html` in a browser. The viewer runs the same engine, shows:

- a **grid** of the world (25 × 12 cells), coloured by truth and overlaid
  with mismatch borders where the current best procedure is wrong;
- a **conflict ring** on any cell belonging to the active mode's current
  conflict node;
- a **chart** of accuracy (solid) and extrapolation accuracy (dashed) over
  trials for all three modes;
- a **pool panel** showing the current procedures in the active mode, with
  their `use` counters.

The viewer is not the experiment. The CLI is. The viewer exists so you can
develop an intuition for *why* the numbers look the way they do.

### Sweeps — parameter studies

`sweep.js` (when present) drives the engine through pre-declared
parameter sweeps. Each stage answers one question:

- **Stage 1** — single-axis sweeps: which parameters change behaviour at all?
- **Stage 2** — interaction sweeps: does the effect of one parameter
  depend on another?
- **Stage 3** — confirmation on fresh seeds: does the best configuration
  survive out-of-sample?

The methodology is deliberately conservative. Every sweep reports
`mean ± sd`, `wins / losses`, and a bonferroni-corrected `sig` flag.
A result that does not survive fresh seeds is treated as a null result.

---

## Engine API

```javascript
const { createSim, MODES, CFG, W2, W2B, D, DOM, TRAIN } = require('./engine');

const sim = createSim({
  scenario: 'stationary' | 'drift',
  seed: 42,
  noise: 0,
  // optional:
  cfgOverride: { maxPool: 10, lambda: 0.002, ... },
  driftType: 'W2B' | 'W2C',
});

for (let t = 0; t < CFG.trials; t++) sim.step();

// after the loop:
for (const mode of MODES) {
  const m = sim.modes[mode];
  m.metrics.cur;      // accuracy on train domain, per trial
  m.metrics.extrap;   // accuracy on extrapolation domain, per trial
  m.metrics.pool;     // pool size, per trial
  m.metrics.csize;    // mean size of grown procedures, per trial
  m.metrics.acc;      // 1 if grown this trial, else 0
  m.grown;            // total procedures grown
  m.conflictNodes;    // set of n in the last conflict node
  m.bestP;            // the current best procedure object
}
```

Each procedure has:

```javascript
{
  id, name, out: Uint8Array(300), key: string,
  depth, size, parents: [id], born, use, base
}
```

`out[n]` is the procedure's prediction for input `n`, precomputed.

All three modes in a single simulation share the same `ns` and `y` on every
trial. This is what makes paired comparison (the same seed compared across
modes) legitimate.

---

## Configuration

`CFG` in `engine.js`:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `trials` | 300 | Total trials per seed |
| `driftAt` | 150 | Trial at which the world changes (drift scenario) |
| `minNode` | 20 | Minimum conflict-node size for a pair to be a candidate |
| `minGain` | 0.02 | Minimum improvement for a new procedure to be accepted |
| `lambda` | 0.002 | Complexity penalty per unit `size` (non-flat modes) |
| `maxPool` | 10 | Maximum pool size |
| `maxDepth` | 5 | Maximum composition depth |
| `topStable` | 3 | Top-K by training accuracy (non-graph modes) |
| `edgesM` | 4 | Top-M by tension (graph mode) |
| `ema` | 0.7 | Edge-tension smoothing (graph mode) |
| `decay` | 0.93 | `use` decay per trial (lifecycle modes) |
| `deadUse` | 0.02 | `use` threshold below which a non-base rule is pruned |
| `minAge` | 30 | Minimum age before pruning can occur |

**Known caveat:** `maxPool < 8` interacts badly with `minAge` and can trap
non-flat modes in a state where they cannot grow (all new rules are pruned
immediately). `maxPool=5` is below the effective floor for this reason.
A validation check is advisable before running `maxPool` sweeps.

---

## Design principles

These are non-negotiable. Any change that violates them is not a change to
budi-core; it is a different project.

1. **No dependencies in the engine.** `engine.js` must run in Node without
   `npm install` and in a browser without a bundler.

2. **Deterministic.** Given a seed and a scenario, the simulation must
   produce exactly the same result. `Math.random()` is forbidden; all
   randomness goes through `mulberry32`.

3. **Inspectable.** Every procedure carries a `name` (a human-readable
   string) and an `out` array (the machine-readable predictions). The
   two must be derivable from each other. A name is a handle; the
   procedure is the content.

4. **No LLM in the loop.** The engine has no model, no embedding, no
   neural network. Every decision is a comparison of integers. If you
   cannot compute an answer with pen and paper, the engine is doing
   something it should not.

5. **The viewer serves the CLI.** Visualisation exists to build intuition.
   Numbers exist to test hypotheses. When they conflict, the numbers win.

6. **Negative results are results.** A sweep that fails to replicate is
   documented, not quietly dropped. The laboratory's reputation depends
   on this.

---

## What is confirmed

- **Conflict-based pair selection composes better procedures than
  accuracy-based selection under drift.** Effect size ~+0.03 post-drift
  accuracy, robust across 4 EMA values and 100 fresh seeds.
- **The mechanism is not edge memory.** Disabling EMA entirely (`ema=0`)
  does not reduce the advantage.
- **Graph over-fits to the post-drift domain.** Its extrapolation
  accuracy is the lowest of the three modes.
- **Flat wins at high noise.** At `noise=0.2`, flat's extrapolation
  accuracy (0.988) dominates lifecycle (0.957) and graph (0.882).

## What is unresolved

- **Why does graph win post-drift?** There are at least three plausible
  mechanisms (tension selection, larger search space, faster adaptation),
  and the current experiments cannot distinguish them.
- **Is the "tension" criterion actually doing anything?** A `random` mode —
  same search space as graph, but selecting pairs randomly instead of by
  tension — would answer this. It has not been implemented yet.
- **Where exactly is the noise threshold?** It lies between `0.1` and `0.2`,
  but its precise location and shape have not been measured.
- **Does `lifecycle` have any reliable advantage over `flat`?** The
  earlier +0.019 result did not replicate at 100 seeds.
- **Would a composite strategy (graph for pairing + lifecycle for
  pruning + flat for coverage) outperform all three individually?**
  This is a natural next question but requires a fourth mode.

---

## Open questions

The following are the questions this laboratory is currently designed to
answer, in priority order:

1. **Mechanism.** What is the actual causal story behind the graph
   advantage? The `random` pair control is the essential next step.

2. **Regime.** At what noise level does each strategy become optimal? A
   finer-grained noise sweep is needed.

3. **Drift type.** The current drift (`W2 → W2B`) is a permutation of the
   same base components. A drift that changes the components themselves
   (`W2 → W2C`, e.g. `n%6` appears where `n%2` was) would test whether
   the graph advantage generalises to a harder regime.

4. **Transfer.** Does the ordering of strategies (flat / lifecycle / graph)
   hold across different world families, or is W2 special in some way?

5. **Composition depth.** All current experiments cap `maxDepth` at 5.
   Does the graph advantage grow, shrink, or reverse at greater depth?

---

## Related work

The laboratory is not the first to ask these questions, but it combines
several threads in an unusual way:

- **Formal Concept Analysis** (Ganter & Wille) — concepts as closed sets of
  attributes, grown mechanically. Budi-core's conflict-node is a dynamic
  analogue of an FCA concept.
- **Bongard problems** and other program-induction benchmarks — the
  original motivation for learning by composition rather than by fitting.
- **Genetic programming** — the composition operator and lifecycle
  mechanism are close in spirit to tree crossover and fitness sharing.
- **Delta debugging** — the idea that disagreement between two correct
  behaviours localises the source of the difference.
- **Theory revision** (De Raedt, Ade & Malfait) — the problem of integrating
  a new example into an existing theory without starting over.

None of these are dependencies. They are lineages. The specific combination
— conflict-tension selection, minimal composition, drift as a benchmark —
does not, as far as we are aware, exist elsewhere in this exact form.

---

## Contributing

If you are reading this and want to contribute, the most valuable thing
you can do is **try to falsify a finding**. Build a `random` mode. Run a
different world family. Push the noise sweep further. Prove that the
graph advantage is an artefact, if it is one.

Do not add dependencies. Do not add machine learning. Do not add a neural
network. The laboratory's value is that it is small enough to be checked
by hand.

---

## Licence

Unlicensed. Copy, modify, distribute freely.

---

## A note on framing

At earlier stages of this project, the language drifted towards grander
claims — P2P networks of autonomous agents, self-growing ontologies,
intellect as protocol. Those are valid research directions in their own
right. They are not what this code does.

What this code does is narrower and, we believe, more interesting for
being narrower: it isolates one mechanism — conflict-based composition
selection — and measures it. Everything else is aspiration.

If the mechanism turns out not to work, the laboratory has done its job.
