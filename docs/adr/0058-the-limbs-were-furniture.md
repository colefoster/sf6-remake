# ADR 0058 — The limbs were furniture

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0050](./0050-the-pushbox-is-the-axis-and-a-far-box-is-a-limb.md),
  [ADR-0051](./0051-the-page-drives-from-a-script-and-the-parts-stop-lying.md),
  [ADR-0057](./0057-the-hit-has-to-be-visible.md)

## Context

The figure is derived from the collision boxes, because there is no skeleton in
the dump. ADR-0049 built the spine and the head that way, ADR-0050 hung them on
the pushbox's axis, and ADR-0057 gave the active hitbox a knee. The arms and the
legs were never derived at all, and both earlier ADRs left "the extended limb's
hurtboxes are still discarded" open.

## Findings

### They were not derived, they were constants

Two feet at `axis ± half * 0.48`, identical in every action of every fighter,
drawn as straight lines from one hips point: an inverted V that never moved. The
arms were not even in `Pose` — `drawFigure` invented two segments from
`neck.x ± 10` splaying 8 units, in the player's tint. Ten units against a
33-unit pushbox half-width, so they were drawn *inside* the torso, which is why
they read as coloured scribble across the chest rather than as arms.

### The dump had already been asked and the answer thrown away

ADR-0050 is titled *the pushbox is the axis and a far box is a limb*. `poseOf`
filters each part's boxes to those over the footprint, because a box out at the
pushbox's edge would corrupt the torso union, and its own comment says what the
rejected ones are: *an extended limb carrying its own hurtbox.* The limb was
identified by name, in a decision record, and then dropped on the floor while
the figure drew a constant instead.

Across all 24 characters, 456,993 frames:

| part | boxes / frame | non-core boxes | frames carrying one |
|---|---|---|---|
| head | 0.82 | 4,447 (1.2%) | 4,409 (1.0%) |
| body | 0.99 | 33,364 (7.4%) | 30,395 (6.7%) |
| leg | 0.86 | 20,526 (5.2%) | 19,185 (4.2%) |

**9.2% of frames carry one at all** — but they are not spread evenly, and where
they land is exactly where a figure needs them:

| family | actions | % of frames with a non-core box | actions whose non-core set moves |
|---|---|---|---|
| `ATK_*` | 1,523 | **19.4%** | 1,237 / 1,523 |
| `SPA_*` | 1,573 | **17.0%** | 704 / 1,573 |
| `BAS_*` (idle, walk, jump, crouch) | 1,356 | 0.4% | 9 / 1,356 |
| `DMG_*` + `GRD_*` | 646 | **0.0%** | 0 / 646 |

The reactions confirm ADR-0057 from the other side: not one of the 646 carries
an extended limb, on any frame.

### The part tag names the limb; height does not

| part / band | n | | part / band | n |
|---|---|---|---|---|
| body / chest | 19,301 | | body / below hips | 2,493 |
| leg / below hips | 15,700 | | leg / chest | 1,747 |
| body / hip | 9,967 | | body / **above neck** | 1,603 |
| head / above neck | 3,478 | | leg / **above neck** | 535 |

535 leg boxes sit above the neck and 1,603 body boxes do too, so height cannot
separate an arm from a leg. The array the box was tagged to can.

### Which side of the body is not answerable

The boxes are 2D. There is no near limb and no far one — only a direction from
the axis, and that is **forward on 54,208 of 58,337 (93%)**.

### The hitbox and the hurtbox are the same limb

15,609 frames carry an active hitbox; 9,381 of them (60%) also carry a non-core
hurtbox, and the two centres sit **1 / 8 / 25 units apart at p10 / p50 / p90**.
Drawing both would draw one limb twice. What the hurtbox adds is the other
**32,820 frames** — the wind-up and the recovery, where there is no hitbox and
the limb is still out.

### `Motion` cannot animate a walk

3,306 of 8,213 actions carry one, and it is a displacement curve for the whole
fighter: where the body travels, never where a foot is. `BAS_FORWARD_Loop` moves
no hurtbox at all.

### A limb is boxed in segments, so its union is not its shape

The first cut read the tip off the *union* of a part's outboard boxes, at mid
height. Two measurements killed that. The boxes are mostly **taller than wide**
— 77% of leg boxes and 73% of arm boxes, median aspect 1.8 and 1.6 — so mid
height put a sweeping foot halfway up the shin. And a limb is boxed in
*segments*: unioning a shoulder box with a horizontal arm box gives a tall union
even when the arm is flat, which sent Dhalsim's 5HP out of his shoulder and down
to the floor.

### The fade was lying about the legs

`faded` marked a part whose *key* was absent, per ADR-0020. But `hurtboxesAt`
flattens head, body and leg into one array — the hit test does not care which
part a box was tagged to — so a leg drawn inside a live body box is hittable
however it was tagged.

Measured: of the frames whose leg key is absent, **28,857 of 38,165 have another
part's box covering where the leg is drawn.** Those legs were being dimmed while
fully vulnerable, which is why a neutral jump read as lower-body invulnerable.
The head is the opposite case and the dimming there is honest: only **90 of
41,998** faded-head frames are covered by anything.

## Decision

`Pose` carries `arms: Limb[]` and `legs: Limb[]`; `feet` is gone and `limbs` is
`Limb & { kick }`. A `Limb` is root, joint, tip and a `derived` flag.

**An arm or a leg is drawn where the boxes put it** — the union of that part's
hurtboxes lying outside ADR-0050's footprint tolerance, with the part tag naming
which limb (`leg` a leg, `head`/`body` an arm) and the box's own side of the
axis choosing which of the pair gets it. An active hitbox for the same kind of
limb overrides it. Where no such box exists the limb falls back to a resting
pose that is **invented and flagged as such**.

The tip is **the furthest-reaching box of the set, then the end of that box's
own long axis** — the far `x` edge at mid height where it is wider than tall,
the far `y` edge at mid width where it is taller — not the union's corner. The
joint's droop is capped at `radius * 1.5`, because how far a knee sits off the
line is a property of the body and not of how far the limb reaches; uncapped,
ADR-0057's 16% put Dhalsim's elbow 57 units under a 361-unit arm. An extension
is **held over** when the part loses its box entirely, the same rule ADR-0020
gives every other part, which reaches 112 frames across the roster.

**A part fades only when no live hurtbox covers where it is drawn**, rather than
when its own key is missing.

`drawFigure` only draws now: a derived limb in the body colour, an invented one
in the player's tint, and the live hitbox limb in warm orange or yellow — the
kick used to be cyan, which is also P1's tint, so on the left-hand fighter a
live roundhouse and a resting arm were the same colour.

## Consequences

- `limb-overlong` **231 → 119 frames, 13 actions**; `limb-degenerate` **8 → 0**
  (E.Honda's `ATK_8LK` boxes its kick on the hip it hangs off, and a 4-unit limb
  is a dot — dropped below `radius`, symmetric with ADR-0051's too-far rule).
- A new `reach-overlong` audits the derived arms and legs on the same terms:
  **371 frames, 20 actions.** Nothing else in `pose:audit` moved.
- **The residual is one character.** Of `reach-overlong`'s 20 actions, 12 are
  Dhalsim; of `limb-overlong`'s 13, 11 are. Those limbs really are that long.
- `foot-above-hips` now tests only the planted leg. A *derived* leg above the
  hips is a high kick, which is what the boxes said; unfiltered it read 2,434.
- **Both overlong tests now measure against the fighter's *idle* stature.** How
  long a limb may be is a property of the body: against the current stature a
  crouching low read as overlong on 140 frames purely because crouching shortens
  the ruler. This moves counts without improving anything, and `limb-overlong`
  159 → 119 is that change rather than a fix.
- `figure-sheet` can shoot an airborne move at last. `window.play.frame` takes a
  `band`, the sheet measures one per *move* rather than per sheet so a jump does
  not shrink the grounded moves beside it, and each cell crops the tallest
  cell-shaped window anchored on the floor instead of a fixed 600 rows off the
  bottom — which was throwing away the top of the stage, which is where a
  jumping fighter is.
- Two new tests; two updated where the fade's meaning changed. 257 pass.

## Not settled

- **90.8% of frames are still the invented resting pose**, including every
  `BAS_*` and every reaction. The walk holds one pose, which is what the dump
  says and not what a walk looks like.
- **The shoulders are invented** (±0.55 of the pushbox half-width), as is the
  resting bend and the stance width ADR-0050 set.
- **Blanka's somersault** still draws head-down, correctly per ADR-0051 and
  still odd to look at.
