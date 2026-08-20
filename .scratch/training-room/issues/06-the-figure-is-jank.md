# 06 — The figure is jank: put the body back on one axis

Status: `done` — ADR-0050
Follows: `02-stick-figure.md`, ADR-0049

## The report

*"The stick men are jank but good progress."* The screenshot is Ryu's `ATK_5LK`
on frame 4: the spine runs **diagonally** up and to the right, the head floats
detached above-left of it, the legs splay into a huge tent, and the resting arms
appear to come out of the head.

## The cause, measured

`poseOf` places each joint at the centre of the **union** of that part's live
hurtboxes. During a kick the extended leg has its own leg hurtbox, so the union
stops describing the body:

| frame | leg union centre | leg union width | pushbox centre | pushbox width |
|---|---|---|---|---|
| 1 | 0 | 80 | 0 | 66 |
| 3–8 | **47** | **174** | **0** | **66** |
| 12 | 0 | 80 | 0 | 66 |

So the hips slide 47 units forward mid-move, the feet land at 22% and 78% of a
174-wide box (a 130-unit stance), and the neck — taken from the *body* union,
which drifts differently again — ends up somewhere else entirely. Three joints,
three different notions of where the fighter is.

**The pushbox does not drift: centre 0, width 66, every frame of the move.** It
is the body's authored footprint, and it is the axis the figure should hang on.

## What to do

- **One axis per frame**, from the pushbox centre; fall back to the head box, then
  the fighter's own x. `hips`, `neck` and the head all sit on it, so the spine is
  vertical unless something else moves it.
- **Stance from the pushbox**, not from the leg union: feet inset a fixed fraction
  of the pushbox half-width (about ±16 units on a 66-wide box), on the ground.
- **Height still comes from the boxes** — the leg union's *top* for the hips, the
  body union's top for the neck, the head box's top for the skull. Only the
  horizontal placement changes.
- **Shoulders off the neck, not the head**: with the axis fixed, the resting arms
  stop reading as antennae.
- Re-check the four spike moves plus `ATK_5LK` and a jump, boxes on and off.

## Worth considering while in here

The extended leg's *hurtbox* is where the limb actually is — the same information
the hitbox gives, available on frames where the hitbox is not live (startup,
recovery). Drawing a limb from a leg box much wider than the pushbox would
animate the wind-up and the retraction, not just the active frames. Optional, and
the axis fix comes first.

## Done when

- Ryu's `5LK`, `5MK`, `5HP`, `2MK` and a jump all show a vertical spine with the
  head attached and a plausible stance
- No joint moves horizontally except a limb and the fighter's own position
- The `poseOf` tests still pass, with one added for the 5LK axis

## Outcome

Done, ADR-0050. The axis is the pushbox centre; each part is filtered to the
boxes centred within 60% of the pushbox's half-width before its union is taken,
which fixed the vertical drift as well as the horizontal — the extended-limb box
was lifting the hips to 100 and the neck to 166. Two further things surfaced
while in here:

- **2MK needed the tolerance, not just the filter.** A thigh box centred exactly
  on the pushbox edge passed a strict inside-the-footprint test and put the hips
  above the neck.
- **Held-over parts had to be held at a distance, not a height.** A jump keeps
  only its body box, so hips pinned to their last absolute height stayed on the
  floor while the torso climbed 345 units. ADR-0049's Shoryuken test asserted
  that bug (`during.feet === before.feet`) and now asserts the offset instead.

Not done, still worth having: **drawing the limb from its own hurtbox** on the
startup and recovery frames where no hitbox is live. The filter already isolates
exactly those boxes and throws them away.

Residual: 277 frames of 385,607 across the roster still draw hips above the neck,
all on acrobatic air specials where the legs genuinely are above the torso.
