# ADR 0024 — A hit is a `HitID` within a window, not a key

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0010](./0010-the-grader.md),
  [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md),
  [ADR-0023](./0023-the-sim-throws-a-fireball.md)

## Context

Every check in `sf6 verify` is reported over a *clean population*: an exact
name-and-frame mapping of a **single-hit** move whose startup already agrees.
The single-hit condition is there because FAT's `hitstun`, `blockstun` and
`onBlock` describe one blow, and on a multi-hit move they describe a hit the
grader is not looking at.

[ADR-0023](./0023-the-sim-throws-a-fireball.md) named the population that
condition was keeping out as the largest remaining gap, and blamed the sim: it
stops at the first contact, so a multi-hit move's advantage is unanswerable.
That diagnosis was wrong about which moves were being excluded.

## Findings

### The count was counting keys, and a key is not a hit

`signature()` set `hits` to the number of non-proximity `AttackCollisionKey`s on
the action. The dump routinely splits **one** blow across several keys — boxes
that come and go over the same active window as the limb extends. A.K.I.'s `5HK`
carries three keys, one contiguous window, one hit-data row, and FAT publishes
`active 4`. It was being called a three-hit move.

Across the 435 mapped moves the old count called multi-hit, **397 have exactly
one contiguous active window.** The condition was excluding single-hit moves by
the hundred.

[ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md) had already
met this from one direction and patched it locally: a fireball's keys split its
flight into a spawn flash and the travel proper, so the count was special-cased
to distinct hit-data rows *for shot actions only*. It is not a fireball problem.

### FAT writes the hit count into its own notation, so the count can be graded

`active` is not always a number. `2(13)3` is two windows with a gap of 13,
`1*3` is two hits back to back, a bare `4` is one hit. Splitting on `(n)` and `*`
gives FAT's own count, which makes this an ordinary two-source check rather than
a judgement call — 831 exact mappings carry a notation that parses.

| reading | agrees with FAT |
|---|---|
| keys (what the extractor did) | 433/831 — **52.1%** |
| distinct hit-data rows | 689/831 — 82.9% |
| distinct `HitID` | 781/831 — 94.0% |
| contiguous windows | 785/831 — 94.5% |
| **`HitID` per window, summed** | 792/831 — **95.3%** |

### The rule is the pair, and each half is there for a shape the other misses

`HitID` is the game's own statement of what one hit is: keys sharing an id can
only connect once between them. Counting ids alone misses the moves that reuse
one id across separate windows — Ken's `623PP`, two knockdowns at `10(14)10`,
reads 6. Counting windows alone misses the back-to-back hits FAT writes with a
`*`, which share a window and are separated only by the id — Ryu's `6MP` is
`1*3`, three keys, one window, two ids.

Per-window distinct ids beats both, and it beats them on *different moves*:
neither half is a rounding of the other.

On normals — the population every identity in this project was measured on — it
is **543/545, 99.6%**.

### It subsumes the fireball special case

Applied uniformly, the rule leaves every mapped fireball at one hit without the
shot branch ADR-0022 added, and the OD fireballs that ADR-0023 found hitting
twice come out as two. One rule replaced two.

## Decision

Count hits as **distinct `HitID` per contiguous active window, summed**, in
`signature()` in `scripts/extract-geometry.mjs`, with no special case for shots.
Expose the same rule as `hitCount(action)` in `src/data/geometry.ts` for the read
side, alongside the existing `activeWindows`.

Grade the count against FAT's `active` notation in `tests/verify.test.ts`, with
the three rival readings scored beside it so the pair is asserted to beat each
half — the same shape as ADR-0015's rival confirm window.

Also: `node scripts/extract-geometry.mjs` with no arguments now rebuilds every
dumped character rather than Ryu and Akuma, which had been silently leaving 22
files stale after a rule change.

## Consequences

- **The clean population goes 453 mapped moves to 746** — 294 in, 1 out — and
  every check gets both wider and *better*:

  | check | before | after |
  |---|---|---|
  | `hitstun` | 280/308 — 90.9% | **440/472 — 93.2%** |
  | `blockstun` | 340/391 — 87.0% | **595/671 — 88.7%** |
  | `total` | 291/314 — 92.7% | **457/485 — 94.2%** |
  | `cancelEnd` | 140/156 — 89.7% | **210/233 — 90.1%** |
  | `advantage` | 294/360 — 81.7% | **445/544 — 81.8%** |

  A population that grows by two thirds and does not dilute is the strongest
  statement available that the rows joining it belong there.
- The other bucket falls to 61.0 / 65.0 / 64.3 / 48.1 / 30.1%. What is left in
  it is genuinely multi-hit or genuinely soft, which is what it was always
  supposed to hold.
- **The guard release sweep is now decisive**: 595/671 at 4 against a next best
  of 22/671. ADR-0006's constant has never been measured against a population
  this size.
- The projectile sweep is untouched — 24/39 at offset 8, same spike, same flat
  floor of four. None of the 39 changed category.
- Specials `total` reaches 100/110 and `blockstun` 75/94; their floors rise to
  0.85 and 0.75. `advantage` on specials is 67/114 and stays written as a
  **ceiling** at 0.6, per ADR-0021.
- 143 tests pass.

## Not settled

- **142 moves are genuinely multi-hit and still excluded** — 88 specials, 27
  supers, 25 normals, 2 Drive moves. This is the population ADR-0023 meant, and
  it is a third the size it looked. The sim still stops at the first contact, so
  their advantage is unanswerable; that is the change worth making next, and it
  is now scoped to moves that really do hit more than once.
- **39 of 831 disagree with FAT's notation, in both directions.**
  - Over-counting, ~20 rows: FAT publishes a move that plainly hits several times
    as one window. Ryu's `236236K` reads 6 ids against a published `active 12`,
    Jamie's `623LK` 2 against `10`, Kimberly's `236MP` 2 against `2`. These look
    like FAT simplifying rather than the dump being wrong, but nothing tested
    says so.
  - Under-counting, ~19 rows: **one key, one id, and FAT counts two hits.** JP's
    `236LP` is `3*3` on a single key; Terry's `5HP` is `1*3`; Luke's `214LP
    (hold)` and M.Bison's `46PP` the same. The game re-arms the box within the
    key and the dump does not say on which frame.
- **Dhalsim's `63214KK` is the one move that left the clean population** — an OD
  Yoga Blast whose shot carries two ids against a published `active 10`. It falls
  under the over-counting case above.
- Both residues are small enough to name move by move, which is the usual sign
  that a second field is doing the work and has not been found yet.
