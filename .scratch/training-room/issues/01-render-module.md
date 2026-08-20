# 01 — A render module behind the bundle seam

Status: `ready-for-agent` — `play.html` done (ADR-0049); `boxes.html` not yet ported

## Why

`web/play.html` and `web/boxes.html` each compute their own game-unit → screen
transform, their own camera, and their own box drawing. `web/index.html` is a
third hand-written page. ADR-0028 stopped the *logic* from being written twice by
bundling `src/game/browser.ts` into `web/play.js`; the rendering is now being
written twice behind that same seam, and it is the reason a stick figure has not
happened — it would have to be added to both pages.

## What

`src/game/render.ts`, exported through `src/game/browser.ts`, owning:

- `view(canvas, opts)` → the transform: game units to pixels, the ground line,
  the camera that keeps both fighters framed without letting them shrink to
  nothing when far apart (`play.html` already solved this — move it, do not
  reinvent it)
- `drawBoxes(ctx, view, { hurt, hit, push, throwable })` — one implementation of
  what both pages draw today, colours included
- `drawStage(ctx, view, { corners, ground })`
- `drawGauges(ctx, view, match)` — health, Drive in its six bars, super in three

Nothing here may reach the filesystem — the `external: []` guard in
`build-play.mjs` will fail the build if it does, which is the point.

Then port both pages onto it: `play.html` first (it is smaller and its camera is
the better one), `boxes.html` second.

## Done when

- `play.html` and `boxes.html` contain no box-drawing or scale arithmetic of
  their own
- `npm run build:play` still reports a bundle size and the page still runs
- The two pages look the same as before, by eye, on Ryu vs Ken
