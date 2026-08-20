# ADR 0053 — One renderer, two cameras

- Status: accepted
- Date: 2026-08-20
- Completes: [ADR-0028](./0028-the-viewer-runs-the-runtime.md),
  [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md)

## Context

ADR-0028 stopped the *logic* being written twice by bundling `src/game` for the
browser. ADR-0049 built `src/game/render.ts` for the *view* and put `play.html`
through it, and left the other half undone: `web/boxes.html` still carried its
own `hurtAt`, `originAt`, `pushAt`, `pushHalfWidth`, `minDistance`,
`activeWindows`, `actionById`, `worldHitboxes`, `maxReach`, `connectFrames`,
`mirrored`, `overlaps`, `hitDataFor`, `actionableFrame` and a canvas transform —
the same duplication, one layer up, 200 lines of it.

## Findings

### The viewer needed a different camera, not a different renderer

`viewFor` follows two fighters around a stage and stops at the walls. The box
viewer has no stage and no second fighter: it has one action, a distance slider,
and a requirement that scrubbing the frame not move anything. So it frames the
*action's own bounds* — every box of every key, plus where the motion curve takes
them — and pins the ground.

That is one function, `viewForAction`, beside `viewFor` in the same module,
returning the same `View`. Everything downstream — `drawBox`, `drawFigure` — is
shared, which is the whole point: two cameras, one renderer.

### One palette, because there is one `drawBox`

The pages had drifted to different colours for the same thing (hurt `#3b82f6`
against `#4d8cff`, push grey against purple). The viewer's is the survivor: it is
the richer of the two, having had to tell a throw box from a proximity box from a
leg. `play.html`'s pushboxes are purple now.

### `poseOf` never wanted a `Fighter`

It reads `state.action`, `state.frame`, `state.facing` and `position()`. Naming
that shape — `Posed` — is what let the box viewer draw the figure at all: it has
an action selected and no match running. The stick figure was two lines of
wiring, because the boxes it derives from were already on the page.

### Two duplications were not the same duplication

`outcomeAt` in the viewer plays advantage out from the boxes and the hit table
and compares it against FAT's published number. That is a *check*, and it stays
where it is. What did not need to stay was the viewer's private copy of
`actionableFrame`, which was a frame out from `src/data/geometry`'s on an action
that ends in the air.

## Decision

`boundsOf`, `viewForAction`, `drawBox` and the palette in `src/game/render.ts`;
`proxboxesAt`, `throwboxesAt` and `idlePushboxes` in `src/data/geometry.ts`;
`Posed` as the drawing's own view of a fighter. `web/boxes.html` imports all of
it from `./play.js` and keeps its nav, its readouts and its independent advantage
check.

## Consequences

- `web/boxes.html` is 200 lines lighter and contains no geometry or transform
  arithmetic. It gained the stick figure and a toggle for it.
- Ryu's 2MK in the viewer reads `contact on frame 8, blocked — matches the
  published −6`, and the same move blocked in `play.html` reads −6. Two pages,
  one derivation, agreeing.
- `web/play.js` is 64 KB, up from 55 — the viewer pulls in the spacing helpers.
- 242 tests. The pose audit is unchanged, which is the point of running it.

## Not settled

- **`web/index.html` is still a third hand-written page.** It draws no boxes, so
  it is outside this seam, but it fetches the same JSON and formats the same
  frame data by hand.
- The viewer's fireball still reads "whiff": a projectile's parent action carries
  no hitbox (ADR-0022), so a spacing question asked of `SPA_HADO` has nothing to
  measure. The flight is decoded (ADR-0040); the viewer does not show it.
