# ADR 0059 — There are no bones, and the ground is the clock

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0050](./0050-the-pushbox-is-the-axis-and-a-far-box-is-a-limb.md),
  [ADR-0058](./0058-the-limbs-were-furniture.md)

## Context

ADR-0058 closed the extended limb and left the larger half open: **90.8% of
frames still drew one invented resting pose** — every idle, every walk and jump,
and all 646 reaction actions. The walk holds a single pose because
`BAS_FORWARD_Loop` moves no hurtbox on any of its 114 frames.

`extract-geometry.mjs` reads about ten of the raw dump's top-level keys and
never touched `MotionKey`, `MergeKey`, `StatusKey` or `SwitchKey`. Both of
ADR-0058's wins came from data the extractor was silently dropping, so the
dump was asked again before anything else was invented.

## Findings

### There is no pose data, and now it has been looked for properly

Every typed key list across all 24 fighters' `moves_dict.json` — 46 of them over
9,487 actions — was enumerated and the four named ones opened:

| key | actions | what it holds |
|---|---|---|
| `MotionKey` | 8,732 | `MotionID`, `MotionType`, a start and an end frame, and the clip's name (`esf001_BAS_FORWARD_Loop`). A clip id and a range. |
| `MergeKey` | 6,867 | `FCurveL` / `FCurveU`, a pair of **blend weight curves** for the lower and upper body, with no channel and no target. |
| `StatusKey` | 5,743 | State-machine fields — `ActionStatus`, `JumpStatus`, `ActionDir`, `LandingAdjust` — and one that describes the body: `PoseStatus`. |
| `SwitchKey` | 4,466 | `SystemFlag` / `OperationFlag` bitfields. |

This confirms ADR-0049's "clip names, not bones" against the actual bytes rather
than against a guess. Three more candidates were opened and ruled out on the way:

- **`BonePlaceKey`** (245 actions) is the only thing in the dump with the shape
  of animation — a per-frame `PosList` on one `Axis`. It is a *thrown partner's
  root* through a throw (`NGA_4`, `NGA_6` and the command grabs), not a skeleton,
  and 245 of 9,487 actions is four per fighter.
- **`UniqueCollisionKey`** (244) is projectile bookkeeping; **`OtherCollisionKey`**
  (473) is the parry / reflect / atemi collision. Both are boxes, neither is a limb.

**There are no bone transforms anywhere in the dump.** That is now a measured
result and not an assumption, and it will not change without a different dumper.

### Three things in the dump were never being read

Asking that question turned up what the figure *can* be keyed to.

**`motion.x` — already extracted, never read by the figure.** ADR-0058 checked
`Motion` and dismissed it: "a displacement curve for the whole fighter — where
the body travels, never where a foot is." True, and it is still the only per-frame
quantity a walk has. Ryu covers 4.7 units a frame and 531.1 over the loop; the
roster runs from Dhalsim's 2.8 to Akuma's 5.2, and the back walks from -2.5 to
-3.5. A gait stepped off *distance* rather than off a frame counter is different
for every fighter without a constant being chosen for any of them.

**`motion.y` — the jump's own arc.** A neutral jump carries **only a body box**,
65-185, unchanged from launch to landing: nothing in the hurtboxes says a jump is
happening. The arc says exactly where in the leap the fighter is, because the
climb rate is full at the launch and at the landing and zero at the apex.

**`PlData.Physique` — the only per-fighter proportions that exist.** `SizeU` is
210 on all 24 characters, the idle hurtbox stack is 166 tall on 21 of them, and
the derived figure comes out 149 tall on 20 — **Lily and Zangief draw at the same
size**. `Physique` carries `Arm`, `Leg` and `Height`, and it ranks the roster the
way the roster looks:

| | height | arm / height | leg / height |
|---|---|---|---|
| Lily | 135.7 | 0.85 | 1.01 |
| Chun-Li | 151.7 | 0.86 | 1.04 |
| Ryu | 157.1 | 1.03 | 1.00 |
| Blanka | 169.7 | **1.37** | 0.94 |
| Zangief | 194.3 | 1.16 | 0.94 |

(arm and leg as a ratio to the roster median.) Blanka and Zangief have the long
arms, Chun-Li and Kimberly the short ones, A.K.I. and Kimberly the long legs.

What it does **not** give is an absolute. `Leg / Height` runs 0.61 to 0.71, which
is far too high for a standing hip joint, and Ryu's `Height` of 157.1 sits
between his idle stack's neck (138) and its crown (166). These are bone chains in
some rest pose, not measurements of the standing body, so **only the ratio
between fighters is used**. `AdjustRatio` and `ConvertRatio` sit beside them and
are 1 on every axis of every fighter; they are dropped.

**`StatusKey.PoseStatus` — the action's own stance.** `1` standing, `2`
crouching, `3` airborne. It reads true against the actions whose stance is
already known from their names: of the 1,524 `ATK_*` actions carrying one, the
478 tagged `3` are the jumping normals and the 393 tagged `2` are the crouching
ones. It matters because **1,482 of the 2,622 reactions carry it**, and the
reactions are precisely where there is no limb box to read. 695 actions change
stance part way through — a jumping attack landing — so it is extracted as a
range list like every other key.

### The invention was feeding itself

A frame with no leg box holds its stance at the previous frame's hip-to-foot
distance (ADR-0050). That distance was being read back off the *drawn* foot. A
jump has only a body box, so every airborne frame tucked a leg that was already
tucked, and the legs wound into the hips over about fifteen frames. The same
feedback was reading the hold-over off a *kicking* leg.

## Decision

The resting pose stays invented and stays flagged, and it is keyed to those four
signals rather than to constants.

**A walk is a step per stride of ground covered.** The phase is `motion.x`
divided by a stride, and the stride is quantised so a whole number of them fits
the action's travel — a walk `Loop` restarts every 114 frames and a stride that
did not divide it would snap a foot on the wrap. The same clock drives a dash.
The *rate* is the dump's; the swing amplitude (0.35 of a stride) is picked by eye,
because a figure whose legs come out of a single hip point has no pelvis to widen
the V and a foot thrown the full half-stride reads as a lunge.

**A jump tucks in proportion to how fast it is climbing**, taken from the arc
itself rather than from `motion.velocity` — which is only the speed *left over*
where the authored frames run out (ADR-0040) and is absent on a jump that lands
inside its own action. Dhalsim's does, and read from `velocity` his legs never
tucked at all. The fold stops a head's radius short of the hips: an airborne leg
box can already sit within a few units of the torso.

**A fighter carries its arms differently guarding, being hit, crouching and
standing.** `attitudeOf` picks a fold, a tilt and a stance width from the
action's name and its `PoseStatus`. A block puts both hands in front, between the
fighter and the opponent; being struck throws both back, away from it. The
numbers are invented; which of the four applies is not.

**`Build` scales the resting pose by the fighter's own proportions**, as a ratio
to the roster median, so Blanka's arms hang 37% longer than the median and
Zangief stands 14% narrower than A.K.I.

**`Pose.stand` carries the hip-to-foot distance before the gait and the tuck**,
so the hold-over reads the stance and not the drawing. The invention is not
allowed to eat itself.

## Consequences

Over the same 456,993 frames ADR-0058 measured:

| what places the limbs | frames | |
|---|---|---|
| the boxes (a derived limb) | 37,646 | 8.2% |
| the action's stance or family | 117,841 | 25.8% |
| the jump's own arc | 29,834 | 6.5% |
| the ground a walk covers | 19,719 | 4.3% |
| **the bare resting stance** | **251,953** | **55.1%** |

**90.8% of frames on one invented pose is now 55.1%**, and all 646 reaction
actions — 108,762 frames, previously 0% — are keyed to something the dump says.

- `pose:audit`: **nothing grew.** `legs-stretched` **434 → 230** and
  `foot-above-hips` is unchanged at 60; the improvement is the `Pose.stand` fix,
  which was a real pre-existing bug rather than anything this ADR added.
  `axis-pop` 497, `spine-inverted` 494, `reach-overlong` 371, `spine-squashed`
  120, `limb-overlong` 119, `head-detached` 71 — all as ADR-0058 left them.
- The audit now runs with each fighter's own `Build`, so it measures what is
  drawn rather than a neutral figure.
- Seven new tests; one updated, where a rising Shoryuken's held-over stance is
  now also tucked because the action states itself airborne from frame 9. 264 pass.
- `geometry.json` gains `fighter.physique` and per-action `stance`.

## Not settled

- **The hips are too low, and there is now evidence for where they belong.** The
  figure puts them at the top of the leg hurtbox band — 54 of a 166-unit stack,
  36% of stature — which draws a long torso on short legs. `Physique.Leg / Height`
  says 0.61-0.71. Moving them is the largest visual improvement left, and it
  cannot be made honestly until what `Physique` measures is resolved. Raising the
  hips on an unresolved interpretation is exactly the kind of fudge constant this
  project treats as a smell.
- **55.1% of frames still hold one pose**, the idle among them. An idle has no
  travel, no arc and no stance change; there is nothing in the dump to key a
  breath to but the loop's own length.
- **The shoulders are still invented** (±0.55 of the pushbox half-width), as are
  every fold, tilt and stance width in `attitudeOf`.
- **`MergeKey`'s blend curves are a real signal that was not used.** They say
  which frames blend the upper body against the lower and how hard, which is a
  statement about the animation even without a channel. Nothing here reads them.
