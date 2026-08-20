# ADR 0055 — A blocked move hands over to its twin

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0011](./0011-recovery-from-marginframe.md),
  [ADR-0012](./0012-actionable-frame.md)

## Context

`advantage` — "the sim played out from the dump alone == FAT's published
on-block" — has been the weakest of the graded numbers since it existed, at
**83.0%**, 94 clean disagreements. Every other number the advantage is built
from grades in the nineties.

## Findings

### The failures are not spread out; they sit on a signal FAT publishes

Of the 94, **62 fail while both of their inputs agree** — the blockstun matches
FAT and so does the total. So the sim was combining two correct numbers into a
wrong one.

Cross-referenced against FAT's own columns, 28 of those 62 have one thing in
common: **FAT publishes their recovery as a pair, `14(16)`.** Every move whose
recovery is a plain number agrees.

And the size of the disagreement is the size of the bracket:

| | FAT recovery | bracket gap | advantage error |
|---|---|---|---|
| A.K.I. 5MP | `14(16)` | 2 | +2 |
| Akuma 6HP > 6HP | `21(24)` | 3 | +3 |
| Blanka 5HK | `18(15)` | −3 | −3 |
| Dhalsim 2HP | `20(24)` | 4 | −4 |
| Ed 5MK | `16(20)` | 4 | −4 |
| A.K.I. 5HP > HP | `24(29)` | 5 | +5 |

### Both numbers are in the dump, as two actions

A.K.I.'s `ATK_5MP` recovers in 14. `ATK_5MP(1)` recovers in 16. Blanka's
`ATK_5HK` in 18 and `ATK_5HK(1)` in 15. On every one of these moves the twin's
recovery is the other half of FAT's pair.

### The dump says which is which, in words

The base action carries a `BranchKey` a frame or two past its last active frame,
pointing at the twin, and its `_TypesName` is not a number:

```
A.K.I. ATK_5MP  -> 604  Type 5   "Types = SWING"
A.K.I. ATK_5MP  -> 604  Type 4   "Types = GUARD"
Blanka ATK_5HK  -> 612  Type 4   "Types = GUARD"
Chun-Li ATK_2HK -> 615  Type 54  "Types = TOUCH"
```

**SWING is the move hitting nothing, GUARD is it being blocked, TOUCH is it
connecting** — and the twin each points at has its own `MarginFrame`. That is
what FAT's bracket is: two recoveries, because there are two actions.

Measured across every mapped attack that carries one, against FAT's on-block:

| branch | n | base's recovery matches | twin's matches |
|---|---|---|---|
| GUARD (4) | 10 | 1 (10%) | **7 (70%)** |
| TOUCH (54) | 38 | 28 (74%) | **31 (82%)** |
| SWING (5) | 42 | **35 (83%)** | 5 (12%) |
| 46 | 31 | **30 (97%)** | 6 (19%) |
| 37 | 16 | **12 (75%)** | 0 |

The three named types behave exactly as their names say. A blocked move's
recovery is the GUARD twin's; a whiff's is the base's, which is what the sim was
already using and why the plain-recovery moves always agreed.

### One branch per target was dropping the type

`dedupeBranches` keyed on the target action alone. A.K.I.'s 5MP carries a SWING
*and* a GUARD branch to the same twin, so only the first survived and nothing
downstream could tell "it whiffed" from "it was blocked". Keyed on target *and*
type, both survive.

## Decision

`BRANCH` and `contactAction(geo, action, kinds)` in `src/data/geometry.ts`.
`src/sim` resolves the attacker's recovery through the GUARD branch on block and
the TOUCH branch on hit, falling back to the action itself. `Fighter.contacted`
carries the same thing into the runtime: the match sets it when an attack meets
something, and `takeBranch` hands the action over at the branch's own frame,
keeping the frame the way `_InheritFrameX` says.

## Consequences

- **advantage 459/553 → 467/553, 83.0% → 84.4%.** Eight moves, all of them
  moves where the sim had been right about both inputs and wrong about the sum.
- A Drive Impact that lands now plays `ATK_CTA(3)` rather than staying in
  `ATK_CTA`, which is the same rule and is why one armor test changed.
- `dedupeBranches` keeps a branch per target *and* type, so the extraction no
  longer throws away which case a branch is for.

## Not settled

- **The other eleven branch types.** 46, 37, 21, 29, 2, 20, 17, 16, 49, 14 and
  36 appear on mapped attacks and only 36 (CATCH, ADR-0034) is read. Type 46 is
  the third-commonest and its base agrees 97% of the time, so whatever it is, it
  is not a recovery swap.
- **GUARD's twin is right 7 times in 10, not 10.** The three it misses are not
  explained here.
- **86 advantage failures remain**, and the two blind spots that hid them are
  still there: a move whose FAT recovery is bracketed gets no `total` comparison
  at all, and a multi-hit move gets no `blockstun` one.
