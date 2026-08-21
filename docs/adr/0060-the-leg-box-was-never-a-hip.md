# ADR 0060 — The leg box was never a hip, and the arms had nowhere to hang

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0050](./0050-the-pushbox-is-the-axis-and-a-far-box-is-a-limb.md),
  [ADR-0058](./0058-the-limbs-were-furniture.md),
  [ADR-0059](./0059-there-are-no-bones-and-the-ground-is-the-clock.md)

## Context

ADR-0058 derived the extended limb from the boxes and ADR-0059 keyed the resting
one to the walk's ground, the jump's arc and the action's stance. Both were
judged on contact sheets. Watched **in motion** — 47 seconds of real play, 88
frames at `.scratch/figure-redesign/frames/` — the verdict was that the arms and
the legs look terrible, and the footage says why in a way a still does not.

ADR-0059 closed with *"the hips are too low, and there is now evidence for where
they belong … it cannot be made honestly until what `Physique` measures is
resolved."* `Physique` is still unresolved. The hips have moved anyway, for a
different reason: the thing they were resting on turned out not to be a hip.

## Findings

### What the motion shows that the sheets did not

Three things only read at 60fps.

- **The arms are the silhouette.** Drawn 84 units long on a 166-unit Ryu and
  bowed symmetrically outwards, they framed the torso as a pair of parentheses
  and swung wider than anything else on screen. On a still that is a detail; in
  motion it is the fighter's outline and it reads as an ape.
- **The walk is a stance opening and closing, not steps.** Both legs came out of
  one point, so the gait had nothing to rotate about and the only visible change
  over a stride was the gap between the feet.
- **A struck fighter draws one arm.** ADR-0059's `DMG` case sends both hands the
  same way and separates them by 7% of an arm's length vertically. At the scale
  a hit is watched, that is one line.

### The figure's proportions, measured

Idle pose, all 24 fighters, in game units. `shoulder / head` is the drawn
shoulder span over the drawn skull's diameter; `arm / leg` is the drawn resting
arm's two segments over hip-to-foot.

| | hips, % of stature | shoulder / head | stance, units | arm / leg |
|---|---|---|---|---|
| ADR-0059 | **30.3 – 32.5** | 1.07 – 1.48 | 30 – 39 | **1.29 – 2.16** |
| here | 50.8 – 55.5 | 1.29 – 1.69 | 49 – 63 | 0.39 – 0.63 |
| a human body | ~53 | ~2.1 | — | ~0.75 |

Ryu's shoulders were 36 units apart and his skull 34 across, so the two arms and
the spine met the head at one point. His arms were half again as long as his
legs.

### The leg/body hurtbox boundary is a hit height, not a joint

This is the finding that lets the hips move. The boundary was being read as the
hip joint (ADR-0050: *"the leg union's top for the hips"*). Compare the standing
and crouching stacks, which 21 of the 24 fighters share exactly:

| | leg box | body box | head box | boundary / stack |
|---|---|---|---|---|
| standing | 0 – 54 | 54 – 138 | 132 – 166 | 54 / 166 = **32.5%** |
| crouching | 1 – 41 | 41 – 87 | 87 – 119 | 41 / 119 = **34.5%** |

The boundary keeps its fraction of the silhouette when the fighter folds. That
is what a *hit height* does — the line between what a low reaches and what a mid
reaches stays where it is on the body. A hip joint does the opposite: crouching
drops the pelvis to roughly half its standing height while the head comes down
by less than a third. So the boxes do not carry a hip in either pose, and never
did; the figure was drawing an invented hip and calling it derived.

### An invented extremity was being drawn where nothing could hit it

`poseOf` was run over every action of every fighter (60 frames each, 1,344,077
limb-frames) and each **invented** hand and foot tested against the horizontal
span of every live hurtbox that frame:

| | outside every hurtbox | worst |
|---|---|---|
| ADR-0059 | **102,831 of 1,344,077 (7.7%)** | 52 units, Blanka `SPA_ROLLING_F_Loop(11)` |
| here | 283 (0.02%) | 33 units, Jamie `SAA1_BREAKIN_Y2` |

Ryu's whole silhouette is inside ±40 on every frame of his walk. A resting hand
at ±44 and a striding foot at ±59 are body parts nothing in the game can touch,
in a room whose whole purpose is showing what is hittable. The 283 that remain
are frames where *every* box of every part is out on a limb, so there is no cage
to clamp to.

### The bend was proportional to the reach, which is backwards

`bendOf` offset the joint perpendicular by 16% of the root-to-tip distance,
capped. So a hand near its own shoulder drew a nearly straight stick and a limb
at full stretch drew the biggest kink — the opposite of how a limb works, and
the reason Dhalsim's 361-unit reach needed a cap bolted on in ADR-0058 to stop
its elbow sagging 57 units off the line.

## Decision

**The pelvis is invented, and it says so.** It sits at 0.638 of the neck's own
height above the foot, which is the hip joint at 0.53 of stature on a body whose
neck is at 0.83 — ordinary anthropometry, imported from outside both dumps, and
named as constants in `render.ts` so the invention is visible rather than buried
in an expression. It is *not* keyed to `Physique.Leg`, which is still an
unresolved bone chain; the only thing `Physique` does here is tilt the hip
height by half its per-fighter ratio, so A.K.I. stands 5% higher on the leg than
Zangief instead of 16%. The same lerp folds the hips down in a crouch for free,
to 64% of their standing height.

Drawing there is honest against the boxes as well as about itself: Ryu's pelvis
at 88 is inside his body hurtbox (54–138), and the thigh above the leg key is
hittable by ADR-0058's own rule that the hit test does not care which part a box
was tagged to.

**The figure has a shoulder line and a pelvis line**, drawn between the roots of
each pair, and both are spread on the **body hurtbox's** own width rather than
the pushbox's — ±40 on Ryu, ±46 on Marisa and Blanka, ±49 on Zangief. The body
box is the authored width of a torso; the pushbox is how close two fighters may
stand. The fractions of it (0.55 for the shoulders, 0.30 for the pelvis) are
invented.

**The two arms are placed separately.** `Attitude` carries a `lead` and a `rear`
hand offset instead of one fold and one tilt, so a guard is a high fist and a low
one rather than two lines on top of each other, and a struck fighter throws one
arm back high and drops the other behind the hip. Every number in it is invented;
which of the five cases applies is still the action's name and its `PoseStatus`.

**Both joints are solved, not offset.** `jointOf` places an elbow or a knee where
a two-bone chain of the fighter's own length has to fold to reach the tip. A
limb whose hand is near its shoulder folds hard; one at full stretch is straight;
one reaching further than the chain is long is drawn straight with a token bend
so it does not read as a beam. The bone length comes from `Build.stature`, the
fighter's own idle stack, because how long an arm is is a property of the body
and not of the pose — the same correction `pose:audit` had to make in ADR-0058.

**An invented hand, elbow or foot is caged inside the fighter's own hurtboxes.**
This is the load-bearing rule. It is why the arm is drawn at 0.25 of stature
rather than the 0.37 a body has: a 61-unit arm on Ryu can never extend inside a
±40 chest, so it is always folded double and its elbow sticks out further than
his torso. The short arm is a compromise with the box and is recorded as one.
It is also why a walking fighter now brings its feet **in** — the stance narrows
to 45% while walking so the stride has somewhere to go; at full stance the swing
saturated against the cage and both feet sat on the box edge for most of the
cycle, which is a gait that does not move.

**Forearms and shins are drawn thinner than upper arms and thighs**, so a bend
reads as a joint rather than as a kink in a wire.

Unchanged: which limbs the boxes place and where they place them (ADR-0058),
the derived/invented colour rule, the axis, the head, the fade, the hold-over,
the jump's tuck and the walk's clock.

## Consequences

- `pose:audit`, over the same actions. **Nothing grew, five categories shrank:**

  | | ADR-0059 | here |
  |---|---|---|
  | `axis-pop` | 497 | 497 |
  | `spine-inverted` | 494 | **60** |
  | `reach-overlong` | 371 | 340 |
  | `legs-stretched` | 230 | **0** |
  | `spine-squashed` | 120 | 114 |
  | `limb-overlong` | 119 | 103 |
  | `head-detached` | 71 | 71 |
  | `foot-above-hips` | 60 | 60 |

  `spine-inverted` **494 frames over 9 actions → 60 over 3**, and the 3 that
  remain are Blanka's `ATK_5MK` and its two twins, the somersault ADR-0058 left
  standing as honest. The rest were the old hips: the spine ran neck-to-*leg-box
  top*, so any action whose leg key climbed above its body key reported an
  inverted spine without the fighter being upside down — Akuma's `SPA_ZANKU_Ex`
  alone is 56 of them, and it is now clean. `legs-stretched` **230 → 0** the same
  way. Both thresholds are relative to the idle pose, so both scales moved with
  the pelvis; what improved is that the test now measures a foot against a hip
  instead of against a hit height.

- Two tests added — the pelvis (its height, its box, and that the legs root on
  it) and the cage — and one extended, to pin that a guard and a reaction each
  draw *two* hands more than a head's radius apart. Two updated where the stance
  width changed, with their comments. **266 pass.**
- `Build` gains `stature`, the idle hurtbox stack, derived from the boxes.
- Before and after sheets for Ryu, Zangief and Chun-Li are at
  `.scratch/figure-redesign/before.png` and `after.png`.

### What in the figure is invented, plainly

Everything below is this project's and none of it is in the dump: the **hip
joint's height**, the **shoulder and pelvis widths** and the lines drawn across
them, the **bone lengths** of arm and leg, **where an elbow or a knee folds**,
every hand offset in `attitudeOf`, the **stance width**, the **gait's amplitude**
(its rate is `motion.x`), the **jump's tuck** (its phase is `motion.y`), and the
**recoil** (its timing is the published hitstun). Derived, and drawn in the body
colour to say so: the axis, the neck, the foot, the skull's size and place, which
parts are live, and any arm or leg a hurtbox outside the footprint puts somewhere
(8.2% of frames).

## Not settled

- **The skull is still wide.** It is drawn as a circle at the head box's short
  axis — 34 across on Ryu, 20% of his stature, where a human head is 13% tall and
  9% wide. The box is 60 × 34 because it covers a head plus the room a head
  needs, and a head seen side-on is taller than it is wide. Drawing an ellipse
  would need `Ctx` to grow; drawing a smaller circle would be drawing the head
  smaller than the only measurement of it there is. Neither was done.
- **The arm is short and the reason is a cage, not a body.** 0.25 of stature
  against 0.37. There is **nothing wider to relax the cage to**: the widest box
  a fighter has is the one it is already caged in. Measured over the idle pose,
  the pushbox half-width is narrower than the hurtbox half-width on all 24 —
  33 against 40 on eighteen of them, 45/52 on Blanka and E.Honda, 51/58 on
  Zangief, 40/46 on Marisa, 35/40 on M.Bison — and Ryu's throwbox is ±33 as
  well. So the arm cannot be lengthened by choosing a different box; it can only
  be lengthened by letting the hand sit outside every box the fighter has, which
  is the one thing the cage exists to forbid. The trade is a stubby arm against
  an unhittable hand, and this ADR takes the stubby arm.
- **The stance is symmetric about the axis.** A fighting stance is staggered —
  lead foot forward, rear foot back — and the tuck's test asserts the pair stays
  symmetric, so a stagger would have to be threaded through that.
- **`Physique` is still unresolved** and still used only as a ratio. `Leg /
  Height` of 0.61–0.71 is not a hip height and this ADR does not claim it is.
- **The jump's tuck reads as a zigzag.** It is ADR-0059's and untouched here; on
  a 520-unit camera band an airborne fighter is small and two hard-folded legs
  under a tucked pelvis are a pair of chevrons.
- **`MergeKey`'s blend curves are still unread**, as ADR-0059 left them.
