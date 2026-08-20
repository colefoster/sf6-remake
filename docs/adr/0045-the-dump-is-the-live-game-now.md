# ADR 0045 — The dump is the live game now

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0002](./0002-data-sourcing.md),
  [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md),
  [ADR-0043](./0043-version-skew-is-worth-half-a-point.md)

## Context

The pipeline has read `alphazolam/MMDK`'s committed dumps since ADR-0004. That
repo's last commit is **2024-12-06** — v1.0.8, *"Support for Terry"* — so the
geometry has been a Dec-2024 reading of the game graded against current frame
data, and `docs/agents/refresh-the-dump.md` has named that as the confound behind
every percentage in the project.

[ADR-0043](./0043-version-skew-is-worth-half-a-point.md) measured it: **+0.5
points**, with six sevenths of every residual surviving a live dump. That made
re-pinning worth doing and not urgent. What made it *possible* was the last three
fighters: the live dump covered 21 of 24, so re-pinning would have traded Ed,
M.Bison and Terry for a year of patches. They are dumped now, and the live tree
covers everything the snapshot did.

## Findings

### The full-roster audit, 24 against 24

| population | Dec-2024 | live | delta |
|---|---|---|---|
| all 10,665 rows | 86.0% | 86.7% | +0.6 |
| clean, 8,174 rows | 92.9% | **93.6%** | +0.7 |

189 rows moved, 118 of them into agreement and **49 out of it**. Of the clean
population's 580 disagreements, 92 are skew and 488 are ours.

The five headline checks, over the clean population:

| check | Dec-2024 | live |
|---|---|---|
| hitstun | 93.2% | **95.1%** |
| blockstun | 88.7% | **90.4%** |
| total | 94.2% | **95.0%** |
| cancelEnd | 90.1% | **90.3%** |
| advantage | 81.8% | **82.8%** |

And three others move for reasons worth naming: **throwable is 24/24** where it
was 23/24, projectile launch speed 76.3% → 78.9%, and the armor hit count is
29/29 against the atemi table's own `ResistLimit` rather than
[ADR-0044](./0044-one-and-then-another-is-two.md)'s fallback — the same number,
no longer circular.

### Eight tests encoded a fact about the old build

Every one is a re-baseline rather than a regression, and two are the live dump
agreeing with FAT where the snapshot did not:

- **Ryu's sweep is no longer a hard knockdown on hit.** `DownTime` 10 →
  **15**, and `noQuickRise` is now on the **punish-counter row only**. FAT
  publishes `KD +40` on hit and `HKD +47` on punish counter — so the live dump
  matches FAT's *tag* where the snapshot did not, while its +45 floor now
  disagrees with the published +40. Both sources moved, in opposite directions.
- **Lily's Thunderbird carries its projectile invulnerability outright.**
  ADR-0014's grader had to count *"projectile invincible 13-41"* as answered by
  the absence of a hurtbox; the live dump has the `TypeFlag` window, and it is
  13-41 to the frame.
- **Akuma's OD Tatsumaki has 8 hit keys for 5 hits.** Two keys repeat verbatim —
  same frames, same `HitID`. ADR-0024's HitID rule absorbs it; a key count does
  not. Marisa's `ATK_2HP` and two of her supers do the same thing.
- Marisa's armored Phalanx: the strength whose window misses moved from OD to
  **HP** (11-15 against a published 10-15).
- Manon's `624` family and Guile's charge releases join the motion-input
  residual, which is now six rows and two named families rather than a floor.

### Terry's atemi row shadows a common one

ADR-0042 recorded that no atemi row was defined in both layers, "so the merge is
uncontested in this dump". That was true of 21 fighters. **Terry carries a
private `03`** — `ResistLimit` 1, `RecoverRatio` 0, `GaugeRatio` 100 — against
common row 3's 2 / 50 / 50. The per-fighter resolution ADR-0042 built is
load-bearing after all, and an index still means nothing without knowing whose
table it is read from.

## Decision

`data/raw/mmdk/` **is the live dump**: 24 fighters off the running Aug-2026
build, stamped `live-2026-08-19`, with `common_atemi.json` and
`common_rects.json` at its root.

The Dec-2024 upstream snapshot moves to `data/raw/mmdk-2024/` and
`fetch-mmdk.mjs` writes there. It is the comparison tree `skew-audit.mjs` grades
against, and pointing the fetcher at `mmdk/` would silently overwrite a dump that
needs the game running to reproduce. `npm run geometry` no longer fetches
anything; `npm run geometry:2024` rebuilds the comparison tree.

Re-baseline the eight tests, naming what moved in each rather than loosening a
bound.

## Consequences

- Every percentage in every earlier ADR is now quoted against a different tree.
  The five headline numbers are **95.1 / 90.4 / 95.0 / 90.3 / 82.8**, and where an
  older ADR says 93.2 / 88.7 / 94.2 / 90.1 / 81.8 it means the Dec-2024 snapshot.
  This is the one commit that re-baselines them; ADR-0043's audit is the record of
  which rows moved and why.
- Ed, M.Bison and Terry are current for the first time — Terry's data was a year
  stale and contributes ten of the 118 skew fixes on his own.
- 221 tests pass.

## Not settled

- **FAT lags the game on 49 rows.** Unchanged from ADR-0043 and now the project's
  loudest unknown: the grading reference is itself behind, and Ryu's sweep is the
  clearest case — two sources, both current-ish, disagreeing about the same move
  in opposite directions.
- ~~**Where the duplicated hit keys come from.**~~ Closed by
  [ADR-0047](./0047-a-hit-reaches-through-more-than-one-box.md): they are not
  duplicates but a **second box for the same hit**, they appear 1,141 times in the
  Dec-2024 tree as well, and the 8-versus-7 count on Akuma's Tatsumaki really was
  a patch — a hit key split across two rows.
- **Six fighters cannot be dumped at all.** MMDK's roster is a hardcoded table of
  24 keyed by internal character id; Mai, Elena, Sagat, C.Viper, Alex, Ingrid and
  Yasmine have no entry, so they have no box in its UI. FAT publishes 30 and does
  not have Yasmine either.
- **The comparison tree is gitignored.** `skew-audit.mjs` needs
  `npm run geometry:2024` run first, which needs GitHub. If that repo disappears
  the audit becomes unreproducible; nothing here mirrors it.
