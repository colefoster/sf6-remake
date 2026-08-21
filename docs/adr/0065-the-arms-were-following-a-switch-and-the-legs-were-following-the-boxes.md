# ADR 0065 — The arms were following a switch, and the legs were following the boxes

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0058](./0058-the-limbs-were-furniture.md),
  [ADR-0059](./0059-there-are-no-bones-and-the-ground-is-the-clock.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md),
  [ADR-0063](./0063-the-jump-was-a-standing-figure-on-an-elevator.md),
  [ADR-0064](./0064-the-audit-had-no-clock.md)

## Context

ADR-0064 built `npm run pose:motion` and left 1,399 flagged frames of 456,993.
Its three `*-snap` rows — `stance-snap` 497, `stand-snap` 170, `fade-snap` 51 —
are 718 frames and the largest coherent cluster in it, and ADR-0064's own "Not
settled" named the mechanism: *"the dump's stance label is a step function and
`attitudeOf` follows it in one frame; a real fighter takes several to fold into a
crouch."*

That reading is half right, and the half that is right is not the half it names.
Nothing was eased until the flagged pairs were instrumented, because ADRs 0049
through 0064 are mostly a record of airtight reasoning about the wrong quantity.
So the first thing built here was a decomposition, not a settle.

## Findings

### The invented hip ratio does not move at all

A resting foot's position **measured against the hips** — which is what
`pose:motion` measures — has a closed form. `poseOf` puts the resting foot at
`footY` and the pelvis at `footY + (neckY − footY) · K`, so the foot relative to
the hips is exactly `−stand`, and `stand = (neckY − footY) · K`. `K` gathers
everything invented in it: `HIP_OF_NECK`, `build.leg`, and `attitude.sink`.

Every flagged leg pair on the roster, split by which factor moved:

| | flagged leg pairs | `K` moved | `neckY − footY` moved |
|---|---|---|---|
| `stand-snap` | 157 | **0** | 157 |
| `stance-snap` | 245 | **0** | 245 |
| `fade-snap` | 38 | **0** | 38 |
| `limb-teleport` | 3 | **0** | 3 |

`K` changes on **not one frame in 443**. The whole of the step is `neckY` and
`footY`, and those are two hurtbox edges: the body key's top and the leg key's
bottom, or on an airborne frame the one-box figure's crown and sole (ADR-0063).
Easing a resting foot is easing the sole of a hurtbox. That is the thing this
work was told not to do, and it is 52% of the cluster it was pointed at.

### The classifier that flips is `airborne`, and it is three step functions ORed

`pose:motion`'s attribution is *ordered* — the stance label is checked first, so
a pair where the label changed is charged to `stance-snap` whatever else changed
with it. Asking instead which of `poseOf`'s own switches flipped:

| category | pairs | `airborne` flipped | `walking` flipped |
|---|---|---|---|
| `stance-snap` | 497 | **479** | 147 |
| `limb-teleport` | 137 | **137** | 60 |
| `stand-snap` | 170 | **75** | 8 |
| `fade-snap` | 51 | **32** | 7 |
| all four | 855 | **723 (84.6%)** | 222 |

(The stance label is not a column because it cannot be one: the tool charges a
pair to `stance-snap` *because* the label moved, so that column would read
497/0/0/0 by construction. That is the point — the label is the first thing
asked, so it takes the credit for everything that happens alongside it.)

And on the 412 pairs whose moving limb is an **arm**, `airborne` flips on every
single one. `airborne` is

```
stance === 3 || Boolean(whole) || Boolean(arc && (arc[frame - 1] ?? 0) > radius)
```

— a `PoseStatus` range starting or ending, a box set becoming or ceasing to be
one rect, and a **threshold crossing on a continuous curve**. The third is not a
label stepping at all; it is a jump passing 17 units off the floor. The brief's
"the dump's stance label is a step function" is true and is not the loudest cause.

### The arms are pure invention and the legs are pure box

| | pairs | what moves the tip |
|---|---|---|
| arms | 412 (48.2%) | `attitudeOf`'s hand offsets — invented outright (ADR-0060) |
| legs | 443 (51.8%) | `neckY` and `footY` — hurtbox edges on 88% of them |

The arm case is arithmetic. `attitudeOf` returns the **rear** hand at
`[0.33, −0.72]` of an arm's length grounded and `[−0.33, 0.18]` airborne: a
displacement of 1.12 arm-lengths, and Ryu's drawn arm is 41.5 units, so the hand
crosses **46.3 units in one frame** against a bound of 44.7 (0.30 of his
149-unit idle stature). It is the only step in `attitudeOf` big enough to flag,
and it flags 412 times.

For the legs, where `footY` and `neckY` came from on each side of the step:

| | both ends on a box | one end held over |
|---|---|---|
| `stand-snap` | 157 | 0 |
| `stance-snap` | 201 | 44 |
| `fade-snap` | 21 | 17 |
| `limb-teleport` | 1 | 2 |
| | **380 (85.8%)** | 63 (14.2%) |

The commonest single transition is `leg → whole`, 132 of them: the grounded
three-box stack is replaced by ADR-0063's one-box airborne figure and the drawn
sole moves from the leg key's floor to the leaping body's underside. Both are
the dump's.

### What easing the sole would have cost

Measured, on ADR-0060's own currency. Every resting foot on the roster, against
the vertical span of the live hurtboxes at the figure's own footprint:

| the resting foot | outside every hurtbox | worst |
|---|---|---|
| as drawn — on the box's own sole | 7,207 of 347,093 (2.08%) | 217 |
| eased towards it at 0.34 a frame | **30,889 (8.90%)** | 237 |

23,682 extra frames of a foot drawn where nothing in the game can touch it, to
remove roughly 400 pops. That is the trade ADR-0060 refused for the arm and
ADR-0063 refused for the head, and it is refused again here.

### `MergeKey`'s timing is real, and it is not this window

`MergeKey`'s curve *values* are dead and were not re-investigated. Its frame
range survives, and the reading holds up:

| | |
|---|---|
| actions carrying a `MergeKey` | 6,867 of 9,487 |
| entries | 8,451 |
| `_StartFrame >= MarginFrame` | 6,414 (**75.9%**) |
| `_EndFrame − _StartFrame` | p10 3 · median 12 · p90 28 · max 190 |

So it really does look like a return-to-neutral settle window sitting in the
recovery. It is **not this settle's window.** Of the 855 pairs `pose:motion`
flags, 400 are on actions that carry no `MergeKey` at all, and of the remaining
455 only **28 (6.2%)** fall inside one; 365 are before every window the action
has. The game blends at the end of a move. The figure's classifiers flip
wherever the boxes and the labels happen to change, which is mostly a launch or a
touchdown in the middle. Wiring a per-action duration from a window that does not
contain the frame would be a number that does not mean what its name says, so
the settle rate is a named constant and this paragraph is why.

### The walk gait on a landing: every term of the test was true

`plant-slide`'s 165 frames over 18 actions are all airborne specials touching
down. `walking` was `standing && !airborne && Boolean(velocity.x) && travel >
nominal`, and on Cammy's `SPA_CANNONSTRIKE_LAND`:

| term | value | so |
|---|---|---|
| `standing` | true | she is on the floor |
| `!airborne` | true | she has landed |
| `velocity.x` | −11 | ADR-0040: the speed left over past the authored frames |
| `travel > nominal` | 339 > 62 | a dive covers a great deal of ground |

**No term is wrong.** What the test has no term for is whether the travel is a
*walk* rather than a distance — and the dump answers that exactly. A walk's
`motion.x` advances by its own `velocity.x` on every frame:

| of the 362 actions the gait fired on | max per-frame deviation from `velocity.x` |
|---|---|
| 185 `BAS_FORWARD` / `BAS_BACKWARD` | **0.00** |
| Blanka's 19 rolls | 0.00 |
| Kimberly's 4 super dashes | 0.01 |
| the 18 `plant-slide` offenders | 1.0 to 3.5 **times their own speed** |
| the other 136 | 0.80 upward |

Sorted, the whole roster's deviations run `0.00 … 0.01, 0.80, 1.64, …`. The
tolerance below sits in that gap and is float slop, not a threshold.

Two further things fall out of Cammy's curve, which runs `0, +7, +12, +15, +16,
+15, +12, +7, 0, −9, … −339`. It **reverses direction inside the action**, as 15
of the 18 offenders do — and since `phase` is keyed to `Math.abs(origin.x)`
(ADR-0064's fix for the back walk), her legs ran the gait *backwards* for four
frames while she was landing. And her 40-frame landing covers 339 units at 8.5 a
frame against Ryu's walk at 4.7, so a distance test could never have separated
them: she covers more ground than a walk, faster.

### A feedback path, found while pinning the rule

The test that a derived limb is never interpolated failed at first, by 1.2 units,
on Ryu's specials. `attitude.sink` drops the pelvis; the pelvis is read back
twice — the height test that calls a hitbox a kick rather than a punch measures
against `hips.y`, and `extremity` picks which end of a tall hurtbox is the tip by
which end is further from the limb's root. So easing `sink` let a settling
invention change what the boxes are read *as*. `sink` is excluded from the settle
for that reason, at no cost: it is 0.02 on a guard and 0.03 on a reaction, both
picked from the action's name, and 0 in every stance the label distinguishes, so
it never steps inside an action anyway.

## Decision

**The attitude settles; nothing else does.** `Pose` carries the attitude
actually drawn, and each frame it closes `SETTLE = 0.34` of the way onto
`attitudeOf`'s target — half the distance in two frames, 90% in six. Every number
it moves is `attitudeOf`'s and every one of those is invented (ADR-0060), which
is the entire licence. The eased hand goes through the honesty cage exactly as
before.

**A new action is a cut and takes its attitude outright.** The game changes
animation clip there and so does the figure. It also keeps the one transition
that has to read instantly reading instantly — the frame a fighter starts being
hit (ADR-0057) — and it is not graded either way, since `pose:motion` walks each
action from the idle pose and never compares the entry.

**`sink` is taken outright rather than settled**, for the feedback above.

**A walk is an action whose travel curve *is* its own walking speed.** `walking`
gains `paced(action)`: every step of `motion.x` within `PACE_SLOP = 0.05` of
`velocity.x`, memoised because it is a property of the action and not of a frame.
It replaces the `Boolean(velocity.x)` term, which it subsumes.

**No derived geometry is eased, anywhere.** Stated plainly, since it is the
load-bearing constraint:

- a limb with `derived === true` is drawn where the boxes put it, on the frame
  they put it there, and `tests/geometry.test.ts` pins that no attitude the
  settle can ever reach — the four corners of the convex hull of `attitudeOf`'s
  five cases — moves a derived tip by so much as a float;
- the **sole**, the **crown**, the **neck**, the **axis** and the hurtbox edges
  the resting foot and the shoulder line hang off are untouched and still step
  in one frame when the dump steps;
- the snap onto a hitbox on an attack's first active frame is still excluded by
  rule in `pose:motion` and still snaps in `poseOf`.

What is invented and now settles: the **lead and rear hand offsets**, and the
**stance width multiplier**. What is invented and deliberately does not: the
**pelvis height**, the **stance width itself**, the **bone lengths**, **where a
joint folds**, the **gait's amplitude**, the **tuck**, the **stagger** and the
**recoil** — all unchanged from ADR-0060 and ADR-0063.

## Consequences

- `npm run pose:motion`. **Nothing grew; one category went to nothing.**

  | | ADR-0064 | here |
  |---|---|---|
  | `stance-snap` | 497 | **208** |
  | `limb-jerk` | 379 | **171** |
  | `stand-snap` | 170 | **155** |
  | `plant-slide` | 165 | **0** |
  | `limb-teleport` | 137 | **5** |
  | `fade-snap` | 51 | **38** |
  | `gait-blind` | 0 | 0 |
  | **total** | **1,399** (0.31%) | **577** (0.13%) |

  The arms are gone: 412 flagged arm pairs across the four displacement rows
  become **1**, and `limb-jerk` splits 120 arms / 259 legs before and **17 / 154**
  after. `limb-teleport` 137 → 5 is the same fact read a different way — it was
  the row for a step with nothing in the dump changing underneath it, which is
  exactly what an attitude flip is.

- `npm run pose:audit` is **byte-identical**: `axis-pop` 497 · `reach-overlong`
  328 · `spine-squashed` 114 · `limb-overlong` 103 · `head-detached` 71 ·
  `spine-inverted` 60 · `foot-above-hips` 60 · `legs-stretched` 0, 1,233 frames.
  Nothing here changes a pose on a frame considered alone.

- **The honesty cage did not loosen.** ADR-0060's and ADR-0063's measurement,
  every invented hand, elbow, knee and foot against every live hurtbox, 2,683,930
  points:

  | | ADR-0063 | here |
  |---|---|---|
  | outside every hurtbox horizontally | 555 | **554** |
  | outside every hurtbox vertically | 22,807 | **22,458** |

  Both fell. The settled hand spends a few frames between two invented positions
  and both ends of that journey were already inside the box.

- `Pose` gains `attitude` and `action`. The second is how a cut is told from a
  classifier flip inside one animation; it is the action's own id and nothing
  else reads it.

- Three tests added — the derived-limb pin, the settle-and-cut, and the walk gait
  not running on Cammy's landing — and two counts re-baselined in
  `tests/pose-motion.test.ts` with the reason. **284 pass**, up from 281.

- `web/play.js` rebuilt (`node scripts/build-play.mjs`).

## Not settled

- **The 405 remaining leg pairs are the dump's box stack stepping**, and this ADR
  says they should stay that way. 358 of them have a hurtbox edge on both sides
  of the step; the commonest is a fighter leaving the ground and the grounded
  three-box stack being replaced wholesale by the one-box airborne figure. There
  is no honest ease available: the two candidates are the sole, which is a
  hurtbox edge, and the hip ratio, which would hide the pop from a hips-relative
  audit while leaving the foot popping on screen — gaming the grader.
- **48 of the 406 have a held-over `footY` on one side**, which *is* invention
  (ADR-0050's hold-over). 40 of them run from held-over into a box, so easing
  would still mean drawing a foot short of the box it is arriving at; 8 have
  invention at both ends and could in principle settle. Eight frames was not
  worth another state field.
- **`SETTLE` is a constant and the dump does not have a better one**, for the
  reason measured above. If a future reading of `MergeKey` finds a window that
  brackets a *classifier* flip rather than an action's recovery, this is the
  number it should replace.
- **`extremity` still picks which end of a tall hurtbox is the tip by measuring
  from the invented hip.** Cutting `sink` out of the settle stops the *settle*
  reaching it, but the pelvis is invented per-frame regardless, so the choice of
  which box edge is a foot still depends on a number this project made up. It is
  a pre-existing coupling, it is now bounded, and it is not fixed.
- **`limb-jerk` is 154 legs**, which is the same box motion as the rows above
  read as an acceleration rather than a speed. It will not fall while they do
  not.
- **Blanka's 19 rolls still count as walks** — a roll is constant-speed ground
  travel and passes `paced` exactly. They are 19 of the 208 gaited actions and
  drawing a step cycle under a ball is a guess, not a lie; it was left alone.
- **`airborne` is still three step functions ORed together**, one of them a
  threshold on a continuous arc. The settle hides what it does to the arms; it
  does not make the switch itself any less abrupt, and anything else keyed to it
  later will step the same way.
