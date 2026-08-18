# ADR 0036 — A Drive Rush cancel spends the rush's freeze, not the move's recovery

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0011](./0011-margin-frame-is-recovery.md),
  [ADR-0019](./0019-the-super-freeze-is-in-the-dump.md),
  [ADR-0031](./0031-the-gauges-are-priced-by-the-dump-and-graded-by-fat.md)

## Context

Drive Rush is the mechanic SF6's offence is built on, and the runtime could
already perform one — ADR-0031 priced every trigger, so the three-bar cost was
enforced and the action played. What nothing modelled was the thing the mechanic
is *for*: cancelling a normal into it and coming out plus.

FAT publishes that as `DRoH` and `DRoB` on 277 moves. Nothing in the dump
states an advantage modifier, and ADR-0031's survey said so outright: "nothing
says what a Drive Rush *does to* the move cancelled into — the +4/+4 the
community measures is not in these files."

## Findings

### It is not a modifier, which is why nobody found one

`DRoB − onBlock` is not a constant. Across the roster it takes every value from
0 to 13, with no mode worth the name — 24 moves at 0, 24 at 10, 19 at 9, 18 at
2. Whatever a Drive Rush cancel does, it does not add frames to the move's own
advantage, and looking for a modifier was looking for the wrong shape.

### What is nearly constant is what comes *after* contact

Turn it around and ask how long the attacker waits, rather than how much they
gain. `blockstun − DRoB` is the attacker's own recovery under a Drive Rush
cancel, and that **is** concentrated:

```
blockstun - DRoB :  10 ×151   12 ×40   11 ×31   13 ×9   14 ×3   (n = 240)
hitstun   - DRoH :  10 ×140   12 ×39   11 ×30   13 ×8   14 ×3   (n = 221)
```

Ten frames, on 63% of the population, whatever the move. That is the mechanic:
**cancelling into the rush discards the move's recovery entirely**, and what the
attacker waits out instead is a fixed cost belonging to the rush. A heavy and a
light end up leaving nearly the same advantage, which is exactly why Drive Rush
flattens SF6's normals into one another.

### And the ten frames are in the dump — on the rush action's `freeze`

`ATK_CTA_DASH` carries `freeze: 10`. Its parry-cancel twin carries `freeze: 11`.
This is the same `WorldKey` timer ADR-0019 decoded for the Super Art cinematic,
on an action that is not a Super Art.

Reading it off the *trigger* rather than the action name matters, because which
of the two rush actions is the raw one and which the parry one is **swapped on
four fighters** (Blanka, Ken, Kimberly, Terry). The trigger's own classification
is unambiguous and roster-wide:

| trigger | cost | action's freeze | fighters |
|---|---|---|---|
| `DriveDash` | 30000 (3 bars) | **10** | 24/24 |
| `ParryDash` | 5000 (½ bar) | **11** | 24/24 |

So the number is derived, not fitted. `driveRushFreeze(geo)` finds it through the
trigger, and the sim replaces `actionableFrame`'s answer with it.

### Graded, and it is not the whole story

| check | clean | |
|---|---|---|
| `driveRushBlock` | 116/180 **64.4%** | the sim's rush cancel == `DRoB` |
| `driveRushHit` | 107/169 **63.3%** | the sim's rush cancel == `DRoH` |

The residual is small and one-directional: of 64 misses, **30 are two frames too
plus and 24 are one frame**. So the mechanism is right and something per-move is
missing — most likely where in the active window the cancel is taken, which the
sim fixes at the first active frame.

Two candidate explanations were tested and rejected. Adding one to the freeze,
on the `marginFrame + 1` precedent this codebase uses everywhere else, drops the
direct data-to-data agreement from 63.8% to 12.6%; adding two gives 16.6%. The
freeze is spent as stated, not as a last-frozen-frame index.

These two checks sit far below the project's usual bar and are kept anyway, with
their own floor in the tests. A mechanic measured at 64% is worth more than one
left unmodelled, and the number is recorded so that improving it shows up.

## Decision

Add `driveRushFreeze` to the geometry module, found through the `DriveDash` /
`ParryDash` trigger classification. Add a `driveRush` option to `runScenario`
that discards the attacker's own recovery in favour of it, and a matching
`drive-rush` recovery source. Grade both columns.

## Consequences

- `runScenario("Ryu", "2MK", { driveRush: true })` puts the attacker at 10
  frames from contact instead of 21, and turns a minus normal plus.
- In the match, `2MK` into a forward-forward during its cancel window plays
  `ATK_CTA_DASH` on frame 9 and costs three bars — the runtime already supported
  this once the triggers were priced; nothing new was needed for it.
- `sf6 verify` runs eighteen move checks. The original five are unmoved:
  93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 197 tests pass.

## Not settled

- **A third of the population is one or two frames out**, all in the same
  direction. Cancel timing within the active window is the obvious suspect and
  was not pursued.
- **The parry rush is not modelled separately.** Its freeze is 11 and its cost
  half a bar, and the sim only ever uses the `DriveDash` value.
- **The rush's own travel is unused in the sim.** It is 381 units over frames
  13–57 in the dump, so a rush cancel closes distance the sim does not account
  for — which may be exactly what the missing frames are about.
- **Nothing models what the rush cancels *into*.** A real Drive Rush cancel is
  followed by another move, and the advantage FAT publishes is for the rush
  itself.
