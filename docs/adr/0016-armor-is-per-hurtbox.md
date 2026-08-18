# ADR 0016 — Armor is per hurtbox, and that is why a low goes under it

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0010](./0010-the-grader.md), [ADR-0014](./0014-per-frame-invulnerability.md)
- Extended by: [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md) — the attack
  side turns out to be empty, and the Drive-move mis-mapping below is structural.

## Context

`DamageCollisionKey.AtemiDataListIndex` was the next field in the shape ADR-0014
found productive: extracted by nothing, read by nothing, and with a published
column to grade against. It is non-negative on **111 hurt keys across 88 actions**
and every one of the 24 fighters carries some.

"Atemi" in RE Engine covers armor and counters. FAT records armor the same way it
records invulnerability — as prose in `extraInfo`, 65 claims carrying a frame
range — so the method is ADR-0014's.

**There is no atemi table in the dump.** `AttackDataListIndex` resolves into
`HIT_DT.json`; this index resolves into nothing. `char_info.json`, `HIT_DT.json`,
`rects.json`, `tgroups.json`, `triggers.json` and `Names.json` were all checked
and none carries one. So the index is a **discriminator, not a payload**: it says
which armor a box has and cannot say what that armor does.

That leaves two things the dump does carry — *which frames* the armor covers and
*which hurtboxes* — and those turn out to be exactly the two things FAT writes
down.

## Findings

### Drive Impact is the anchor, and it is unanimous

Every fighter's `ATK_CTA` carries atemi index 1 over frames **1-27**, covering
head, body and leg. FAT publishes, for every fighter's `HPHK`:

> 2 hits of armor on frames 1-27

**24 of 24, exact, with nothing to tune.** This is the cleanest join the project
has had: the two sources agree on a window before any identity is applied to
either of them, on the game's single most-used armored move.

| check | result |
|---|---|
| the atemi keys' frames == FAT's published armor window | **26/26 — 100%** |
| FAT says a low goes under it == the window skips the leg box | **2/2** |
| FAT says nothing == the window covers the leg box | **24/24** |

### Armor is applied per hurtbox, not per fighter

This is the finding. Ten of FAT's armor claims are qualified, and the
qualification is always about height:

> 1 hit of armor **against High and Mid attacks (loses to Low attacks)** on frames 5-10
> 1-hit of armor on **upper-body** on frames 4-34 (attacks that hit low enough can go past the armor)
> 1 hit of armor on frame 3 and onwards on her **upper body (no armor on the lower body)**

The dump says the same thing structurally, without the prose: those moves' atemi
keys hold a **body list and no leg list**. Marisa's Phalanx (`623LP`) is armored on
frames 7-11 on the body only; Drive Impact is armored on head, body *and* leg.
A low attack is not beating the armor mechanic — it is hitting a hurtbox that
never had armor on it.

Across the roster the coverage is a property of the **table row**, not of the
move, which is what an index into a shared table should look like:

| index | windows | fighters | covers the legs | body only |
|---|---|---|---|---|
| 1 (Drive Impact) | 51 | 24 | **51** | 0 |
| 2 | 6 | 3 | 0 | 6 |
| 3 | 7 | 3 | 1 | 6 |
| 6 | 4 | 2 | 0 | 4 |
| 7 (Marisa) | 13 | 1 | 0 | **13** |
| 8 | 4 | 2 | 0 | 4 |
| 9 (Marisa's SA1) | 3 | 1 | 3 | 0 |

88 windows: 55 cover the legs, 33 do not. Only index 3 is mixed, and it is the
row shared by Honda's EX Headbutt, Zangief's Siberian Express and Marisa's Scutum
— three moves that have little else in common.

### What the index cannot say

Where a claim is reachable, the index is consistent with the published hit count —
1 → 2 hits on 24 fighters, 7 → 1 hit on Marisa's Phalanx. That is two rows out of
seven, on 26 claims, and it is not enough to call the index decoded. **Hit count
is not in the dump**; it is being read off FAT and attributed to the row. Stated as
what it is rather than dressed up.

`triggers.json` carries an `_IsAtemi` flag, true on **14 of 2,460 triggers** and
only for JP and Marisa, on the Scutum and Amnesia actions. That is the difference
between absorbing a hit and *countering* it — armor-and-continue versus
absorb-and-retaliate. Noted, not decoded: two fighters is not a population.

## Decision

Extract `atemi` on hurt keys. The read side is `armorWindows(action)`, returning
each window with the parts it covers, and `armoredAt(action, frame, part)` for the
per-part question a low attack asks. `src/verify/armor.ts` is the standing grader,
printed by `sf6 verify`.

Drive Impact is graded through its **action name**, not a move mapping. `ATK_CTA`
is the same action on all 24 fighters and FAT's `HPHK` is unambiguous, so the join
is on identity — which matters here, because the frames are the thing under test
and joining on frames would be circular.
([ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md) later teaches the mapper
the same identity, so the grader dropped the special case and reads `HPHK` through
the ordinary mapping. The rate is unchanged.)

## Consequences

- `sf6 boxes Marisa 623LP` now reads
  `armor 7-11 on body — a low attack goes under it`. The gloss is derived, not
  written down: it is there whenever the window skips the leg box.
- Five new tests, including the 24-fighter Drive Impact anchor asserted per
  character and the roster-wide index partition. The window floor is set at 100%:
  like ADR-0014's `strike` check it has no skew to absorb.
- **A mis-mapping the grader found: Jamie's Drive Impact maps to `SPA6_H`.** The
  move mapper matched `HPHK` on frames alone — startup 26, active 2 — and landed
  on a special that happens to share them. It is a `frame-unique` match, which
  ADR-0004's vocabulary already marks as soft, so this is the machinery working as
  designed and being wrong anyway. The grader ignores it in favour of `ATK_CTA`;
  the mapping itself is left alone — until
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md), which finds the same
  failure on four more fighters' Drive Reversals and fixes the cause.
- **Drive Impact is unmapped for the other 23 fighters**, so `sf6 boxes <char> HPHK`
  cannot reach it. [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md) fixes it.
- Nothing in the sim consumes armor yet, for the reason ADR-0014 gave about
  invulnerability: the dummy does not attack, so nothing ever tests a hit against
  an armored box. ADR-0009 already lists that as the blocking gap.

## Not settled

- **What each atemi row actually does.** The table is not in the dump, so the rows
  can only ever be characterised from outside. Rows 2, 3, 6 and 8 have no
  reachable published claim at all.
- **The low-attack half of the decode rests on two claims** — Marisa's `623LP` and
  `623HP`. The other fourteen armor claims that would test it are on her Gladius
  (`236P`) and Scutum (`214K`), and **neither is in the move mapping**, so they
  cannot be joined. The structural partition above is what carries the finding;
  widening the mapping would turn it into a proper rate.
- **Honda's EX Headbutt** publishes "1 hit of armor on frames 1-8 and then another
  on 9-32" — two windows in one sentence, which the parser skips rather than
  half-matching. Its atemi keys split 1-9 / 10-10 / 11-13 / 14-56, which is
  suggestive of the same two-stage structure and is not the same numbers.
- **The attack side is closed, and it is empty.**
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md) establishes that
  `ArmorPoint` is zero on all 79,175 occurrences, that no other hit-data field
  marks Armor Break, and that the tag is predicted at 99.4% by the move's class:
  every super and every Drive Reversal breaks armor, and nothing else does.
