# 02 — The stick figure, derived from the boxes

Status: `ready-for-agent`
Depends on: `01-render-module.md`

## Why

Nobody can read a fight as rectangles. A spike (see `../spec.md`) established
that the boxes alone make a recognisable figure: SF6's hurtboxes track the
animation, and the attacking limb *is* the hitbox. No bone data is needed and
MMDK dumps none.

## What

`poseFrom(action, frame, calibration)` in `src/game/render.ts` → joints in game
units, plus `drawFigure(ctx, view, pose)`.

Derivation, all of it from data already extracted:

- **head** — radius fixed, from the idle action's head box; centre hung off the
  *top* edge of the current head box.
  *The spike got this wrong first: sizing the skull to the box makes it balloon
  during a lean, because the box grows to cover the extended body.*
- **spine** — centre-top of the body box down to the top of the leg box
- **legs** — hips to two points inset (about 22% / 78%) on the leg box's base
- **limb** — root to the hitbox's far-edge centre. Root is the shoulder for a
  hitbox above about a third of torso height, the hips below it, so a low kick
  comes out of the hips. With no active hitbox, both arms hang from the shoulders.
- **persistence** — a part whose box has vanished keeps its last known pose and
  is drawn **dimmed or dashed**. ADR-0020 established that full invulnerability
  is the absence of a hurtbox, so without this a DP loses its head and torso on
  exactly the frames that matter. Styling it instead of deleting it is how the
  training room *shows invulnerability*.

Multiple active hurt keys union per part, as the spike did — a frame commonly has
a long base key plus a short one.

## Notes

- Attack actions carry 3–7 distinct hurtbox poses, so the figure steps rather
  than glides. Do not interpolate: stepping on the frames the game changes on is
  correct for a tool whose subject is frames.
- Keep the box overlay as a toggle over the figure (`play.html` already has the
  button). The two together are the debugging view; the figure alone is the game.

## Done when

- Ryu's 5HP, 2MK, DP and jumping HK all read as a person doing that move, at a
  glance, with boxes off
- A DP's invulnerable frames show a dimmed torso rather than a vertical line
- Every one of the 24 fighters renders without a missing-part crash
