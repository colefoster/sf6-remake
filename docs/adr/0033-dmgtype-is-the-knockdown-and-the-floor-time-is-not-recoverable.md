# ADR 0033 — `DmgType` is the knockdown, and the floor time is not recoverable

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0011](./0011-margin-frame-is-recovery.md),
  [ADR-0027](./0027-two-fighters-and-the-reaction-the-table-asks-for.md),
  [ADR-0032](./0032-a-combo-is-a-hitid-a-counter-and-one-scaling-number.md)

## Context

Every combo the runtime played ended in a vacuum: the defender took their
hitstun and stood up, whatever had hit them. Nothing anywhere read `DownTime`,
`reactionFor` could not name a `_DN` action, and the sim's dummy had no notion
of being on the floor. Meanwhile FAT publishes **784 moves** whose on-hit
column is not a number but a knockdown advantage — `"KD +37"` — which looked
like the largest gradeable target left.

## Findings

### `DmgType` says whether a hit knocks down, and it grades

`DmgType` is 3 on a hit that leaves the defender standing and something else on
one that does not: 6 on a sweep, 11 on a launch, 13, 15, 21 on the rest.
Measured against FAT's own "KD" over the clean population, `DmgType != 3`
agrees on **503 of 542 — 92.8%**.

Nothing else in the row carries it. `_kezu_down` is chip-kill-while-blocking;
`BoundDest` and `FloorTime` are zero on both Ryu's 2HK and his Shoryuken;
`DownTime` is nonzero on plenty of moves that do not knock down (5MP states 3).

### A hard knockdown is two fields, neither of which says it alone

FAT publishes `HKD` — a knockdown that cannot be quick-risen — on 185 moves on
hit and 118 on punish counter. Two fields in the dump speak to it:

- **`_no_rolling`**, true on 11,131 of the roster's 79,175 condition rows, and
  previously dropped by the extractor. On the punish-counter rows it is set on
  31 of the 32 FAT calls `HKD` — but it misses about half of them.
- **`DownTime == 0`**, which appears on 18 of the 30 hard knockdowns and on
  **none of the 182 soft ones**.

Neither alone is the rule; their union is. `_no_rolling || DownTime == 0`
against FAT's punish-counter column agrees on **196 of 204 — 96.1%**. Against
the on-hit column it is weaker (88.7%), which fits: the punish-counter column
is where FAT publishes most of its hard knockdowns in the first place.

### `DownTime` is the time on the floor, and a sweep proves it

Ryu's 2HK, row `052`: `DownTime` is 10 on hit and block, and **25 on counter
and punish counter**. `HitStun` is 20 on all four. `MoveDest` and `MoveTime`
are identical on all four. The single thing a counter hit changes about a sweep
is `DownTime`, by +15 — which can only be extra time lying there, and is
exactly the extra okizeme a counter-hit sweep gives in SF6.

Roster-wide it corroborates: rows with `_no_rolling` false average a `DownTime`
of 8.2, rows with it true average 22.1.

### The knockdown chain is not wired, so it is walked by name

`DMG_HM_DN`, `DMG_HH_DN`, `DMG_CM_DN`, `DMG_CH_DN` (45 frames, margin 22), the
lying-down `BAS_DN_STD_AO`/`_UT` (42 frames, margin 30), and the four
`BAS_TECH_*` quick-rises (50 and 44 frames, margin 30) carry **no `BranchKey`
at all**, on any of the 24 fighters, and nothing anywhere branches into them.
The chain is the same kind of seam as ADR-0026's movement table and the jump
chain: the actions are the dump's, the joins are ours.

Three smaller things fell out of reading them:

- Only `H` and `C` exist in the `_DN` family. There is no `DMG_LM_DN`, so a low
  that knocks down still plays the standing letter, and ADR-0027's `part: 3 → L`
  fold cannot name one.
- The `_DN` actions are the one place the dump keeps its numeric prefix in the
  action name — `1050_DMG_HM_DN`, where an ordinary reaction is plain `DMG_HM`.
- **A quick rise is not earlier.** `MarginFrame` is 30 on all six down and tech
  actions alike. What a tech changes is the total length and how soon the downed
  pushbox is released (frame 9 rather than 15), not when the fighter can act.

### And the published knockdown advantage could not be reproduced

This is the negative result, and it is the substantial one.

For each of 133 moves where FAT publishes a plain `"KD +N"`, the defender's
free frame that FAT implies is `attackerActionable + N`. Subtracting the
readings the dump offers:

| reading | exact matches |
|---|---|
| `stun + reaction frames` | 17/133 (12.8%) |
| `knockback frames + reaction frames` | 17/133 (12.8%) |
| `stun + knockback + floor` | 5/133 |
| `stun + floor` | 3/133 |
| `max(stun, knockback) + floor` | 3/133 |
| `stun + DownTime + floor` | 21/133 (16%) |

`DownTime` is clearly *part* of it — including it pulls the residual from 37
scattered values with a 15% mode into a cluster of 32–36 holding 59% of the
population, and the wakeup action's own actionable frame is 31. But the residual
is not constant, so something per-move is still missing. The likeliest candidate
is the defender's descent: they are thrown along `MoveDest` and have to fall,
and the gravity that decides when they land is not in these files.

So no `kdAdvantage` check was added. Rather than invent a number, `runScenario`
now returns `defenderActionable: null` and `knockedDown: true` for a knockdown —
the same answer it already gives for an air normal, and for the same reason.

## Decision

Extract `_no_rolling` as `noQuickRise`. Add `UPRIGHT_DMG_TYPE` and `knocksDown`
to the geometry module. Add two grader checks: `knockdown` (92.8%) and
`hardKnockdown` (96.1%), and widen `knocksDown` on the FAT side to count `HKD`,
which had been silently dropping 185 moves.

In the match, a knockdown plays the `_DN` reaction and then leaves the defender
in `BAS_DN_STD_AO` for `DownTime` frames plus that action's own recovery, rising
on its `MarginFrame + 1`. In the sim, a knockdown reports no advantage.

## Consequences

- Ryu's 2HK plays `1060_DMG_HH_DN`, and Ken is on the floor for 40 frames
  (`DownTime` 10 + 30) before standing up.
- `sf6 verify` runs sixteen checks. The original five are unmoved:
  93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 187 tests pass.

## Not settled

- **The floor time does not reproduce FAT.** The chain above is asserted, not
  verified; the measurement that would verify it is the one that failed. If the
  descent is the missing term, modelling the defender's arc is the way in.
- **Quick rise is not modelled at all.** The `BAS_TECH_*` actions are extracted
  and never entered, and since their margin matches the ordinary one, it is not
  clear from this data what teching would change.
- **`_UP` launches are not modelled.** `DMG_HU_UP` and friends are the launched
  family and `reactionFor` never names them; a launch currently plays a `_DN`.
- **The reversal window is in the dump and unused.** Every down and tech action
  carries a `TriggerKey` on the neutral group, buffered from frame 23 and firing
  at 30 — wake-up reversals, stated outright, and nothing reads them.
- **`__NoHitWhileDown` is true on every fighter and unread**, so a downed
  fighter here can still be hit.
- **The downed pushbox cannot be resolved.** `BoxNo 6` lives in a shared asset
  MMDK does not dump, so a knocked-down fighter keeps a standing pushbox.
