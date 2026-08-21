# ADR 0057 — The hit has to be visible

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0053](./0053-one-renderer-two-cameras.md)

## Context

The training room played correctly and looked like nothing was happening. A
900-damage roundhouse to the head produced no change on screen at all: the
defender's reaction animation moves its hurtboxes barely, the figure is derived
from those boxes, so the figure barely moved. The only evidence a hit had landed
was a line of text in the side panel.

## Findings

### Half the canvas was sky nobody was in

`viewFor` picked its zoom as `min(width / span, height / 330)` and then pinned
the floor at `height - 56`. On a 1140×820 canvas with the fighters at their
starting distance the width bound, so the scale came out at 1.7 and the 330-unit
band was never used — 45% of the frame was empty black above two small figures.
The `+420` horizontal margin was what capped the zoom, and it was paying for
itself in air.

The vertical budget is the scarce one on a wide canvas. A tighter side margin
and a band that is only as tall as the fighters actually are gets the scale to
3.3 for the same pair.

But the band cannot simply be short: a jump needs it. So it follows — opening
the instant someone leaves the ground and closing at 5% a frame behind them.
Closing slowly is the point; snapping back on landing reads as a cut.

### Hitstop was already in the dump and the view could not see it

`Match` freezes both sides for `hitStop.owner` frames on every contact, which is
the game's own number. It was `private`. A freeze that the view cannot see is a
freeze that reads as a dropped frame rather than as impact.

### The hit knew everything except where it happened

`Hit` carried the frame, the damage, the stun and the reaction, and nothing
about position. A spark drawn at the defender's centre lies about which end of
them got hit — a sweep and an overhead would burst in the same place.

### A limb drawn as one straight line is a laser

`poseOf` drew an active hitbox as a single segment from hip (or shoulder) to the
box's leading edge. On Ryu's `ATK_5HK` that is a line from his own hip, across
his torso, to head height on the far side of the opponent. It read as a beam
weapon, not a leg.

## Decision

**The camera follows.** `Camera` in `src/game/render.ts` holds the band and
`viewFor` takes it as an argument; `CAMERA_FLOOR` is 210 units and the
horizontal margin is 170. The page feeds it the top of the highest hurtbox in
play, so the band is measured off the fighters rather than assumed.

**Contact is reported.** `Hit.at` is the centre of the overlap between the
attacking box and what it landed on, from `contactPoint` in `src/game/match.ts`.
`Match.hitstop` exposes the freeze.

**The view spends the freeze.** `shakeAt(hitstop, frame, weight)` shoves the
world — never the HUD — deterministically in the frame number, because the frame
stepper draws a frame more than once and must get one picture. `drawImpact`
draws a ring that opens and fades, with spokes for a strike and none for a
block: a blocked hit is a stop, not a burst. `drawFigure` takes a `flash` and
blows the struck figure out to amber, which the near-white body colour it
already had could not do.

**There is a stage.** `drawStage` paints a banded sky, a lit floor and an apron
receding from the front edge, all from flat rects so the structural `Ctx` the
tests fake stays small. Hurtbox fills drop from 0.18 to 0.09 so the figure wins
over its own scaffolding.

**Limbs bend.** `Pose.limbs` carries a `joint` — the midpoint dropped
perpendicular by 16% of the limb's length, always below the straight line,
because that is the way both an elbow and a knee fold.

## Consequences

- A hit now reads without looking at the panel: freeze, shake, spark at the
  point of contact, defender flashes.
- The starting pair is drawn at 3.3× rather than 1.7×.
- Six new tests: the camera's framing, separation and jump behaviour, the
  shake's determinism, the contact point's height, and the limb's joint.
- `drawFigure` and `viewFor` both gained a trailing optional argument, so
  `web/boxes.html` is unchanged.

## Not settled

- **The figure still does not react.** The flash says a hit landed; the pose
  does not, because the reaction animation's boxes barely move and the pose is
  the boxes. Knockback moves the fighter, nothing bends them.
- **An airborne fighter draws dimmed.** A jump carries no head hurtbox, so
  `faded.head` sets and ADR-0020's rule fades a part that is not invulnerable.
- **The block spark is sized off damage**, which for a blocked normal is zero,
  so every block bursts at the minimum size.
