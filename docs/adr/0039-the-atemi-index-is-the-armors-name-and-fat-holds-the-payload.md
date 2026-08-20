# ADR 0039 — The atemi index is the armor's name, and FAT holds the payload

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0016](./0016-armor-is-per-hurtbox.md),
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md),
  [ADR-0037](./0037-armor-absorbs-and-the-boxes-that-connected-are-the-ones-that-matter.md)
- Corrected by: [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md) —
  the table *is* dumped, by a different MMDK button. It confirms rows 1 and 7 and
  contradicts row 3: `ResistLimit` there is **2**, not the 1 inferred below.

## Context

ADR-0037 made armor do something and left the first item on its own "not
settled" list unanswered: **armor here is infinite.** A Drive Impact absorbed
one poke, then the next, then the next. ADR-0017 had found `ArmorPoint` is 0 on
all 79,175 hit-data rows, so nothing on the attacking side says what a hit costs
an armor, and ADR-0016 had found the atemi table `AtemiDataListIndex` points
into is not shipped. Both halves of "how much armor" appeared to be missing.

## Findings

### The count was already parsed, and already sitting in the grader

`verifyArmor` has read the number out of FAT's `extraInfo` since ADR-0016 — the
`hits` field on every `ArmorClaim`, from sentences of the form *"2 hits of armor
on frames 1-27"*. Twenty-nine claims across the roster carry one. Nothing read
it.

### And the atemi index determines it

The dump does not ship the atemi table, but it does ship the *index*, and the
index turns out to be a name the published data can resolve:

| atemi index | moves | FAT's count |
|---|---|---|
| 1 | Drive Impact, all 24 fighters | **2 hits** |
| 3 | E.Honda's OD Headbutt | 1 hit |
| 7 | Marisa's Gladius family (4 moves) | 1 hit |

Twenty-nine claims, three indices, and **no index is credited with two different
counts**. That is what makes this a decode rather than a guess: had the count
been a property of the move, index 7's four moves and index 1's twenty-four
would have had no reason to agree.

It also corrects ADR-0037's own aside. That ADR said "SF6 gives it one hit";
FAT publishes two for Drive Impact, on all 24 fighters.

### Three rows of a table, not the table

What is decoded is the count for the three indices the roster actually uses.
An index outside them is armor nothing in the roster has, and `armorHits`
returns undefined rather than a default — an armor whose count is unknown goes
on absorbing, which is the behaviour ADR-0037 shipped.

`PlData.ArmorPoint` is 100 on all 24 and `ArmorTimer` 50 on 22 (30 on Marisa and
Zangief). Both are extracted and neither was used here: with the per-hit cost
living in the unshipped table, a pool of 100 says nothing about how many hits
empty it. They are noted, not read.

### Absorbing costs Drive, and that field was already there too

ADR-0037's second open item. `DriveNorm` on the row that landed is the Drive the
defender loses — the same field a block reads — and the armor path applied
health damage only.

## Decision

Add `ARMOR_HITS` (`{1: 2, 3: 1, 7: 1}`) and `armorHits(window)` to the geometry
module, and `armorAt`, which returns the covering window rather than a boolean
so the caller can see the index.

In the match, count absorbed hits per `<fighter>:<action instance>:<atemi
index>` and stop absorbing once the count is spent. Apply `driveDamage.normal`
to the absorbing side.

Grade the mapping: `sf6 verify` now reports whether the atemi index predicts
FAT's published hit count.

## Consequences

- `hit count 29/29 100.0%` in the armor report.
- Ryu mashing 5LP into Ken's Drive Impact gets two absorbed and the third lands
  for real, interrupting the Impact.
- Absorbing drains the defender's Drive.
- The original five checks are unmoved: 93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 205 tests pass.

## Not settled

- ~~**The atemi table is still not in the dump.**~~ It is, behind MMDK's *Dump
  Atemis* button —
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md). The armor does
  take reduced damage: `DamageRatio` 50 on every row. `ARMOR_HITS` survives as
  the fallback for a tree extracted from a dump that predates the atemi dump,
  which the pinned one is.
- **`ArmorPoint` 100 and `ArmorTimer` 50/30 are unread.** The 30 belongs to
  Marisa and Zangief and is the only per-fighter variation in either number, so
  it is probably not noise.
- ~~**Armor damage is not recoverable.**~~ `RecoverRatio` 50 on the atemi row is
  read as the share that is, and it goes into the pool ADR-0041 added. See
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md).
- **Armor break is still a rule about the move, not the hit** — a super that
  whiffs its armored frames counts as breaking, because the test never looks at
  timing. Unchanged from ADR-0037.
