# Methodology

This document describes how experiments are designed, run, and interpreted
in budi-core. It is deliberately longer than the code it describes, because
the code is small enough to be read in an hour, and the discipline that
keeps the code honest is not.

The document is written for someone who wants to **falsify** a finding, not
for someone who wants to be convinced by one.

---

## 1. Purpose

The system under test is a compositional rule learner with three selection
strategies. It is small enough that its behaviour can, in principle, be
traced by hand. That property — inspectability — is the project's only
real claim. Everything else (the accuracy numbers, the graphs, the
drift recovery curves) is a consequence of it.

Inspectability imposes a corresponding obligation: **every empirical
claim must be traceable to a specific run, on a specific set of seeds,
with a specific configuration, and it must survive a fresh-seed
confirmation before it is treated as a finding.**

This document describes how that obligation is discharged.

## 2. Why a designed experiment, not a full factorial

A naive approach would be: enumerate all parameter combinations, run them
all, sort by accuracy, take the top. This fails for three reasons.

### 2.1 Combinatorial explosion

With `maxPool ∈ {5, 10, 20, 50}`, `lambda ∈ {0, 0.001, 0.002, 0.005, 0.01}`,
`noise ∈ {0, 0.05, 0.1, 0.2, 0.3}`, `scenario ∈ {stationary, drift}`,
`edgesM ∈ {2, 4, 8}`, `driftType ∈ {W2B, W2C, W2D}`, the full factorial is

```
4 × 5 × 5 × 2 × 3 × 3 = 1 800 configurations
```

At 40 seeds per configuration and 300 trials per seed, that is
approximately 36 hours of compute — and, more importantly, 1 800 rows of
output that no human can interpret.

### 2.2 Most cells are uninformative

Many combinations are structurally meaningless:

- `edgesM` has no effect on `flat` or `lifecycle` — they do not use it.
- `driftType` has no effect on `stationary` — there is no drift.
- `lambda = 0.01` combined with `maxPool = 5` produces a system that
  cannot grow at all (a known confound; see §7).

A full grid wastes most of its budget on cells where the answer is known
in advance from the structure of the algorithm.

### 2.3 Multiple comparisons

If you run 1 800 configurations and one comes out at `p < 0.05`, you have
not found an effect. You have found the expected number of false positives.
Fisher's original point — that a single significant result among many is
weak evidence — is more, not less, relevant when the search is automated.

The alternative is a **structured sequence** of experiments, where each
stage answers a specific question, with the number of comparisons
controlled in advance. That is the design adopted here.

## 3. The three-stage structure

The laboratory uses a three-stage DOE. Each stage has a declared purpose
and a declared scope. No stage is skipped.

### 3.1 Stage 1 — Main effects (screening)

**Question:** which parameters change behaviour at all?

**Design:** one parameter varied, all others at baseline. One noise level
(at baseline, `noise = 0`), one scenario. Typically 20–40 seeds.

**Output:** for each parameter, a table of `mean ± sd` across its values,
for each of the three modes, on each of the relevant metrics
(`cur`, `extrap`, `pool`, `csize`, `grown`).

**Interpretation:** if varying a parameter from its minimum to its maximum
changes the outcome by less than the seed-to-seed standard deviation, the
parameter is **inactive** — at least in this regime. Inactive parameters
can be fixed at baseline for the rest of the study.

**Rationale:** Stage 1 is cheap (typically 20–40 minutes) and eliminates
most of the search space. It also catches coding errors — if varying
`lambda` has no effect on `lifecycle`, either `lambda` is miswired or the
penalty logic never fires.

### 3.2 Stage 2 — Interactions

**Question:** does the effect of one parameter depend on another?

**Design:** two parameters varied jointly, with a small factorial
(typically 3 × 3). The parameters selected are those that Stage 1
identified as **active**. Baseline noise, one or two scenarios.

**Output:** the same format as Stage 1, plus a diagnostic panel showing
the pool composition at the end of each run (`pool`, `csize`, `extrap`,
`grown`). The diagnostic panel is essential — it is where confounds
become visible.

**Rationale:** interactions are where most "surprising" results live, and
also where most artefacts live. The `maxPool = 5` confound (see §7) was
only visible because Stage 2 included the diagnostic panel; a bare
accuracy comparison would have reported "lifecycle is much worse at
small pool" without explaining why.

### 3.3 Stage 3 — Confirmation on fresh seeds

**Question:** does the best configuration survive out-of-sample?

**Design:** the configuration that Stages 1–2 identified as best is rerun
on 100 seeds *not used in Stages 1–2* (typically offset 100 from the
original set).

**Output:** paired comparisons of the form `A − B` on the same seed, with
`wins / losses / n`, a Bonferroni-corrected `p`, and a confidence interval
on the mean difference.

**Rationale:** the single most important discipline in this project.
A result that does not survive fresh seeds is a null result. It is
documented as such; it is not quietly dropped. Stage 3 is what separates
a laboratory from a demo.

## 4. Statistical framework

### 4.1 Paired comparisons

All modes within a simulation share the same trial data (`ns` and `y`)
on every trial. This makes the comparison **paired**: for each seed,
mode A and mode B see exactly the same sequence of examples.

The consequence is that the relevant quantity is the difference
`A(seed) − B(seed)` for each seed, not the two means independently. The
paired difference has lower variance than the unpaired one, because it
removes the shared effect of the trial data.

In practice:

```js
// wrong (unpaired):
const meanA = mean(R.a), meanB = mean(R.b);
const diff = meanA - meanB;  // variance includes between-seed variation

// correct (paired):
const diff = mean(R.a.map((a, i) => a - R.b[i]));  // variance is within-seed only
```

All reported differences in this project are paired.

### 4.2 Wins and losses

Alongside the mean difference, every comparison reports:

- `wins` — number of seeds where `A(seed) − B(seed) > +threshold`
- `losses` — number of seeds where `A(seed) − B(seed) < −threshold`
- `n` — total seeds

The threshold is typically `0.002` (about 1/500 of the accuracy range).
This filters out diffs that are real but negligible.

Wins / losses is not a substitute for the mean difference — a mode can
have a positive mean difference driven by a handful of large wins. But
it is a useful sanity check: if the mean difference is positive but wins
and losses are roughly equal, the effect is being driven by outliers
and should be inspected.

### 4.3 Bonferroni correction

When a sweep makes `k` comparisons at a nominal `α`, the corrected
threshold is `α/k`.

For the `confirm-ema` run, `k = 21` (four EMA values × five contrasts
plus one), so the corrected `α = 0.05 / 21 ≈ 0.0024`.

The reason for the correction is not pedantry. A single test at `α = 0.05`
means a 5% chance of a false positive *per test*. Across 20 tests, the
probability of at least one false positive is roughly `1 − 0.95²⁰ ≈ 0.64`.
Without correction, the number of "findings" in a large sweep is
approximately the number of false positives the design permits.

### 4.4 Effect size over p-value

A `p`-value answers "could this have arisen by chance?". It does not
answer "is this large enough to matter?". For the purposes of this
project, the practical threshold for "matters" is:

- **Mean paired difference ≥ 0.01** on the relevant metric, and
- **Wins / losses ratio ≥ 2:1** across seeds, and
- **Survives Stage 3** (fresh seeds)

A result that satisfies all three is a finding. A result that satisfies
the first two but not the third is a hypothesis. A result that satisfies
only the first is a curiosity.

### 4.5 What "significant" does and does not mean here

"Significant" in this project means: **passes the Bonferroni-corrected
threshold and survives fresh seeds**. It does not mean "true". It does
not mean "generalises to all worlds". It does not mean "causally
explained".

The one thing it is allowed to mean is: **worth pursuing as a candidate
mechanism**. The mechanism itself is a separate question (see §6).

## 5. Exploration versus confirmation

Every finding in this project has (or should have) two runs:

- an **exploration** run — first observation of the effect, typically
  smaller (40 seeds), and
- a **confirmation** run — replication on fresh seeds, typically larger
  (100 seeds, offset so no seed overlaps).

The two runs are both logged. A finding is only promoted from
"interesting" to "confirmed" when the confirmation run reproduces the
direction and approximate size of the effect.

The reason for the split is that the exploration run selects, implicitly
or explicitly, the best-looking configuration. Without confirmation, that
selection inflates the apparent effect. Confirmation on fresh seeds
removes the inflation.

### 5.1 Example: the EMA effect that was not

The 40-seed exploration reported `graph: ema=0 − ema=0.7 = +0.008`
(not significant, but suggestive) and appeared to show that EMA=0 was
the strongest graph configuration. The tempting interpretation was:
"EMA hurts, because memory of past tension is a liability".

The 100-seed confirmation reported `graph: ema=0 − ema=0.7 = −0.0025`
(39 / 31, **not significant**), and `graph: ema=0.9 − ema=0.7 = +0.005`
(41 / 29, **not significant**). The apparent EMA effect was a
small-sample artefact.

What survived, on both runs, was the orthogonal contrast
`graph − lifecycle = +0.027` on the confirmation and `+0.030–0.035` on
the exploration. That contrast is real. The interpretation of it
("graph is doing X") is still open.

The methodological lesson: **do not interpret a mechanism from the
exploration run alone**. The exploration run proposes the contrast;
the confirmation run tests it.

## 6. Mechanism versus effect

A confirmed effect is not the same as an understood mechanism. The
laboratory is rigorous about the difference.

For the main confirmed effect (`graph − lifecycle ≈ +0.03` on drift),
there are at least three candidate mechanisms:

1. **Tension selection** — the pairs with the highest conflict are
   genuinely the most productive for composition.
2. **Search-space size** — `graph` evaluates all pairs in the pool
   (~45 for `maxPool = 10`), while `lifecycle` evaluates only the
   top-3 × 2 permutations (~6). The advantage may be the larger sample.
3. **Adaptation speed** — `graph` may converge to a new best procedure
   faster after drift, at the cost of extrapolation quality. The
   diagnostic panel (`graph` extrapolation accuracy 0.96 vs flat 0.99)
   is consistent with this.

The current experiments **cannot distinguish these**. They are
consistent with all three, and the mechanism question is therefore
**explicitly open**.

### 6.1 The random-pair control

The cleanest way to distinguish mechanism (1) from mechanism (2) is a
**random-pair control**:

- Same search space as `graph` (all pairs in the pool)
- Random pair selection, not tension-based
- Same pool, same lifecycle, same everything else

If `random − lifecycle ≈ graph − lifecycle`, the mechanism is search
space. If `random − lifecycle ≈ 0`, the mechanism is tension selection.
If it is intermediate, both contribute.

This control has not been implemented. It is the highest-priority
follow-up (§9).

### 6.2 Why this matters

An effect without a mechanism is not a result; it is a data point. It
may replicate on W2B, but there is no way to know whether it will
replicate on W2C, on a different world family, or on a different
domain entirely. The mechanism is what would generalise.

## 7. Confound detection

A confound is a variable that changes alongside the variable you are
studying, and which may be the actual cause of the effect. Confounds
invalidate comparisons, and they are notoriously easy to miss when
looking only at accuracy.

The laboratory checks for confounds using the **diagnostic panel**,
which every sweep emits alongside the main metric. The panel reports:

- `pool` — final pool size
- `csize` — mean size of grown procedures
- `extrap` — extrapolation accuracy
- `grown` — total number of procedures grown across the run

### 7.1 Worked example: the `maxPool = 5` confound

In the 40-seed exploration of `maxPool`, the accuracy numbers showed:

| mode | `maxPool=5` accuracy | `maxPool=10` accuracy |
|------|----------------------|-----------------------|
| flat | 1.000 | 0.984 |
| lifecycle | 0.875 | 1.000 |
| graph | 0.940 | 0.999 |

The naive reading: "at small pool, flat is much better than lifecycle
or graph". This would be a striking result.

The diagnostic panel showed:

| mode | pool | csize | grown |
|------|------|-------|-------|
| flat | 5 | 17.8 | 5.6 |
| lifecycle | 5 | **4.0** | **188.9** |
| graph | 5 | **4.0** | **182.9** |

`csize = 4` means the pool contains only the four **base** procedures
(`n%2`, `n%3`, `n%4`, `n%5`). Nothing was grown. `grown = 189` means
the lifecycle mode *attempted* to grow 189 times, and every attempt
was pruned immediately — the pool was full, and `minAge = 30` prevented
new procedures from surviving long enough to be evaluated.

The apparent "lifecycle is worse at small pool" result was not a
finding about lifecycle. It was a structural interaction between
`maxPool` and `minAge` that prevented non-flat modes from functioning
at all. The confound was only visible because the diagnostic panel
was emitted.

### 7.2 Guidelines for confound detection

Before interpreting a sweep result, check:

1. **Did the manipulated parameter actually vary the state it is
   supposed to vary?** If `maxPool=5` and `maxPool=20` produce the
   same `pool`, something is capping it.
2. **Is the mechanism active?** If `lambda=0.01` and `lambda=0`
   produce the same `csize`, the penalty is not firing.
3. **Is the comparison fair?** If mode A has `pool = 10` and mode B
   has `pool = 4`, the comparison is not of the modes; it is of two
   structurally different systems.
4. **Are the diagnostics consistent with the story?** If the story is
   "graph adapts faster", we should see `graph` reach high accuracy
   sooner — not just higher at the end.

## 8. Common failure modes

The following have all occurred in this project, and the design of
the methodology is partly a response to them.

### 8.1 Reading the mean without reading the wins

A mean difference of `+0.02` can mean (a) uniform small improvement
across seeds, or (b) 10 seeds with big wins and 30 seeds with small
losses. The interpretation is very different. Always read both.

### 8.2 Trusting a single seed's trajectory

A single seed can show a beautiful recovery curve after drift. That is
an anecdote. The `confirm` stage requires 100 seeds for exactly this
reason.

### 8.3 Interpreting a small-sample result as a mechanism

The `ema=0` story (§5.1) is the canonical example. A suggestive pattern
in a 40-seed run, interpreted as a mechanism, dissolved on 100 fresh
seeds. The rule: **mechanism requires replication, not just a plausible
story**.

### 8.4 Overlooking an inactive parameter

If varying `edgesM` from 2 to 8 changes nothing, either `edgesM` is
genuinely inactive in this regime, or it is miswired. The exploration
should include a "null check" — a run where the parameter is set to
a pathological value (e.g. `edgesM = 0`) and the effect is verified to
be extreme. If `edgesM = 0` gives the same result as `edgesM = 4`,
`edgesM` is not doing what the code claims.

### 8.5 Post-hoc rationalisation

After seeing that `graph` wins, it is tempting to invent a story that
explains why. The story should predict **something else** that can be
checked: e.g. "if graph wins by tension selection, then a random-pair
control should not win". If the story does not generate a testable
prediction, it is not a hypothesis; it is a description.

### 8.6 Bonferroni by halves

Bonferroni is conservative. Some practitioners apply it only to the
"primary" comparisons, or only when the result is "borderline". This
is a way of laundering false positives. The rule here: **Bonferroni
applies to every contrast reported in the same run**.

### 8.7 Deleting negative results

The `no-prune` ablation showed that pruning is *harmful* for graph in
drift: `graph: no-prune − full = +0.018` (25/11, not significant).
This result is in the record. It contradicts the design's claim that
lifecycle (which includes pruning) is helpful. It is a null result
with a direction, and it belongs in the record as such.

## 9. Design checklist for a new experiment

Before running an experiment, answer all seven:

1. **What is the hypothesis?** One sentence, framed so that it can be
   false. "X improves Y" is a hypothesis. "X does something" is not.

2. **What is the contrast?** Which two configurations will be compared?
   Paired comparisons require that all other parameters are held fixed.

3. **What is the expected effect size?** Even a rough number. If you
   have no expectation, the experiment is exploratory and should be
   designed accordingly (see §5).

4. **What is the null?** What result would falsify the hypothesis?
   An experiment with no possible negative outcome is not an
   experiment.

5. **What is the confound risk?** Which other variable could
   plausibly change alongside the manipulated one? How will the
   diagnostic panel detect it?

6. **What is the sample size?** 40 seeds for exploration, 100 for
   confirmation. If the effect size is expected to be small
   (< 0.01), the sample size must be larger; if large (> 0.05),
   40 is adequate.

7. **What will be done with a null result?** If the answer is
   "ignore it", do not run the experiment. A null result that
   would not be documented is not being tested; it is being
   performed.

## 10. Documentation standards

Every run produces a JSON artefact with the following minimum fields:

- `tag` — a short identifier (`explore`, `confirm-ema`, etc.)
- `seeds`, `offset` — sample size and starting seed
- `alpha` — the corrected significance threshold used
- `results` — one entry per contrast, with `mean`, `lo`, `hi`,
  `wins`, `losses`, `n`, `sig`
- `checks` — a `maxAbs` value for each variant indicating whether
  the base code was modified between the reference run and the
  current one. `maxAbs = 0` means identical.
- `diags` — the diagnostic panel for each variant

Artefacts are not deleted. A run that produces a null result is
kept as faithfully as one that produces a positive result. The
record of what was tested, and what was not found, is as important
as the record of what was found.

## 11. Appendix — worked example

The `confirm-ema` run illustrates the full pipeline.

### Step 1 — hypothesis

> "If edge tension memory is the mechanism by which `graph`
> outperforms `lifecycle` after drift, then varying `ema` should
> change the size of the graph advantage."

### Step 2 — contrast

Five contrasts per EMA value:

- `graph − lifecycle` — the primary finding under test
- `graph − flat` — a secondary check
- `lifecycle − flat` — an internal consistency check (should not
  vary with `ema`, since neither uses it)
- `graph: ema=value − ema=0.7` — direct test of the memory
  hypothesis
- `flat: ema=value − ema=0.7` and `lifecycle: ...` — null checks
  (should be exactly zero, since `flat` and `lifecycle` do not
  use `ema`)

The `flat` and `lifecycle` null checks returned `mean = 0` for
all variants. This confirms the code is correct: `ema` is only
read in the graph path.

### Step 3 — expected effect size

The exploration run suggested `ema=0` might be ~0.008 better than
`ema=0.7`, and that `graph − lifecycle` was ~+0.03. The prediction:
if the memory hypothesis is correct, `ema` should have a
measurable effect on `graph − lifecycle`; if not, all EMA values
should give approximately the same difference.

### Step 4 — null

If `ema` has no effect on `graph − lifecycle`, the memory
hypothesis is false.

### Step 5 — confound risk

`ema` is only read in `graph`. The `flat` and `lifecycle` null
checks were included to verify this. A confound would show as
a non-zero `flat: ema − ema=0.7` result.

### Step 6 — sample size

100 seeds, offset 100. Chosen because the exploration's effect
estimate (~0.008) was small, and 100 seeds gives a standard
error of approximately `sd / sqrt(100) ≈ 0.01`, enough to
distinguish a real 0.02 effect from zero.

### Step 7 — outcome

The primary contrast `graph − lifecycle` was significant at all
four EMA values, with mean around +0.03. The memory contrast
`graph: ema − ema=0.7` was **not significant at any value**.
The null checks for `flat` and `lifecycle` returned exactly zero.

Conclusion: **the memory hypothesis is falsified**. Graph's
advantage is not attributable to edge memory. The mechanism is
elsewhere (see §6).

The result was documented even though it is negative, because
the negative result is informative: it eliminates one candidate
mechanism, which narrows the search space for the next
experiment.

---

## A closing note

The methodology described here is not a straitjacket. It is a
default discipline that can be relaxed when there is a reason.
The reason must be documented.

What is not permitted, under any circumstance, is:

- Reporting a result that has not been paired
- Claiming significance without correction
- Interpreting an exploration result as a mechanism
- Dropping a negative result from the record
- Running an experiment whose possible outcomes include only
  "confirms the hypothesis"

The value of a laboratory is not in the findings it produces. It
is in the findings it is willing to lose.
