# ADR 0062 — The stage was the same picture from everywhere

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0053](./0053-one-renderer-two-cameras.md),
  [ADR-0057](./0057-the-hit-has-to-be-visible.md)

## Context

ADR-0057 gave the camera a band that opens the instant someone jumps and closes
at 5% a frame behind them. The consequence is a camera that is almost never
still: the zoom changes on every jump and the fighters slide horizontally on
every walk. ADR-0057 also gave the stage a floor, so the fighters stopped
standing on a hairline.

What it did not give them was anything to move *against*. Watched at 60fps a
walk read as a treadmill and a jump read as the figures being resized in place.

## Findings

### Every rect the stage drew was full width

`drawStage` painted 32 rects: 14 sky bands, 6 apron bands, 4 depth lines, 5 wash
bands, the floor line, the distance marks and the walls. All but the marks and
the walls were `fillRect(0, y, width, h)` — spans of the whole canvas at a fixed
`y`. A full-width band has no horizontal position, so **nothing in it can
respond to a pan**, and its `y` came from `ground` and `height`, which are the
canvas's, not the camera's — so nothing in it responded to the zoom either.

Six frames of Ryu back-walking 128 units at 3.3×, captured at
`.scratch/stage/before-walk-close.png`: the background is byte-identical in all
six. The same over a neutral jump, `before-jump.png`, where the camera band
takes the scale from 2.8 down to 1.4: also identical in all six. The only thing
that changes between the first tile and the last is the size of the fighters,
which is exactly the complaint.

The distance marks were the one thing on the stage that did move, and they were
drawn `1 × 10` px in `#2b3341` under the floor line — 12% brighter than the
apron they sat on, and covered by a fighter's own feet.

### A ground-pinned camera hands you the horizon for free

`viewFor` pins the floor at `height - 56` and scales about it. So a camera at
eye height `EYE` puts its horizon at `ground - EYE * scale`, and that line
**slides towards the floor as the camera pulls back**. Nothing had to be added
to `View` to get it: `scale` and `ground` are already on it, and the camera's
world centre is recoverable exactly as `(width / 2 - view.x(0)) / scale`.

That one line is most of what makes a zoom read as a camera. Over the jump
sheet the horizon travels 523 px → 225 px above the floor while the fighter
shrinks; the figure getting smaller *and* the world flattening towards a
receding horizon are two different pictures, and only the second one is a
camera.

### One number per layer is enough

A plane `p` of the way in from the horizon to the fighters' own floor wants
three things — how fast it pans, how big it draws, and how high its ground line
sits — and all three are `p`:

| | pans at | draws at | stands at |
|---|---|---|---|
| cloud | 0.05 | 0.05 × scale | 0.95 of the way to the horizon |
| skyline | 0.10 | 0.10 × scale | 0.90 |
| towers | 0.24 | 0.24 × scale | 0.76 |
| back wall and colonnade | 0.45 | 0.45 × scale | 0.55 |
| rail | 0.70 | 0.70 × scale | 0.30 |
| the floor, seams, marks, panels | 1.00 | scale | 0 |
| the apron's front lip | 1.55 | 1.55 × scale | in front |

Taking all three from the same number is why the layers stay consistent with
each other at every zoom instead of needing a constant tuned per layer per
scale. It is also why the whole thing survives the camera's extremes without
being checked at each one.

### `Ctx` did not have to grow

The floor seams are slanted and everything else is a rect. `beginPath`,
`moveTo`, `lineTo` and `stroke` were already on `Ctx` — the floor line has used
them since ADR-0057 — so the seams cost nothing new. No gradient (the sky is
still banded, now 16 bands anchored on the horizon rather than on the canvas),
no clip (layers are culled by index range instead), no transform (parallax is
arithmetic in `plane`, not `ctx.setTransform`).

The one thing that *was* wrong and is now fixed: below the floor line the canvas
was never painted opaque, only washed. On a page with any background but black,
the apron showed it through.

### Nothing back there can compete with a box

Aerial perspective run the usual way round — the further back a layer is, the
closer it is to the sky's own tone — means the strongest contrast in the
background is the **darkest** thing on screen, against a near-white figure and
saturated box strokes. Every colour added here is a cool grey-slate between
`rgb(6,8,13)` and `rgb(44,58,82)`, except two: the tower sills at
`rgba(150,141,126,0.055)` and the floor scuffs and seams at
`rgba(150,168,196,0.055–0.14)`. None of them is stroked, and the brightest of
them is dimmer than the 0.09 fill a hurtbox already carries.

## Decision

**The stage has a horizon**, at `EYE = 156` world units — just under a standing
fighter's crown. `plane(p)` derives a layer's parallax, scale and footing from
one number, and `jitter(n)` gives each layer its structure as a pure function of
world index, for the same reason `shakeAt` is deterministic in the frame number:
the frame stepper draws a frame more than once and must get one picture.

**Seven planes**, back to front: cloud, a jittered skyline, jittered towers with
floor lines on them, an evenly spaced colonnade on a low back wall, a rail with
posts, the fighters' own floor, and the apron's front lip. The colonnade and the
rail are regular where the ridges are jittered, because a regular rhythm is the
best ruler a lateral move has and the ridges only have to say "far away".

**The fighters' own plane is no longer empty.** Floor seams run back from each
distance mark towards the vanishing point; alternating panels shade the apron
per 100 units; three rows of scuffs sit at 0.79, 0.87 and 0.94, because seams
alone are too sparse to carry a pan across the ground between the fighters and
the rail.

**The distance marks are the brightest thing on the floor.** `0.44` alpha, `0.72`
on every fifth, which is drawn taller so 500 units can be counted without
counting to five; and each gets a riser *above* the line as well, because a tick
under the floor is invisible the moment somebody is standing on it.

## Consequences

- Measured on the page, 1100 × 819, averaged over 400 ms of repeat calls:

  | | rects | ms per frame |
  |---|---|---|
  | before, point blank (3.3×) | 32 | 0.018 |
  | after, point blank | 188 | 0.061 |
  | before, full separation (0.70×) | 48 | 0.022 |
  | after, full separation | 399 | 0.127 |

  The worst case is **0.76% of a 16.67 ms frame**, and it is the worst case
  because the wider the camera the more repeats of every layer are on screen.
  Each layer is culled to its visible index range and capped at 96 repeats, so
  no zoom can make it unbounded.

- **270 tests**, up from 266. Four new, all against a recording `Ctx` fake — the
  interface being structural is what makes that eighteen lines and no canvas.
  Three of them were run against ADR-0057's `drawStage` verbatim and fail on it,
  which is the measurement of the problem:

  | | ADR-0057 | here | the test asks for |
  |---|---|---|---|
  | of the picture, unchanged when the camera moves 80 units | 91.7% | 11.8% | under 50% |
  | parallax rates seen on two rects or more | 0 | 14 | over 2 |
  | full-width 1-px bands that move when the zoom changes | 0 of 4 | 4 of 8 | any |

  The fourth is a guard rather than a regression: that more than one distance
  mark is drawn at the floor line at four zooms, from point blank to full
  separation.
- `npx tsc --noEmit` clean. `pose:audit` unchanged in every category — nothing
  here touches the figure.
- `web/play.js` is 88.3 KB, up from 82.6.
- `web/boxes.html` is untouched: it has no stage and never called `drawStage`.
- Before and after sheets at `.scratch/stage/` — a walk at 3.3×, a walk at
  0.92×, and a neutral jump through the whole band, six frames each, plus
  `after-boxes.png` at three zooms with the boxes on. `sheet.js` there is what
  built them, through `window.play` (ADR-0051).

## Not settled

- **At the widest separation the top two thirds of the canvas is still empty.**
  A ground-pinned camera at eye height puts every solid thing near the horizon,
  and at 0.65× the horizon is 101 px above the floor on an 819-px canvas. The
  cloud layer is drawn at 2600–7600 units precisely so that something is up
  there, and it is a fudge: no city has a skyline at 46 fighter-heights. The
  honest fix is a camera that tilts, and `viewFor` cannot — `y` is
  `ground - units * scale` with no vertical offset anywhere.
- **The walls are still drawn on the fighters' plane at a fixed 260 units**,
  from ADR-0057, and now stand in front of a colonnade that knows nothing about
  them. A corner should read as the background running out, and it does not.
- **The layers do not know where the stage ends.** `half` is 765 either side and
  the skyline repeats past it forever, so walking into the corner shows more
  city rather than less.
- **Nothing here is derived from anything.** Every number in this ADR is picked
  by eye — the same standing as the recoil (ADR-0057) and the resting pose
  (ADR-0059), and unlike them there is not even a dump that *could* have said
  otherwise. A training room's backdrop is not in `moves_dict.json`.
