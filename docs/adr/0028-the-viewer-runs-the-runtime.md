# ADR 0028 — The viewer runs the runtime, it does not re-implement it

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0007](./0007-scenario-player.md),
  [ADR-0027](./0027-two-fighters-and-the-reaction-the-table-asks-for.md)

## Context

ADR-0027 made the runtime playable from the CLI. A fighting game you can only
read as a table of frame numbers is not one you can play, so it needs a screen.

The existing box viewer (`web/boxes.html`) sets the precedent and the warning:
it reimplements the advantage calculation in about twenty lines of browser
JavaScript, because `src/sim` reads the file system and cannot be imported into a
page. That duplication has been a known caveat since ADR-0007. Repeating it for a
whole state machine, input reader and contact resolver would be a second engine
to keep in step with the first.

## Findings

### The only thing stopping the runtime running in a browser was the loader

`src/data/geometry.ts` is 800 lines of pure box arithmetic and three lines of
`node:fs`. Those three lines were enough to make the entire module — and
therefore `src/game`, and therefore any page — unbundlable.

Splitting `loadGeometry` and `hasGeometry` into `src/data/load-geometry.ts`
leaves the decode side pure, and the runtime bundles to **23 KB** with no
polyfills and no externals. `esbuild` is configured with `external: []`
deliberately: if anything under `src/game` ever reaches for the file system
again, the build fails rather than the page failing.

`Fighter` and `Match` now take a `GeometryFile` outright rather than a name;
`src/game/load.ts` is the Node-side convenience. The viewer already fetched
`<char>.boxes.json`, which is byte-identical to `data/geometry/<char>.json`, so
it hands over the object it has.

### The boxes are the presentation, and that is not a compromise

There is no art to draw. The game's assets cannot be redistributed
(`ATTRIBUTION.md`), and drawing a placeholder figure over the collision data
would replace evidence with decoration — the whole claim of this project is that
these are the game's own boxes.

So the page draws them: hurtboxes blue, hitboxes red, pushboxes grey, tiled head
over body over leg exactly as the extractor records them, with the origin marked
on the floor. A hitbox flashes on its true active frames. It reads as a frame-data
lab you can play, which is what this is.

### And it does not ship

`data/geometry/` is gitignored and not redistributable. `web/play.js` is compiled
from `src/game` and gitignored too, for the ordinary reason. So the page is not
something that can be hosted click-to-play: it is `npm run play`, after
`npm run geometry`. That is a product constraint rather than an oversight, and it
is better stated here than discovered later.

## Decision

Split `src/data/load-geometry.ts` out of `geometry.ts`. Make `Fighter` and
`Match` take geometry rather than a name, and add `src/game/load.ts` for Node.

Add `src/game/browser.ts` as the bundle entry and `scripts/build-play.mjs` to
compile it to `web/play.js` with esbuild — already a transitive dependency, and
the repo keeps its zero *runtime* dependencies.

Add `web/play.html`: canvas, two fighters, keyboard for both, health bars, an
action and frame readout, a contact log, pause / frame-step / reset, and a boxes
toggle. `npm run play` builds and serves it.

## Consequences

- Ryu walks into range, throws a medium punch, and Ken takes 600 into `DMG_LM` —
  on screen, from the same `Match` that `sf6 fight` runs.
- The bundle is 23 KB and there is no second implementation of anything.
- `geometryFor(character, move)` becomes `geometryFor(geo, move)`, which is the
  one signature change this cost outside `src/game`.
- 165 tests pass; `sf6 verify` is unchanged at 93.2 / 88.7 / 94.2 / 90.1 / 81.8%.

## Not settled

- **`web/boxes.html` still duplicates the advantage calculation.** The seam that
  would let it stop exists now, and using it is a separate change.
- **No sound, no camera shake, no hit sparks.** The `HIT_DT` columns for the last
  two were extracted in ADR-0025 and are unread.
- **Two players share one keyboard, and there is no AI.** The second fighter is a
  person or a statue.
- **The page cannot be hosted.** It needs `npm run geometry` first, which needs
  the MMDK dumps, which are not redistributed.
- **Nothing grades the renderer.** The plan for this stage called for a headless
  ASCII mode so a replay could be checked in CI against the Node run's state
  hash; `sf6 fight` is that, informally, and there is no state hash yet.
