# ADR 0050 — The pushbox is the axis, and a box away from it is a limb

- Status: accepted
- Date: 2026-08-20
- Amended by: [ADR-0051](./0051-the-page-drives-from-a-script-and-the-parts-stop-lying.md) —
  four more things the boxes were saying that the figure believed
- Amends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md)

## Context

ADR-0049 derived the figure from the union of each part's live hurtboxes: the
head box is the head, the body box the torso, the leg box the legs. Drawn, it was
jank. On Ryu's `ATK_5LK` the spine ran diagonally up and to the right, the head
floated detached above it, the legs splayed into a tent, and the resting arms
came out of the skull.

The extended limb is the cause. It carries **its own hurtbox**, tagged to the
part it belongs to, so the union stops describing the body:

| frame | leg union | pushbox |
|---|---|---|
| 1 | 80 wide at 0, 54 tall | 66 wide at 0 |
| 3–8 | **174 wide at 47, 100 tall** | 66 wide at 0 |

Every joint read a different union, so three joints meant three notions of where
the fighter was. The hips slid 47 units forward and 46 up mid-move; the neck,
taken from a body union that on frame 8 swallowed a `18x166` arm box, went
somewhere else again.

## Findings

### The pushbox does not move, and it is the body's footprint

Centre 0, width 66, every frame of 5LK — and of every other normal. It is the
authored answer to *where is this fighter*, which is exactly the question the
figure was asking the hurtboxes and getting three answers to.

### A box centred away from the footprint is a limb, not the body

The core boxes sit on the axis (`c=0`); the extension boxes do not (`c=73`,
`c=110`). Filtering each part to the boxes whose centre is within 60% of the
pushbox's half-width leaves the body and drops the limb — and fixes the heights
as well as the horizontal, because the same contamination was lifting the hips to
100 and stretching the neck to 166. The tolerance is 0.6 and not 1.0 because
Ryu's 2MK carries a thigh box centred *exactly* on the pushbox edge.

The discarded boxes are where the limb actually is, on the startup and recovery
frames where no hitbox is live. Drawing them would animate the wind-up. Not done.

### A held-over part must be held at a distance, not at a height

ADR-0049 held a part whose hurtbox had gone at the position it last had. That is
right only while the fighter stands still. `BAS_JUMP_N_AIR` keeps *only* its body
box, so the hips stayed on the floor while the torso climbed 345 units away and
the figure became a long vertical line. A part with no box is now held at its
last **distance** from the part above it, so the whole figure leaves the ground.

## Decision

`poseOf` hangs the body on one axis, taken from the pushbox centre, falling back
to the head box and then the fighter's own x. `hips`, `neck` and the head all sit
on it, so the spine is vertical unless the fighter moves. The stance is the
pushbox's half-width inset by 0.48 (±16 units on a 66-wide box), not the leg
union's. Heights still come from the hurtboxes — the leg union's top for the
hips, the body union's top for the neck, the head box's top for the skull —
computed from the footprint-filtered boxes.

## Consequences

- Ryu's 5LK, 5MK, 5HP, 2MK and a jump all draw a vertical spine with the head
  attached, a plausible stance, and the kick still reaching its hitbox. No joint
  moves horizontally except a limb and the fighter's own position.
- The jump and the Shoryuken rise as whole figures rather than stretching.
- Two tests added — the 5LK axis and the held-at-a-distance jump — and the
  Shoryuken test now asserts the feet keep their offset below the hips instead of
  staying where they were, which was the bug.
- **277 frames of 385,607 across the roster still draw hips above the neck**
  (0.07%, 59 actions): Manon's `SPA_02_HIGH`, Dee Jay's jack knife, Dhalsim's
  yoga float. On those the legs genuinely are above the torso, and the derivation
  reporting it is honest rather than wrong.
