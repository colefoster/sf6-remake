# ADR 0038 — The rush window opens late, and a gated twin hid it

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0008](./0008-cancel-windows.md),
  [ADR-0013](./0013-conditionflag.md),
  [ADR-0015](./0015-the-cancel-window-boundary.md),
  [ADR-0036](./0036-a-drive-rush-cancel-spends-the-rushs-freeze-not-the-moves-recovery.md)

## Context

ADR-0036 found the mechanism — a Drive Rush cancel discards the move's own
recovery, and what the attacker waits out instead is the rush action's `freeze`
of 10 — and graded it at 64.4% on block and 63.3% on hit. The residual was
one-directional and small: of 64 misses, 30 were two frames too plus and 24 one
frame. Four readings had been tested and rejected, and ADR-0036 recorded that
the residual is **per move, not per fighter**.

That last observation is the one that pointed here. A per-move number that the
freeze does not carry has to come from the move's own keys.

## Findings

### The wait does not start at contact; it starts when the window opens

The sim put the attacker at `freeze` frames from the contact frame. That is only
right if the cancel can be taken on the contact frame. Reading the rush cancel
window off the move's `TriggerKey`s — the keys whose group resolves to a
`DriveDash` trigger — and starting the wait where that window opens takes block
from 64.4% to 75.1%.

Right shape, still 44 misses. Ryu's 5LK and Akuma's 5LK have the same startup,
active, recovery, hitstop and window, and FAT publishes DRoB one frame apart.

### Because a cancellable normal carries *two* live rush windows

The keys are not one window. Ryu's 2MK (first active frame 8) carries:

```
{ start: 8,  end: 9,  buffered: false, cond: 5131, other: 131072 }
{ start: 10, end: 10, buffered: false, cond: 5131 }
```

Two consecutive live keys covering frames 8-9 and 10, in the same group, into
the same action. The earlier one carries `_Other` bit 17; the later one carries
nothing. Ryu's 5LK is the same shape one frame narrower — `5-5` gated, `6-7`
ungated — and Akuma's 5LK is `0-1` gated, `2-2` ungated. That is the whole
difference between the two 5LKs, and it is exactly the one frame FAT publishes
between them.

`_Other` is not a rich field: across all 24 fighters and every cancel key in the
roster it takes **three values and no others** — 0 (7,682 keys), 64 (4,203) and
131072 (387). 64 is already known; it is the buffer marker, set on the key in
front of a live window. So the choice here is not a fit over a space of
hypotheses, it is the only other bit the data has.

Bit 17 never appears on a buffered key (0 of 387), appears both in
`DriveDash`-only groups (90) and in the big general cancel lists, and on 130 of
387 the very next frame after it belongs to an ungated key in the same group.

### Reading the ungated key

Take the earliest live rush key that is neither `_Other`-gated nor the nibble-4
rush *extension* ADR-0015 already excludes, and start the wait there:

| check | ADR-0036 | now |
|---|---|---|
| `driveRushBlock` | 116/180 64.4% | **171/180 95.0%** |
| `driveRushHit` | 107/169 63.3% | **160/169 94.7%** |

The hit column is the independent confirmation. The rule was chosen against
`DRoB` alone; `DRoH` is a separate published column that moved the same distance
without being consulted.

### What bit 17 *means* is still not read

The honest statement is negative: the window bit 17 opens is not the one FAT
times a Drive Rush cancel from. Whether it is a whiff-only window, a
hitstop-only one, or a different trigger inside the same group is not decided by
anything here, and this ADR deliberately does not guess. It is named
`OTHER_GATED` rather than for a behaviour it has not been shown to have — the
same treatment ADR-0013 gave `_Condition`.

## Decision

Add `driveRushCancelFrame(geo, action)` to the geometry module: the earliest
live `DriveDash`-group key that is ungated and not the nibble-4 extension.

In `runScenario`, a Drive Rush cancel puts the attacker at
`max(0, opens − contactFrame) + freeze` rather than at `freeze`.

## Consequences

- Ryu's 2MK rush cancel is 12 frames from contact, not 10; Ryu's 5MP is still 10,
  because its window opens on the contact frame.
- `sf6 verify` runs the same eighteen move checks. The original five are
  unmoved: 93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- The ceiling assertion ADR-0036 left in the tests (`< 0.8`, "the number to
  beat") is replaced by a floor at 0.9.
- 202 tests pass.

## Not settled

- **Nine moves each still miss on block and on hit**, across thirteen distinct
  moves — Dhalsim 4MP, Juri 5MP, Ken 2HP, Manon 4MK > MK, Marisa 2LP, M.Bison
  5LP, Akuma 2HP/2MK, Blanka 5MK, Dee Jay 2MP, Terry 5MP, and two target
  combos. Most of them carry a *single* live rush key, so there is no gated twin
  to read and nothing here explains them. Ken's 2HP is three frames the other
  way.
- **`_Other` bit 17 is unread**, which is the finding's soft spot: the rule is
  "the window that is not gated" and not "the window that applies".
- Everything ADR-0036 left open stands: the parry rush's 11-frame freeze is
  never used, the rush's own 381 units of travel are not modelled, and nothing
  models what the rush cancels *into*.
