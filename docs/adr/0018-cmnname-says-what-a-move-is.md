# ADR 0018 — `cmnName` says what a move *is*, and a Super Art's frames are not FAT's

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0009](./0009-what-a-cancel-costs.md),
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md)

## Context

[ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md) fixed Drive Impact and Drive
Reversal by hardcoding their notations, and left five mis-mapped supers open. That
prompted the first honest look at how much of FAT the mapping actually reaches:

| notation shape | solidly mapped | soft | unmapped |
|---|---|---|---|
| normal | 487 | 89 | 184 |
| special motion | **0** | 27 | 169 |
| chained | 75 | 55 | 131 |
| super motion | **1** | 6 | 132 |
| multi-button | **0** | 5 | 59 |

**822 mapped, 801 unmapped.** Roughly half of FAT has no action at all, and
specials and supers are almost none of what is mapped. Every "could not be joined"
caveat in ADR-0014 and ADR-0016 traces back to this — Marisa's Gladius and Scutum
carry fourteen armor claims that ADR-0016 could not grade for exactly this reason.

## Findings

### FAT has a column that says what a move is, and it was never read

`cmnName` is on **1,782 of 2,444 moves**, and it is a semantic label rather than a
notation: `"Drive Impact"`, `"Drive Reversal"`, `"Super Art Level 2"`,
`"Critical Art"`, `"Throw"`, `"Overhead"`, `"LP DP"`, `"MP Fireball"`,
`"LK Tatsu"`, `"OD Rekka 1"`.

Notation is what the mapper's name path matches on, and for these moves it is
useless: `HPHK` is not an action name and a super's action carries the move's
Japanese name. `cmnName` is the join key those moves needed, and it makes
ADR-0017's hardcoded notation table redundant — `"Drive Impact"` → `ATK_CTA` is a
statement about what the move is, not about how it is typed.

### The dump classifies supers too, so the pool shrinks from 300 to three

The triggers carry `_IsLv1`..`_IsLv4`, which ADR-0009 already extracted as `kind`.
Resolving those to their target actions gives, per level, the two or three actions
a super can be. Matching FAT's `"Super Art Level 2"` against that pool is a
different kind of question from guessing a 300-action list by frame profile — and
guessing was what put Drive Impact on a special.

**217 of the 237 actions a level trigger points at are named `SAA_*`, `CAA_*` or
`SA<n>_*`.** The other 20 are handoffs through something that is not a super:
Cammy's SA1 reuses her Spiral Arrow animation, and Akuma's install trigger points
at a standing loop. Taking those would have put `BAS_STD_Loop(2)` on Akuma's
`214214P` — a confidently wrong answer of exactly the kind ADR-0017 removed — so
the pool is filtered to the dump's own super naming.

**73 more supers map, and 66 remain unmapped rather than guessed.**

### A Super Art's action includes the cinematic freeze; FAT's numbers do not

Every mapped super lands on the right action and disagrees with FAT's startup, in
one direction and by a lot:

| level | n | min | median | max |
|---|---|---|---|---|
| SA1 | 13 | 47 | 61 | 75 |
| SA2 | 18 | 0 | 73 | 87 |
| SA3 | 16 | 55 | 82 | 115 |
| Critical Art | 18 | 55 | 84 | 115 |

The action's first active frame is later than FAT's published startup essentially
always, by an amount that grows with the level. That is the super flash: the dump's
action runs the cinematic and FAT counts from after it. It is consistent in
direction and explanation but it is **not a constant**, so it cannot be corrected
for — which means a super's published frames and the dump's are in **different
frame spaces**, and comparing them means nothing.

### Which broke three graders, and that is the useful part

Mapping supers immediately dropped `blockstun` to 92.4%, `total` to 92.1%,
`advantage` to 86.9%, and the invulnerability checks from 80% to 69%. The five
supers that happen to map at delta 0 — Dee Jay's SA2 follow-ups — walked straight
into the clean population and disagreed on everything.

**The clean population's "normals only" property had been holding by accident.**
ADR-0010 defined it as an exact single-hit mapping with an agreeing startup, and
that was sufficient only because no super was mapped to be excluded. It is now
stated: supers are out of the clean population, out of `src/verify/invuln.ts` and
out of `src/verify/armor.ts`, on the grounds above.

## Decision

Map by `cmnName` where FAT provides one: the Drive system's actions by name, and
Super Arts through the trigger levels filtered to the dump's super naming. Keep
scoring the match quality from the frames, so a class-identified move that
disagrees on startup still reads `weak` and stays out of every graded population.

Exclude `category === "super"` from the clean population and from both prose
graders, and carry `category` on every `Comparison` so a mixed population can
never again be read as one.

## Consequences

- **895 mapped, up from 822**, with 73 of the 79 new rows being supers and the
  Drive moves. `sf6 boxes <char> 236236P` reaches a Super Art for the first time.
- **All five headline rates are unchanged** — 92.1 / 93.3 / 93.3 / 91.0 / 87.9 — as
  are the three invulnerability checks and armor's 26/26. That is the point: the
  mapping got wider without any graded number moving, because the widening is
  quarantined from the populations it would have corrupted.
- `Comparison.category` is new, and the `total` plain-versus-chained test now
  states which categories it covers instead of inheriting them.
- **Armor Break moves from 99.4% to 98.5% (873/886), and the exceptions flip
  direction.** Under ADR-0017 all five were the mapper landing a super on a
  special. All thirteen now run the other way: FAT declining to tag a move the dump
  calls a super — Zangief's Atomic Buster, Lily's Raging Typhoon, Manon's SA3, and
  two mid-super follow-ups. **They are the command-grab supers.** A grab does not
  need to break armor to beat it, so FAT does not write it down. The rule is
  intact; the tag is editorial, as ADR-0017 already found for Drive Impact.

## Not settled

- **The super freeze itself.** If the dump records the flash duration somewhere,
  supers become gradeable and 73 moves join the checked population. Nothing was
  looked for yet; `MotionKey` and the `VfxKey` list are where to start.
- **Specials are still 0 solidly mapped of 196.** `cmnName` covers them —
  `"MP Fireball"`, `"LK Tatsu"`, `"OD Rekka 1"` — and that is a strength-plus-family
  label the dump's action names do not use, so it needs a different join than the
  level trigger gave supers. This is the single biggest remaining coverage gap and
  the thing that would let ADR-0016's low-attack decode rest on more than two moves.
- **184 normals are still unmapped**, which is a larger number than it looks
  because it includes every fighter's stance, taunt and follow-up notation.
- Cammy's SA1 genuinely runs on her Spiral Arrow action. Excluding it is right for
  now — the alternative was a wrong answer — but it means her supers are unmapped
  rather than correct, and the same is true of Akuma's install.
