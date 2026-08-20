# ADR 0044 — "One and then another" is two, and the atemi table never disagreed

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0016](./0016-armor-is-per-hurtbox.md),
  [ADR-0039](./0039-the-atemi-index-is-the-armors-name-and-fat-holds-the-payload.md),
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md)

## Context

[ADR-0042](./0042-the-atemi-table-was-behind-another-button.md) put the atemi
table in hand and reported one place where it contradicted the published data:
atemi row 3 states `ResistLimit` **2**, and FAT was read as publishing **1 hit**
for the row's only claim, E.Honda's OD Sumo Headbutt. That was left as the ADR's
open item, with a guess attached about two one-hit stages.

The guess was right and the contradiction was ours.

## Findings

### The sentence has two clauses and the parser read one

FAT publishes, for Honda's `46PP`:

> **1 hit of armor on frames 1-8 and then another on 9-32**

`parseArmor` has looked for the word *"frames"* since ADR-0016 and counted how
many ranges a sentence carries, skipping any sentence with more than one because
two windows cannot be attributed to one merged dump window. This sentence names
its second window as *"another on 9-32"* — no repeat of the word — so exactly one
range matched, the parser accepted it, and the claim it produced was **1 hit on
frames 1-8**: half a sentence, graded as a whole one.

Read whole, it is *one hit* **and then another** — two. Which is what the atemi
row says. **The two sources agree, and have all along.**

### Both trees now grade the hit count at 100%

| tree | before | after |
|---|---|---|
| pinned (`ARMOR_HITS` fallback) | 29/29 — with row 3 wrong in a way nothing could see | **29/29** |
| live (atemi table) | 25/26, `atemi 3 says 2, published 1` | **26/26** |

The pinned tree's rate did not move, which is the point worth recording: it was
100% before and 100% after, and the number it was 100% *about* changed. A check
that grades an inference against the source the inference came from cannot report
its own error — ADR-0042 flagged this circularity in the report, and this is what
it looks like when it bites.

`ARMOR_HITS[3]` is corrected 1 → 2. Honda's OD Headbutt absorbs two hits in the
runtime now, on either tree.

### One move in the roster is written this way

Every armor sentence in FAT was checked — 69 of them. Honda's is the only one
using *"and then another"*. Two more carry two ranges in one clause each —
Marisa's Scutum, *"on frame 3 and onwards ... up to frame 118"* — and those stay
skipped: assembling one window out of two loose numbers is guessing, and neither
Scutum move is mapped, so nothing is currently lost.

### The window disagreement is unchanged, and is now the interesting one

With both stages parsed, the published window is **1-32** against the dump's
**1-56**. Honda's atemi keys are 1-9, 10, 11-13 and 14-56, all row 3, and the
last is body-only on an airborne action of 57 frames. FAT's 32 is 24 frames
short of where the dump's armor stops. The published `total` is 44(73), so
neither number is the action's length either. That is the residual now, and it is
about *when an airborne armor ends* rather than about how many hits it eats.

## Decision

`parseArmor` returns `stages` as well as a union `range`, adding one stage per
*"another on A-B"* clause and one hit per stage. The claim carries the stages so
the report can print the sentence's own shape.

Correct `ARMOR_HITS[3]` to 2.

A test asserts the stages, the summed hits, the union window and the dump's count
on Honda's `46PP` specifically — the one move in the roster whose sentence is
built this way, so a regression in the parser has a name.

While here: `printArmor` was calling `verifyArmorBreak()` with no arguments, so
`sf6 verify E.Honda` printed the roster-wide armor-break rate under a
one-character heading. Filtered with the rest of the report now.

## Consequences

- `hit count 26/26 100.0%` on the live tree, 29/29 on the pinned one, and the
  named disagreement ADR-0042 printed is gone.
- Honda's OD Headbutt absorbs **two** hits in the match, not one.
- The skew audit's `armorHits` row goes from `100% -> 96.2%` to `100% -> 100%`
  with nothing moved, so [ADR-0043](./0043-version-skew-is-worth-half-a-point.md)
  reads 166 moved rows and 48 FAT-lags rather than 167 and 49. Its headline
  numbers — +0.5 overall, +0.6 clean, 78 skew against 431 ours — are unchanged.
- 221 tests pass.

## Not settled

- **Where an airborne armor ends**, above: 32 published against 56 dumped on the
  one move that can ask the question.
- **Marisa's two Scutum claims** wait on the Scutum mapping, not on the parser.
- **The prose is still prose.** This is the second time a published *sentence*
  has been mis-parsed in a way a column could not have been (ADR-0016's own
  two-window skip was the first). Every armor and invulnerability number in the
  project comes through a regex over English, and the only defence is that the
  sentences are few enough to read by hand — which is how this was found.
