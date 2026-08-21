# ADR 0064 — The audit had no clock, so a walk could run backwards under it

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0051](./0051-the-page-drives-from-a-script-and-the-parts-stop-lying.md),
  [ADR-0058](./0058-the-limbs-were-furniture.md),
  [ADR-0059](./0059-there-are-no-bones-and-the-ground-is-the-clock.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md)

## Context

`npm run pose:audit` is seven negative predicates and **every one of them reads a
single frame**: hips above the neck, a head off the shoulders, an arm longer than
the body. That is the right shape of check — the figure has no ground truth to
test against (ADR-0049), so the only honest question is whether a pose is wrong
on its face — and it has converged: **1,233 flagged of 456,993 frames, 0.27%**,
with every residual named in ADR-0058 and ADR-0060.

Nothing in the project has ever looked at Δt, and the cost of that came due in
`5abdb75`. Two faults in the walk gait shipped and were fixed there:

- **the reversed back walk** — `phase` came off the *signed* `origin.x` and went
  through `Math.cos`, which is even, so a retreating fighter traced the
  byte-identical leg cycle to an advancing one;
- **the moonwalk** — the lift was on `Math.sin(th)` rather than `-Math.sin(th)`,
  so the planted foot slid forwards under a fighter walking forwards, in both
  directions.

One of them was reported from play after months. The other was found only while
probing the first. **`pose:audit` was unchanged through the bug and through the
fix**, and 275 tests were green on both sides of it, because at no single frame
was anything about the figure wrong. The check needs a second axis.

## Findings

### The threshold is the dump's own limb speed

A temporal predicate is worth exactly its threshold, so the threshold is not
chosen. Every limb tip was tracked frame to frame across the roster and split by
whether it sits **on** a hurtbox (`derived`, the game's animation) or is this
project's invented resting pose. Displacement is measured **hips-relative** and
as a fraction of idle stature — `poseOf` bakes the action's own motion curve into
the pose, so A.K.I.'s `SPA_Kyosyutotu` lifts the whole figure 59 units between f7
and f8, and reading a tip in action space charges that launch to the limb.

| tip, one frame to the next | n | p90 | p99 | p99.9 | max |
|---|---|---|---|---|---|
| invented (resting pose) | 1,743,710 | 0.000 | 0.036 | 0.242 | 0.99 |
| derived (on a hurtbox) | 44,695 | 0.000 | **0.302** | 0.788 | 1.21 |
| the box appearing or vanishing | 6,715 | 0.772 | 1.211 | 1.693 | 2.33 |

So **0.30 of stature per frame** is the 99th percentile of what the game's own
authored boxes do, and it is the bound for both the step and the second
difference. A limb this project invented has no business outrunning the limbs
Capcom drew.

### The snap onto a hitbox is excluded by rule, and it is most of the movement

The third row above is the honest snap, and it dwarfs everything else: a median
of 0.45 stature, up to 2.33. **1,679 of the roster's 2,412 actions that carry a
hitbox — 70% — have no outboard hurtbox at all before their first active frame**;
the game boxes the follow-through and never boxes the anticipation. So easing a
fist toward its hitbox during startup would draw an extended limb on frames where
nothing is active, which in a training room is a lie about startup.

Every pair where a limb's `derived` flag *changes* is therefore excluded
outright: **3,351 snaps onto a box and 3,364 off one**. The tool grades the
invention, and both the pop out and the retraction back are the dump's. This is
also why a `retraction-snap` category was considered and not built: it is the
same 3,364 pairs under a different name.

### Cycle reversal cannot be caught one frame at a time, and that is the finding

The obvious predicate for the back walk is directional — a planted foot must
slide against the travel, a swinging one must gain ground with it. Reverting the
fault and reading the trajectories out shows that **it passes**. Ryu's back walk,
with the fault in:

| | leg tip x, f1 → f24 | lifted on |
|---|---|---|
| fixed back walk | +14.5 → −37.7 (with the travel) | f2–f24 |
| faulty back walk | +37.5 → −14.5 (with the travel) | f2–f24 |

Reversing the travel reverses what "against" means, so the faulty cycle stays
internally consistent — it is the forward cycle with its lift half a period out,
which is a coherent walk in the other direction. Every per-frame relation holds.
What is actually wrong is a *symmetry*: the back walk and the forward walk are
the same cycle.

The predicate therefore compares the action against **itself, mirrored**. The
action is re-posed with `motion.x`, `travel.x` and `velocity.x` negated and
nothing else touched — every hurtbox, hitbox and stance range is the dump's — and
a gait that produces the byte-identical leg trajectory both ways is `gait-blind`.
The same trick gates it: an action whose legs move when its travel is *removed*
is an action with a gait, which is how the 362 gaited actions are found without
reproducing `poseOf`'s own `walking` test, and how a jump — which covers as much
ground as a walk and has no floor to step off — stays out of the count.

### Validation against the two known faults

Each fault was reverted in a scratch copy of `render.ts` and the audit re-run.

| tree | `gait-blind` | `plant-slide` | total flagged |
|---|---|---|---|
| `5abdb75` (fixed) | **0** | 165 in 18 actions | 1,399 |
| fault 1 only: signed `origin.x` through `Math.cos` | **362 in 362 actions** | 174 in 26 | 1,756 |
| fault 2 only: lift on `+Math.sin(th)` | 0 | **14,692 in 326 actions** | 15,925 |
| `5abdb75^`, the real pre-fix tree | **362** | **14,673 in 317** | **16,255** |

`gait-blind` flags *every* gaited action on the roster the moment the sign is
lost, which is correct: the fault was in one expression that all 362 run through.
`plant-slide` goes up 89-fold. The tool would have caught the shipped bug at a
glance, and it catches the one nobody reported just as loudly.

### The roster, graded

`npm run pose:motion`, on `5abdb75`:

| category | frames | actions | first offender |
|---|---|---|---|
| `stance-snap` | 497 | 360 | A.K.I. `SPA_Kyosyutotu` f46 |
| `limb-jerk` | 379 | 164 | A.K.I. `SPA_Kyosyutotu` f9 |
| `stand-snap` | 170 | 82 | A.K.I. `ATK_4HK` f11 |
| `plant-slide` | 165 | 18 | Akuma `SPA_HYAKKI(6)` f23 |
| `limb-teleport` | 137 | 106 | Akuma `SPA_TATSUMAKI_EX` f36 |
| `fade-snap` | 51 | 36 | A.K.I. `SPA_Kyosyutotu(1)` f21 |
| **total** | **1,399** | | of 456,993 frames walked, **0.31%** |

The four `*-snap` rows are one teleport apiece, charged to whatever in the dump
changed underneath it that frame: the stance label flipping standing to
crouching, a hurtbox going out, the held hip-to-foot distance re-seating on a
landing. `limb-teleport` is what is left when nothing in the dump changed at all.

### The attacks really are where it is, but not the ones expected

| family | flagged | frames | rate | share |
|---|---|---|---|---|
| `SPA_*` and the supers | 1,083 | 140,414 | 0.77% | **77.4%** |
| `ATK_*` | 175 | 99,388 | 0.18% | 12.5% |
| other | 128 | 42,990 | 0.30% | 9.1% |
| `BAS_*` | 9 | 65,439 | 0.01% | 0.6% |
| reactions | 4 | 108,762 | 0.004% | 0.3% |

**The claim that attacks carry ~90% of the jank is right to the point: 89.9%.**
It is wrong about which attacks. Normals are 12.5% of it and the quietest family
on the board bar the walks and the reactions; the specials and supers carry six
sevenths, at four times a normal's rate per frame. That is the family with the
launches, the dives and the rolls — the actions whose stance label and whose box
set both change mid-animation — and it is where a fix would pay.

The 646 reaction actions flag four frames between them, which is the expected
answer and a check on the tool: they hold one static hurtbox layout for their
whole duration (ADR-0059), so there is nothing in them to move.

## Decision

**`npm run pose:motion` is the temporal twin of `npm run pose:audit`**, same CLI
shape, same output format, same negative methodology, same 456,993 frames walked
from the same idle pose. Six categories, each earning its place:

- `limb-teleport` — a tip crossing more than 0.30 of stature in one frame with
  nothing in the dump changing under it;
- `stance-snap`, `fade-snap`, `stand-snap` — the same displacement, charged to
  the stance label, the box set or the held stance length that changed that
  frame;
- `limb-jerk` — the same bound on the second difference, on pairs not already
  counted as a teleport, which is the limb that ramps and then stops dead;
- `gait-blind` — a gait that traces one cycle whichever way the fighter travels;
- `plant-slide` — the lower of the two feet moving *with* the travel.

**Three categories were dropped.** `swing-reversed`, the other half of the
moonwalk, fires on exactly the frames `plant-slide` does and adds nothing: a
planted foot sliding is the one with a physical ground truth under it, so it is
the one kept. `axis-snap` survived the move to hips-relative measurement with a
single hit on the whole roster and is folded into `limb-teleport`. A
`box-teleport` row — both frames on a box, the box moved a long way — is
tautological against a threshold set at the 99th percentile of that same
population, and in any case grades Capcom's animation rather than this project's
invention.

**The counts are locked by `tests/pose-motion.test.ts`**, the way ADR-0051's are
locked by the audit being re-run. `motionAudit()` is exported and the printer is
behind a main-module guard so the test can read the numbers without walking and
printing the roster twice.

## Consequences

- A gait fault of the class that shipped in `5abdb75` now fails a test rather
  than waiting for someone to notice while playing.
- `pose:audit` output is byte-identical: nothing about how the figure is drawn
  was touched here. 281 tests pass, up from 275.
- The residual is 1,399 frames, 0.31%, against the static audit's 1,233 and
  0.27%. The two numbers are of the same order, which was not obvious in advance
  — a prototype that measured tips in action space and did not exclude the snap
  found 2,563 teleports across 826 of 1,311 attack actions, 63%, and almost all
  of that was the dump's own arcs and the honest pop onto a hitbox.

## Not settled

- **The 165 `plant-slide` frames are a real finding, not an honest residual.**
  All 18 actions are airborne specials that land — Cammy's `CANNONSTRIKE_LAND`
  ×6, Akuma's `HYAKKI` dive ×3, Kimberly's `SpraySmoke_M` ×4 — and what they have
  in common is that `poseOf`'s `walking` test comes out true on their touchdown
  frames, so the *walk* gait runs on a landing. Fixing that is a `render.ts`
  change and out of scope for a grading tool.
- The 137 `limb-teleport` frames across 106 actions are concentrated in
  A.K.I.'s slide, Akuma's air fireballs and Blanka's rolls: actions whose
  honesty cage (ADR-0060) changes shape abruptly, dragging the clamped invented
  hand with it. Whether the cage should be allowed to move a limb faster than the
  game moves one is a question for the cage, not for the audit.
- `stance-snap` at 497 frames over 360 actions is the largest row and the most
  arguable. The dump's stance label is a step function and `attitudeOf` follows
  it in one frame; a real fighter takes several to fold into a crouch. Nothing
  here says whether the figure should interpolate — only that it does not, and
  that it is visible on 360 actions.
- Nothing in this tool grades the *hitbox* limbs (`Pose.limbs`), which come and
  go by the frame and have no stable identity to track from one to the next.
