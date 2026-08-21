# ADR 0063 — The jump was a standing figure on an elevator, and the box was the whole man

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0020](./0020-invulnerability-is-the-absence-of-a-hurtbox.md),
  [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0058](./0058-the-limbs-were-furniture.md),
  [ADR-0059](./0059-there-are-no-bones-and-the-ground-is-the-clock.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md)

## Context

ADR-0060 closed with *"the jump's tuck reads as a zigzag … on a 520-unit camera
band an airborne fighter is small and two hard-folded legs under a tucked pelvis
are a pair of chevrons."* Watched in the room, the jump is the worst thing on
screen: the figure goes grey at the head, the legs open and close in an exact
mirror, and the whole body keeps its standing shape for the length of the leap.

The arc itself was checked first and is right. Ryu's `motion.y` climbs to 234.3
with the apex at index 20 of 40, and the diffs run 22.8 at the launch down
through 0.6 at the top and back out to −21.6 at the touchdown. The physics is the
game's. The fault is entirely in the drawing.

`BAS_JUMP_N_AIR` is 40 frames and the figure's whole geometry over all 40 was one
`body` box. `neck` was `hips + 50` on every frame and `head` was `neck + 17` on
every frame — the grounded pose, translated. That is where the investigation
started, and the first thing measured was what that box actually is.

## Findings

### The box is not a torso. It is the whole fighter

`BAS_JUMP_N_AIR`'s entire hurt key, read out of the raw dump rather than the
extractor, is one entry:

```
"DamageCollisionKey": { "1": { "_StartFrame": 0, "_EndFrame": 40,
                               "BodyList": { "0": 16 }, "ThrowList": { "0": 3 } } }
```

`BodyList` and nothing else — no `HeadList`, no `LegList`. Compare
`BAS_JUMP_N_START` one frame earlier, which carries all three. The game stops
boxing a head and a leg the moment the fighter leaves the ground.

What that single rect measures, across all 24 fighters:

| | grounded stack | airborne rect | boxes | air / idle stature | bottom / stature |
|---|---|---|---|---|---|
| Ryu and 19 others | 0 – 166 | **65 – 185** | 1 | **0.72** | 0.39 |
| Dee Jay | 0 – 172 | 65 – 185 | 1 | 0.70 | 0.38 |
| JP, Marisa, Zangief | 0 – 178 | 65 – 185 | 1 | 0.67 | 0.37 |
| Chun-Li | 0 – 166 | 65 – 185 | 2 | 0.72 | 0.39 |

Byte-identical on every fighter and on every frame of the leap. It is 120 units
on a body whose idle stack is 166 — 0.67 to 0.72 of stature — and it starts 0.37
to 0.39 of a stature off the floor. **That is a tucked figure, entire**: the top
is the crown, the bottom is the drawn-up feet, and it is shorter than the
standing man because the man is folded.

Read as a torso instead, with the head held over above it and the legs held over
below it, the figure came out 34 units taller than its own hurtbox at the top and
18 units longer at the bottom, on every frame of every jump.

### The signature is exact, and it is the dump's

Frames whose only hurt key is `body`, over all 456,993:

| | frames | % | actions |
|---|---|---|---|
| `body` is the only hurt key | 36,080 | 7.9% | 990 |
| …and the rect is taller than wide | **29,622** | **6.5%** | 854 |
| …of those, on an action that leaves the ground | 28,674 | **96.8%** | — |
| …on an action that never leaves the ground | 948 | 0.21% | 60 |

The aspect test earns its place. Blanka's back roll is a single `body` key too,
but at 116 × 72 it is a ball, not a figure; fitted into it he stands 72 units
tall wearing a 34-unit skull, and it put 288 extra frames into `pose:audit`'s
`spine-squashed`. A rect taller than it is wide is the same test ADR-0058 used to
read a limb's segments. The 60 never-airborne actions that survive it are Ed's
flight (`FLY_*`, box 65–185, the jump rect exactly), Blanka's Thunder, hop kicks
like Zangief's `ATK_6MK` and E.Honda's headbutt — bodies that really are one box.

### The head was faded because it was drawn where nothing could hit it

ADR-0058's fade rule is that a part is invulnerable when *no* live hurtbox covers
where it is drawn. Airborne it fired on the head every time, and it was right to:
Ryu's skull was drawn at 202 with a radius of 17, so its lowest point was 185 —
the exact top edge of the only hurtbox in play. Not one pixel of it was inside.

| frames with no `head` key | drawn faded | covered by another box |
|---|---|---|
| ADR-0060 | 77,920 | 79 |
| here | **47,890** | **30,109** |

(every action of every fighter, 60 frames each.) **The rule is untouched. The
head moved.** 30,030 frames of head that were being drawn grey and untouchable
are now drawn inside the box the game gives them, and the same unchanged `over()`
test reports them hittable. The 47,890 that still fade are the ones with no box
anywhere near them — a rising Shoryuken's genuine head invulnerability, which is
what the rule is for.

### The tuck went to full on the frame the fighter lands

`climb` was read as a *forward* difference, `y[f] - y[f-1]`, while `originAt`
puts frame `f` at `y[f-1]`. One frame ahead everywhere, and at the last frame of
the leap there was no next sample: it fell back to its own, read a climb of zero,
and drew a **full apex tuck on the touchdown frame** of every jump in the game.
Ryu's arc is still falling at 21.6 units there. It shows in the old table below
as a foot separation that runs 44.3 at f37 and then snaps back to 30.4 at f40.

### No basic jump is labelled airborne

`attitudeOf` picks the airborne guard off `StatusKey.PoseStatus`. The whole key
list of `BAS_JUMP_N_AIR` is `DamageCollisionKey` `MotionKey` `PushCollisionKey`
`SteerKey` `TriggerKey` `VfxKey` — there is no `StatusKey` on it at all, so
`stanceAt` returns null. The airborne attitude fired on the 478 jumping normals,
which are labelled `3`, and **never once on a plain jump**. Every neutral jump in
the game was drawn holding the grounded guard.

### Every jumping kick in the game was drawn as a punch

ADR-0058's rule is that the part tag names the limb — `leg` a leg, `head`/`body`
an arm. On a one-box frame it cannot, because *everything* is tagged `body`. So
a jumping kick's own extended hurtbox went to an arm: Ryu's `ATK_8MK` reached a
hand out to x=127 while the identical box was already being drawn as an orange
kick beside it. **748 frames over 114 actions**, which is every jumping kick on
the roster.

### The `_START` → `_AIR` → `_LAND` handoff is sound

Checked because it had not been. `lands` is null on `BAS_JUMP_N_AIR` and the
chain is walked by name in `runOut` (ADR-0033). `_AIR`'s last recorded arc sample
is 23.4 units up, and `runOut` already zeroes `state.y` on entering `_LAND` with
a comment saying why. Nothing to fix; the 23-unit touchdown is the game's own and
the landing animation absorbs it.

## Decision

**Where one box is the whole fighter, the figure is fitted into it.** The
condition is exact and it is the dump's: no `head` key, no `leg` key, a `body`
key, and a rect taller than it is wide. Then

- its far edge is the **crown**, not the neck, and the skull sits one radius
  inside it;
- the **neck** hangs under the skull at the offset the grounded figure already
  uses — the `0.6` of a radius that the head box's own clamp measures to;
- its near edge is the **sole**, the lowest point of the leaping body, which is
  where the game says a low can still catch it;
- the pelvis is placed between them by ADR-0060's unchanged `HIP_OF_NECK`.

Crown and sole are **derived**. This is the first airborne frame in the project's
history where the head, the neck, the hips and the feet are all read off a box.

**The jump's tuck moves inside the box instead of hanging out of it.** ADR-0059's
arc-keyed fold is kept and is still the only thing that says a leap is in
progress — the box is identical on all 40 frames, so on its own it draws a
hovering statue. It now folds the legs up *from* the derived sole rather than
from a held-over grounded stance, so the fully-extended pose at launch and
touchdown is the box's own floor and the apex is above it. Nothing leaves the
rect at either end.

**The climb is the backward difference**, `y[f-1] - y[f-2]`, matching
`originAt`'s indexing, with the first frame taking the forward one — the same
number on a curve whose ends are its fastest part.

**A fighter drawn as one box is airborne**, whether or not the action carries a
`PoseStatus`. That is what gets the airborne attitude onto a basic jump, and it
also covers the first frame of `_AIR`, where the boxes have already left the
ground but `motion.y` still reads 0.

**With no tag to read, the action's name picks the limb.** On a one-box frame an
outboard hurtbox on an action named `…MK` is that kick's own leg, which is the
test the hitbox above it already uses.

**Airborne, the stance is staggered rather than mirrored, and this is invented.**
The box gives a band and not a pose, so two feet placed by one rule land at the
same height either side of the axis: two straight lines in a V that only opens
and closes, which is exactly the chevron ADR-0060 left standing. It is worse than
a mirror — the hips sit only a third of a leg above the sole, so a two-bone chain
folds past a right angle, and both knees pushed the same way crossed each other
over the axis. The trailing foot now sits **on** the sole the box gives and the
trailing knee folds back behind the hip; the leading foot rides half the
hip-to-sole gap above it with its knee forward. This is the same argument, and
the same class of invention, ADR-0060 made for placing the two hands separately.

**The cage is untouched.** It was not widened, relaxed or disabled, in the air or
anywhere else. It did not need to be: the fault was never the cage, it was a
figure drawn outside a box the cage was not measuring against.

Unchanged: the fade rule, the derived/invented colour rule, the axis, the
grounded pose in every particular, ADR-0060's pelvis, bone lengths and joint
solver, the walk, and `Motion` as the jump's clock.

## Consequences

Ryu's neutral jump, every fourth frame plus the apex and the last. `out` is how
far the furthest point of the drawn figure lies outside the hurtbox on that
frame; `dy` is the height between the two feet.

| f | box | skull top → feet, before | sep | dy | **out** | skull top → feet, after | sep | dy | **out** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 65–185 | 219 · 185 · 135 · 47/47 | 46.8 | 0.0 | **34** | 185 · 158 · 124 · 65/95 | 36.9 | 29.6 | **0** |
| 9 | 215–335 | 369 · 335 · 285 · 213/213 | 40.1 | 0.0 | **34** | 335 · 308 · 274 · 224/246 | 32.2 | 21.5 | **0** |
| 17 | 290–410 | 444 · 410 · 360 · 304/304 | 33.4 | 0.0 | **34** | 410 · 383 · 349 · 310/323 | 26.9 | 12.3 | **0** |
| 21 apex | 299–419 | 453 · 419 · 369 · 320/320 | 30.8 | 0.0 | **34** | 419 · 392 · 359 · 325/333 | 24.3 | 7.7 | **0** |
| 29 | 262–382 | 416 · 382 · 332 · 266/266 | 37.5 | 0.0 | **34** | 382 · 355 · 321 · 278/294 | 28.9 | 15.7 | **0** |
| 37 | 150–270 | 304 · 270 · 220 · 138/138 | 44.3 | 0.0 | **34** | 270 · 243 · 209 · 155/180 | 34.2 | 25.0 | **0** |
| 40 | 88–208 | 242 · 208 · 158 · **110/110** | **30.4** | 0.0 | **34** | 208 · 181 · 148 · 90/118 | **36.2** | 28.4 | **0** |

Four things read off that table. The figure was 34 units outside its own hurtbox
on every frame and is now inside it on every frame. The two feet were at the same
height on every frame and are 8 to 30 units apart. The tuck snapped shut on the
touchdown frame — 44.3 at f37, 30.4 at f40 — and now opens monotonically from the
apex to the landing. And the whole figure is 120 tall in the air where it used to
be 166, which is what the box says.

- **The invented extremity, measured on ADR-0060's terms** and extended to the
  knees and elbows as well as the hands and feet, and to the vertical as well as
  the horizontal — which is the axis the airborne fault was on. 2.68M invented
  points, every action of every fighter, 60 frames each:

  | | outside every hurtbox, horizontally | worst | vertically | worst |
  |---|---|---|---|---|
  | ADR-0060 | 567 | 33 (Jamie `SAA1_BREAKIN_Y2`) | 72,598 | 183 |
  | here | **555** | 33 (same frame) | **22,807** | 184 |

  Neither grew. The vertical count falls by 69% and it is all the jump.

- `pose:audit`, over the same actions. **Nothing grew, one shrank:**

  | | ADR-0060 | here |
  |---|---|---|
  | `axis-pop` | 497 | 497 |
  | `reach-overlong` | 340 | **328** |
  | `spine-squashed` | 114 | 114 |
  | `limb-overlong` | 103 | 103 |
  | `head-detached` | 71 | 71 |
  | `spine-inverted` | 60 | 60 |
  | `foot-above-hips` | 60 | 60 |
  | `legs-stretched` | 0 | 0 |

  `reach-overlong` **340 → 328** is the jumping kicks that were being drawn as
  overlong arms.

- Two tests added and three updated with their comments — the fade on a rising
  Shoryuken and on a leap (both parts are now covered, and the head reads
  hittable where it is drawn), the airborne stagger where a symmetry assertion
  stood, and `Pose.stand`, which is 59 in the air against 88 on the ground
  because the box says the leaping body is 120 tall and not 166. **268 pass.**

- `Pose.stand`'s anti-feedback guarantee is now structural rather than a rule to
  obey: on a `whole` frame both the hips and the sole come off a box that does
  not move for the whole leap, so the untucked distance cannot drift no matter
  what the previous frame drew. Measured across all 40 frames of Ryu's jump, min
  and max are both 59.2064.

### What in the airborne figure is invented, plainly

Derived, and drawn in the body colour to say so: the **crown**, the **sole**, the
**skull's size and place**, the **neck**, which parts are live, and any limb an
outboard hurtbox puts somewhere. Invented, and drawn in the player's tint:
the **hip height** between crown and sole (ADR-0060's `HIP_OF_NECK`), the
**shoulder and pelvis widths**, the **bone lengths**, **where the knee folds**,
the **hand offsets** of the airborne attitude, **how deep the tuck goes** (its
phase is `motion.y`), and — new here — **the stagger**: that the trailing foot is
the one on the sole, that the leading one rides half the hip-to-sole gap above
it, and that the trailing knee folds backwards. Both feet stay inside the box
either way; which of them is high is this project's, not the game's.

## Not settled

- **The airborne knee sits on the cage edge 73% of the time** — 47,112 of 64,125
  invented airborne knees. It is honest (the edge of the box is hittable) and it
  is arithmetic, not a fudge: the box puts the hips 63 units above the sole on a
  leg the fighter's own stature makes 90 long, so a two-bone chain spanning 63
  has to fold its joint 32 units off the line, and 32 from an axis inside a
  ±40 box lands on or past the wall. Both knees are on opposite walls now rather
  than the same one, which stops the legs crossing, but a tucked leg whose knee
  is always at exactly the silhouette's edge is a shape and not a pose. The
  honest ways out are a shorter airborne bone (a leg tucked towards the viewer
  foreshortens, and this figure has no depth to foreshorten in) or reading the
  box's bottom edge as a knee rather than a foot. Neither was done.
- **The box does not change for the length of the leap**, so everything that
  makes the jump *move* is still ADR-0059's arc. The dump has no more to give
  here: `MotionKey` is a clip id and a frame range, and the clip is not in the
  dump.
- **`MergeKey`'s blend curves are still unread**, as ADR-0059 and ADR-0060 both
  left them. They say which frames blend the upper body against the lower and how
  hard, and a jump is exactly where that would mean something.
- **Which foot leads is `facing`**, which is the direction the fighter is looking
  and not the direction it is travelling. A back jump therefore leads with the
  same leg a forward jump does. `motion.x` carries the travel and could pick the
  other leg; it was not wired up, because a jumping fighter's lead leg is a
  question about the animation and the animation is not in the dump.
- **The 60 never-airborne actions that pass the one-box test** (948 frames) are
  drawn as fitted figures too. On Ed's flight and the hop kicks that is right; on
  Blanka's Thunder it is a guess that happens not to look worse.
