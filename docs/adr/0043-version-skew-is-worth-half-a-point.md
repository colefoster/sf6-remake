# ADR 0043 — Version skew is worth half a point, and FAT lags too

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0010](./0010-the-grader.md),
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md)

## Context

Every percentage this project has published carries the same caveat, written down
in `docs/agents/refresh-the-dump.md` and repeated in ADR after ADR: the geometry
is extracted from a **pinned, year-old, third-party snapshot** and graded against
**current** frame data, so a disagreement is either our reading or the game
having changed underneath us, and nothing separated the two.

The caveat was honest and useless. It could not say whether "93.2%" was really
93.2% of a decode plus 6.8% of ours, or 93.2% plus 3% skew plus 3.8% ours. Any
residual small enough to be interesting was also small enough to be skew.

[ADR-0042](./0042-the-atemi-table-was-behind-another-button.md) needed a live dump
for the atemi table and produced the missing ingredient as a side effect: a second
geometry tree, extracted from the Aug-2026 build, gradeable beside the pinned one.

## Findings

Both trees graded against the same FAT snapshot, restricted to the **21 fighters
both contain**, addressed row by row as `<check>|<character>|<move>`: 9,311 rows
in both trees, 68 in the pinned tree only and 81 in the live one only (moves that
map elsewhere, or actions that are new — mapping differences, not disagreements,
and excluded).

### A year of patches moved 167 of 9,311 numbers

**1.8%.** That is the entire surface over which skew can possibly act, and it is
the finding: the game's frame data is far more stable across a year than the
project's residuals are large.

### Skew is worth about half a percentage point

| population | pinned | live | delta |
|---|---|---|---|
| all 9,311 rows | 85.8% | 86.4% | **+0.5** |
| clean population, 7,099 rows | 92.8% | 93.4% | **+0.6** |

Per check, over the clean population the headline numbers are quoted on:

| check | n | pinned | live | delta |
|---|---|---|---|---|
| hitstun | 411 | 93.2% | 94.9% | +1.7 |
| blockstun | 583 | 88.0% | 89.7% | +1.7 |
| total | 419 | 94.3% | 94.7% | +0.5 |
| cancelEnd | 204 | 89.7% | 89.2% | **−0.5** |
| advantage | 478 | 82.0% | 82.4% | +0.4 |

**Of the clean population's 509 disagreements, 78 are skew and 431 survive the
live dump.** So roughly **six sevenths of every residual in this project is ours**
(or FAT's), not the snapshot's. Every decode built on a residual stands.

*One row of that table has since changed:*
[ADR-0044](./0044-one-and-then-another-is-two.md) fixed a mis-parsed armor
sentence, so `armorHits` is 100% in both trees and the counts below read 166
moved rows and 48 FAT-lags rather than 167 and 49. The headline numbers are
unchanged.

### And it runs both ways: 49 rows agreed before and disagree now

Of the 167 moved values, 97 are rows the pinned tree got wrong and the live tree
gets right — ordinary skew. **49 are rows the pinned tree got right and the live
tree gets wrong**, and 21 disagree in both.

That second column is not a bug and not skew in the usual direction: it is FAT
**lagging the game**. The clearest case is Manon, who supplies 13 of the 49 — her
`236LP`/`236MP`/`236HP`/`236PP` all moved from a juggle limit of 3 to 6, and FAT
still publishes 3 for every one of them. Cammy's `4MP` and `214PP` blockstun moved
+2 and +5 with FAT unchanged; Chun-Li's `236LK` Drive damage on hit moved 5000 to
1000.

So "current frame data" is current in aggregate and not row by row, and the
grader has **two** unsynchronised sources rather than one fixed reference and one
stale dump. Re-pinning is a net **+48 rows**, not a windfall.

### Where the moved rows are

Fixes cluster on Marisa (11), Luke (10), Ken (9), Guile (8) and Manon (8);
regressions on Manon (13), Marisa (9) and Cammy (5). Both lists are patch notes,
read off the data: these are the fighters Capcom touched.

## Decision

Make it repeatable rather than a one-off measurement, because the answer expires
with the next patch and the next dump.

`sf6 rows [char ...]` prints every graded row every verifier produces as JSON,
keyed `<check>|<character>|<move>` — `src/verify/rows.ts`, which is a flattening
and grades nothing itself.

`node scripts/skew-audit.mjs <olderTree> <newerTree>` grades both trees in a child
process each (the loader takes its directory from `GEOMETRY_DIR`, so two trees
cannot be live in one process), intersects the rosters, and reports per check:
rows whose value moved, rows the newer tree fixes, and rows it breaks. It names
every moved row with a verdict — `skew fixed`, `FAT lags`, `both disagree`.

Three tests assert the *addressing* rather than the numbers: keys unique,
three-part, one per row of the report they flatten, and a tree's roster reported
as what it actually has.

## Consequences

- The caveat in `docs/agents/refresh-the-dump.md` has a number now: **half a
  point overall, 1.7 at worst on any headline check**. Quoting a residual no
  longer requires an apology, and attributing a 3-point residual to a mechanic is
  no longer defensible as "probably skew".
- `sf6 verify` is untouched. This ADR adds a second tool beside it, not a change
  to what it measures.
- 220 tests pass.

## Not settled

- **FAT's own currency is now the loudest unknown.** 49 rows where the pinned
  dump agreed and the live one does not are 49 rows where the published data is
  behind the game, and there is no third source to break the tie. Manon's juggle
  limits are the concrete case.
- **The audit is blind to the three fighters the live dump lacks** — Ed, M.Bison
  and Terry — and to the six nobody has dumped. Skew on those is still
  unquantified.
- **A moved row cannot distinguish a patch from a dumping difference.** Both
  trees come from MMDK, but the pinned one is a third party's dump at a commit
  and the live one is ours off the running game; a difference in *how* the two
  were taken would present exactly like a patch. Nothing here separates them.
- **The 21 rows that disagree in both builds by different amounts** are the most
  interesting rows in the audit and are not looked at here. Chun-Li's `236LK` is
  −38 then −16 against a published −8: something about that move is wrong in our
  reading twice over.
