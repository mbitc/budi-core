# Hypotheses

This document records the hypotheses under test **before** any sweep is run.
It exists so that the results cannot be rationalised after the fact.

The document is pre-registered. Once a hypothesis is written here, it is not
edited on the basis of results. If a hypothesis is falsified, the falsification
is recorded in `FINDINGS.md` (or its successor) and the hypothesis is left in
this document, marked as falsified. If a new hypothesis is proposed, it is added
as a new entry, with a note explaining what prompted it.

The reason for this discipline is set out in `METHODOLOGY.md` §5. In brief:
the exploration run selects the contrast that looks best, and without
pre-registration the confirmation run can only confirm what the exploration
already showed. Pre-registration restricts the exploration's freedom to
propose, and thereby preserves the confirmation's ability to falsify.

---

## Primary metric

**Stationary:** mean `cur` accuracy over trials 250–299.

**Drift:** mean `cur` accuracy over trials 150–299. Drift occurs at `t = 150`,
so this range captures the post-drift regime including the recovery period.

The primary metric is fixed in advance. It is not chosen after seeing the
results. Extrapolation accuracy (`extrap`) is a **diagnostic**, not a primary
metric. In the stationary regime, `extrap` is at ceiling (~1.0) and therefore
uninformative for mode comparison. In the drift regime, `extrap` is
informative and is reported alongside `cur`, but it is not the basis of the
significance decision.

Secondary diagnostics: `pool`, `csize`, `grown`. These are used for confound
detection (see `METHODOLOGY.md` §7), not for hypothesis testing.

## Decision rule

A hypothesis is marked **✔ (confirmed)** if and only if:

1. The Bonferroni-corrected bootstrap confidence interval on the paired mean
   difference does not include zero, **and**
2. The absolute paired mean difference is at least `0.01`.

The `0.01` threshold is the practical effect-size floor described in
`METHODOLOGY.md` §4.4. A result that is statistically significant but has a
mean difference below `0.01` is reported as "significant, negligible effect"
and is not treated as a finding.

The Bonferroni correction is applied across **all contrasts reported in the
same run**. The correction factor is not adjusted post hoc.

## Exploration versus confirmation

Two seed sets are used:

- **`explore`** — seeds 1–40. **May propose** hypotheses. **May not confirm**
  them.
- **`confirm`** — seeds 101–200 (offset 100). **May confirm or falsify.**
  Cannot propose new hypotheses.

All hypotheses below were written before either set was run. The distinction
is important because the explore set has already been used in earlier
informal investigations, and its seed-to-seed noise may be correlated with
those investigations. Only the confirm set is treated as evidence.

---

## H0 — Sanity (must be exactly zero)

**Statement:** `flat` is insensitive to every parameter it does not use:
`ema`, `edgesM`, `lambda`, deduplication, and pruning.

**Prediction:** the contrast `flat: variant − baseline` is exactly `0.000`
for every variant that touches only graph or lifecycle mechanics.

**Interpretation:** a non-zero result here indicates a **coding error**, not
a finding. Possible causes: a parameter is being read in a code path it
should not reach, or the baseline itself is being modified by a side effect.

**Status:** this hypothesis is not a scientific claim. It is a correctness
check. It must pass before any other hypothesis is evaluated.

## H1 — EMA (does the graph advantage come from memory?)

**Statement:** if edge-tension memory is the mechanism behind the graph
advantage over lifecycle after drift, then varying `ema` should change the
size of that advantage.

**Prediction:** three possible outcomes, each with a distinct interpretation:

- **H1a:** `graph − lifecycle` at `ema = 0` has a confidence interval that
  includes zero, while the same contrast at `ema = 0.7` does not. Interpretation:
  memory is the mechanism.
- **H1b:** both `ema = 0` and `ema = 0.7` give a significant positive
  contrast of similar magnitude. Interpretation: the mechanism is the
  selection criterion (tension-based pair choice), not memory.
- **H1c:** both confidence intervals include zero. Interpretation: the
  earlier exploratory finding of `+0.027` does not replicate on fresh seeds.

**Why this matters:** H1b would mean that the graph advantage is orthogonal
to the memory mechanism that was originally proposed. H1c would mean there is
no robust effect at all. Both are informative.

## H2 — Lifecycle ablation (which component drives lifecycle − flat?)

**Statement:** the `lifecycle − flat` difference is driven by pruning, by the
complexity penalty, or by deduplication.

**Prediction:** disabling each component in isolation reveals which one is
load-bearing:

- **no-prune:** pool grows to roughly `flat`-size (`~10`). If lifecycle's
  advantage disappears, pruning is the active component.
- **no-penalty:** `csize` grows. If lifecycle's advantage disappears, the
  complexity penalty is the active component.
- **no-dedupe:** small effect (deduplication rarely fires on this world).

**Interpretation of "no component alone":** if disabling any single
component fails to remove the lifecycle advantage, the components are
**redundant** — they overlap in what they enforce. This would be a design
observation, not a hypothesis confirmation.

## H3 — Noise

**Statement:** the graph advantage over lifecycle after drift is positive at
`noise = 0.05` and `noise = 0.1`, and approximately zero at `noise = 0.2`.

**Prediction:** at `noise = 0.2`, the contrast `graph − lifecycle` has a
confidence interval that includes zero.

**Rationale:** the exploratory run at `noise = 0.05` gave `+0.040`. The
exploratory run at `noise = 0.2` gave `+0.003` (not significant). H3 is a
direct test of whether the moderate-noise regime shows a robust graph
advantage, or whether the `noise = 0.05` result was a small-sample fluke.

**If H3 fails at `noise = 0.05`:** the `+0.040` exploration result does not
replicate. The graph advantage may be specific to the `noise = 0` regime, and
the interpretation "graph is a noise filter" would be unsupported.

## H4 — Drift type

**Statement:** the graph advantage is not specific to the `W2B` permutation.

**Prediction:** at `driftType = W2C` (moduli reversed, e.g. `n % 2` at the
first threshold and `n % 5` at the last, rather than permuted within the
threshold structure), the contrast `graph − lifecycle` remains positive
and significant.

**Interpretation:** if the contrast disappears at `W2C`, the graph advantage
is a property of the specific permutation used in earlier experiments, not a
general property of drift. The former would be a serious limitation; the
latter would be a finding.

**Note on `W2D`:** `W2D` (introducing `n % 6` at the last threshold, a
modulus not present in the base pool) is **excluded from this study**. It
would change the base pool composition and therefore confound the comparison
with the baseline. `W2D` is left to a separate investigation.

## H5 — Pool size

**Statement:** `lifecycle` and `graph` are insensitive to `maxPool ≥ 10`,
because their effective pool size under those settings is `~5–6` and therefore
below the cap.

**Prediction:** `lifecycle − flat` and `graph − lifecycle` at `maxPool = 10`
and `maxPool = 20` have confidence intervals that overlap substantially.

**Known caveat (from exploration):** `maxPool = 5` interacts badly with
`minAge = 30`. Under that combination, non-flat modes cannot grow at all —
every attempted rule is pruned before it can be evaluated. This was observed
in the exploration run (`csize = 4`, `grown = 189` on lifecycle). `maxPool = 5`
is therefore **below the effective floor** and is excluded from H5's
comparison range. A validation check should be added to the engine before
any small-pool sweep is run (see `METHODOLOGY.md` §7.1).

**Flat is sensitive to `maxPool`** as expected — flat can fill any pool size,
and larger pools give it more coverage. H5 does not predict anything about
flat's behaviour at small `maxPool`; only that flat's pool-based result is
mechanically different from the non-flat modes.

## H6 — Edge count

**Statement:** for the graph mode, `edgesM = 2` is inferior to `edgesM = 4`,
and `edgesM = 8` is approximately equal to `edgesM = 4`.

**Prediction:** `edgesM = 2` gives a smaller `graph − lifecycle` contrast
than `edgesM = 4`. `edgesM = 8` gives a contrast within the confidence
interval of `edgesM = 4`.

**Interpretation:** if `edgesM = 8` outperforms `edgesM = 4`, the graph
advantage scales with the number of candidate pairs, which would support the
"larger search space" mechanism (see `METHODOLOGY.md` §6). If it plateaus at
`edgesM = 4`, the tension criterion is genuinely selecting the best pairs
and additional pairs add noise.

---

## Known limitations of this study

These are not caveats that invalidate the study. They are boundary conditions
that define what the study does and does not cover.

1. **One world family.** All experiments use `W2` and its permutations
   (`W2B`, `W2C`). `W2` is a three-threshold step function with four modular
   components (`n % 2`, `n % 3`, `n % 4`, `n % 5`). Results may not transfer
   to worlds with a different structure.

2. **Exact labels.** Training labels are noise-free except where explicit
   noise is added (`noise > 0`). The `noise = 0` regime is therefore a
   special case, not a typical one.

3. **`W2D` excluded.** The drift that introduces a new base modulus
   (`n % 6`) is excluded from this study, because it changes the base pool
   and therefore the baseline against which all contrasts are measured.
   Whether the graph advantage survives when the base pool must grow
   is an open question.

4. **Fixed pool cap.** All experiments use `maxPool ∈ {5, 10, 20}`, with
   `maxPool = 5` excluded from H5 for the confound described above. The
   behaviour of the system at `maxPool > 20` is not investigated.

5. **Fixed depth.** `maxDepth = 5`. Whether the graph advantage grows,
   plateaus, or reverses at greater composition depth is not tested here.

6. **Single primary metric.** The study evaluates modes on post-drift `cur`
   accuracy. A mode that wins on `cur` but loses on `extrap` is not
   distinguished from a mode that wins on both. The `extrap` diagnostic is
   reported but is not part of the significance decision.

---

## What this document is not

This document is **not** a prediction of results. It is a specification of
what would count as evidence for or against each hypothesis.

A hypothesis that is stated so vaguely that any result confirms it is not a
hypothesis. The hypotheses in this document are stated so that a specific
result can falsify each of them. That is the intended function.

If a hypothesis is falsified, that is a result. It is not a failure of the
study, and it is not an embarrassment to be edited away. It narrows the space
of plausible mechanisms, which is exactly what the study is for.

---

## Cross-references

- `METHODOLOGY.md` §5 — exploration versus confirmation
- `METHODOLOGY.md` §6 — mechanism versus effect, and why H1 cannot
  distinguish three candidate mechanisms without a random-pair control
- `METHODOLOGY.md` §7 — confound detection, including the `maxPool = 5`
  example referenced in H5
- `README.md` — project framing, empirical findings to date
