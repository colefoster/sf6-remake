# ADR 0049 — The figure is derived from the boxes

- Status: accepted
- Date: 2026-08-20
- Amended by: [ADR-0050](./0050-the-pushbox-is-the-axis-and-a-far-box-is-a-limb.md) —
  the body hangs on the pushbox, not on the drifting hurtbox unions
- Extends: [ADR-0020](./0020-full-invulnerability-is-the-absence-of-a-hurtbox.md),
  [ADR-0025](./0025-what-to-press-and-what-a-hit-does-to-you.md),
  [ADR-0028](./0028-the-viewer-runs-the-runtime.md)

## Context

`web/play.html` has run the real `Match` at 60fps since ADR-0028 — keyboard
input, motion inputs through the game's own triggers, gauges, corners, hitstop,
pause and frame step — and drawn it as **rectangles**. Nobody can read a fight as
rectangles, which is the whole reason the playable side stalled while eleven
commits went into the decode.

There is no skeleton to draw. MMDK dumps a motion clip *name* per action and no
bone transforms, and extracting them would mean parsing the game's animation
assets — a project, not a step.

The spec at `.scratch/training-room/spec.md` asked one question first: is the
collision geometry enough?

## Findings

### It is enough, because the boxes track the animation

A pose derived from the union of the live hurt keys per part, plus the live
hitboxes, reads as a person doing that move:

- **head** — the head box
- **spine** — centre-top of the body box down to the top of the leg box
- **legs** — hips to two points inset on the leg box's base
- **limb** — the *active hitbox is the limb*: a line from shoulder or hip to the
  box's far edge, which is the hand or the foot

Ryu leans into 5HP with the arm ending on the hitbox, crouches for 2MK with the
kick going low, rises through a Shoryuken. No authored art, no interpolation, and
every number is one the project already extracted.

### Three things the spike got wrong first

- **The head must be a fixed size.** Sized to the current head box, the skull
  balloons over the torso during a lean, because the box grows to cover the
  extended body. Take the radius from the idle pose and hang it off the top edge
  of the current box.
- **A missing hurtbox is not a missing body part.** ADR-0020 established that
  full invulnerability *is* the absence of a hurtbox. A rising Shoryuken keeps
  its body box and loses head and legs, so a figure that dropped absent parts
  collapsed to a line on exactly the frames that matter. Parts are **held over**
  from the last frame that had them and drawn dimmed — which turns the bug into
  the feature: **invulnerability is visible.**
- **Height does not tell a kick from a punch.** Ryu's 5MK connects at chest
  level, and drawn from the shoulder it reads as a very long arm. The action's
  own name does tell: `ATK_5MK` versus `ATK_5HP`. Height is the fallback, for the
  specials whose names say nothing.

### Animation is coarse, and that is correct here

Attack actions carry 3–7 distinct hurtbox poses (Ryu's 5HP has 5 over 79 frames),
so the figure steps rather than glides. It steps on the frames the game itself
changes on. For a tool whose subject is frame data, interpolating would be
inventing motion the dump does not have.

## Decision

`src/game/render.ts`, exported through `browser.ts` like the runtime: the camera,
the game-unit transform, box drawing, gauges, and `poseOf` / `drawFigure`.
ADR-0028 stopped the *logic* being written twice; this is the same seam for the
*view*, and `web/play.html` no longer contains any drawing arithmetic of its own.

`hurtPartsAt` in the geometry module returns the live hurtboxes **per part**,
because `hurtboxesAt` merges them and a body cannot be derived from a merge.

`InputHistory.recent()` exposes the direction edges for an input display. Edges,
not frames: a display built from held frames reads `6 6 6 6 6` where the game
read one forward, and a missed quarter-circle is only visible against what the
game actually read.

The opponent is an input frame. `Match.advance(p1, p2)` already takes two, so an
unresponsive training dummy is `hold(5)` and nothing in `match.ts` changes.

## Consequences

- `web/play.html` draws two stick figures, boxes optional, at 60fps against the
  real engine. Ryu's 5HP reads as a punch and his 5MK as a kick.
- The page gained a P2 mode (unresponsive dummy or second player), a figures
  toggle, live frame advantage, and an input strip.
- Four tests on the derivation, against a stubbed fighter rather than a match:
  the fixed head, the limb classification, the held-over parts on a DP's
  invulnerable frames, and mirroring.
- `web/play.js` is 54 KB.
- Body layout is flex now: the header wraps at narrow widths and the old
  `100vh - 47px` put the fighters' feet below the fold.

## Not settled

- **`web/boxes.html` still has its own copy of the drawing.** The module exists
  and one of the two pages uses it. Until the viewer is ported, the duplication
  ADR-0028 removed from the logic layer is still present in the view layer.
- **Arms at rest are invented.** An arm with no hitbox has no box of its own, so
  the two hanging lines are the one part of the figure that is not derived from
  anything. They are drawn under the active limb, so an attack overrides them.
- **A part is held over indefinitely.** If an action never re-establishes a
  hurtbox for a part, the figure keeps the last pose it had. No action in the
  roster does that for long, but nothing enforces it.
- **The punish window and the recording dummy** from the spec are not built. The
  panel shows advantage; it does not yet say what would have punished.
