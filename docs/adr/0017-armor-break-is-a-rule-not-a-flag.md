# ADR 0017 — Armor Break is a rule, not a flag, and `ArmorPoint` is dead

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0009](./0009-what-a-cancel-costs.md),
  [ADR-0016](./0016-armor-is-per-hurtbox.md)
- Extended by: [ADR-0018](./0018-cmnname-says-what-a-move-is.md) — the hardcoded
  notation table below is replaced by FAT's `cmnName`, and the five mis-mapped
  supers are fixed.

## Context

[ADR-0016](./0016-armor-is-per-hurtbox.md) decoded the *defensive* side of armor —
which frames a hurtbox absorbs a hit on, and which parts it covers — and named the
attacking side as the obvious next thing. `ArmorPoint` on the hit-data entry has
been extracted since ADR-0006 and read by nothing, and FAT tags **195 moves**
"Armor Break", which looked like the same kind of external grader.

It is a negative result, and a clean one.

## Findings

### `ArmorPoint` is dead

**Zero on all 79,175 occurrences across the whole roster.** The extractor emits
`armor` only when the field is truthy, which is why no hit outcome in
`data/geometry/` has ever carried one. The field exists in the game's tables and
holds nothing in this dump.

### Nothing else in the hit-data entry marks Armor Break either

Every field on the first `common` entry was searched — not a chosen shortlist —
for the single value or single bit that best separates the moves FAT tags from
the ones it does not, over 1,599 actions with hit data. Scored by F1 against a
0.334 baseline for a rule that fires on everything:

| best rule | F1 | what it actually is |
|---|---|---|
| `SuperOwn == 0` | 0.695 | "builds no super meter" — true of supers, and of 268 non-breakers |
| `JuggleLimit` bit 5 | 0.670 | a juggle property |
| `FocusTgt` bit 13 | 0.669 | a Drive-gauge property |

The best rule is transparently the *label leaking* — supers spend meter rather
than building it — and it still admits 268 false positives. `DmgKind`, `DmgType`,
`MoveType` and `Attr0`-`Attr3` were all checked and none separates the two
populations. **There is no attack-side armor field.**

### Because Armor Break is not a property of a move

FAT tags it on **every Drive Reversal (30 of 30 fighters) and every Super Art, and
on nothing else**. Graded against the dump's own classification — the trigger
`kind` flags `Lv1`..`Lv4` from ADR-0009, plus the Drive Reversal action:

> **808 of 813 — 99.4%**

That is a rule, and a rule is a real answer to "where is Armor Break stored": it
is not stored, because it does not need to be. The game knows a move is a super,
and supers break armor.

**All five residual disagreements are the move mapper**, not the rule — Cammy's,
Chun-Li's and Kimberly's supers whose notation landed on a special. Every one is a
move FAT tags and the dump's class does not, never the reverse.

One asymmetry worth recording: FAT does **not** tag Drive Impact, even though its
own gloss on the tag is *"blows through all armor **like Drive Impact**"*. The tag
marks moves whose notable property is breaking armor; Drive Impact's notable
property is having armor. That is a FAT editorial convention, not a game fact, and
it is the kind of thing that makes prose a softer grader than a column.

### The universal Drive moves were mis-mapped on nine fighters

ADR-0016 found Jamie's Drive Impact resolved to `SPA6_H`. Chasing Armor Break
found the same failure on Drive Reversal for JP, Ken and Manon, and Rashid's
`66 > 6K (wind)` landing *on* a Drive Reversal from the other direction.

The cause is structural rather than per-character. `candidatesFor` builds action
names from the notation (`5MP` → `ATK_5MP`), and `HPHK` and `6HPHK` are not action
names — the Drive system's actions are `ATK_CTA` and `ATK_CTA_4`. So the name path
finds nothing, and `frameUnique` falls back to whatever else shares the move's
startup and active frames. Drive Impact is 26/2, which is not a rare profile.

## Decision

Name them. `SYSTEM_ACTIONS` maps `HPHK` → `ATK_CTA` and `6HPHK` → `ATK_CTA_4`, the
pool is restricted to that action, and the frame-fingerprint fallback is kept away
from system actions in both directions.

The match quality still comes from the frames, not from the fact that the name is
certain — labelling a 4-frame disagreement `exact` because we are confident about
the identity would be exactly the kind of self-grading ADR-0010 exists to prevent.

Record the negative results as checks rather than prose: `verifyArmorBreak()` grades
the class rule, and a test asserts no hit outcome carries an armor value, because
the field's *existence* is what invites a decode that cannot happen.

## Consequences

- **Drive Impact maps `exact` with a startup delta of 0 on all 24 fighters**, and
  `sf6 boxes <char> HPHK` works for the first time. Two more moves per fighter are
  mapped (`ATK_CTA`, `ATK_CTA_4`).
- ADR-0016's armor grader no longer needs its `ATK_CTA` special case — Drive
  Impact reaches it through the ordinary mapping, and still scores 26/26.
- The five clean-population rates are **unchanged**: Drive Impact is a two-hit move
  and Drive Reversal is `weak`, so neither enters the clean population. The
  soft-mapping buckets grew, which is the new moves landing where they belong.
- `sf6 verify` prints the class rule alongside the armor window checks.

## Not settled

- **FAT's Drive Reversal startup is 4 higher than the action's first active frame,
  on all 22 fighters that have one.** Exactly 4, every time, so it is structural
  rather than skew — most likely FAT counting from the block that a Drive Reversal
  is performed out of. Not chased. Until it is, the mapping stays `weak`, which
  keeps it out of every graded population.
- **Five supers are still mis-mapped** (Cammy `236236P`, Chun-Li `236236K`,
  Kimberly `236236P`). Supers have character-specific action names — `SAA_HADOUKEN`,
  `SAA_SHINSYORYU` — so the `SAA` prefix identifies them as a class but cannot pick
  which one a notation means.
  [ADR-0018](./0018-cmnname-says-what-a-move-is.md) does it, through the trigger
  levels, and finds that a super's frames cannot be graded against FAT's at all.
- **What the atemi table rows mean** is unchanged from ADR-0016: the table is not
  in the dump. This ADR closes the attack side by establishing there is nothing
  there to read, not by reading it.
