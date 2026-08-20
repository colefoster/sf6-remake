# ADR 0052 — The opponent is a function, and the panel asks the questions

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md)

## Context

ADR-0049 shipped the unresponsive dummy the spec asked for — `hold(5)`, P2 takes
what it is given — and deferred the scripted behaviours "until watching the
figures says which are worth having". Watching them said: **the panel's own
headline feature cannot be demonstrated without one.** Issue 04's acceptance test
is *"blocking Ryu's 2MK shows −4 without running the CLI"*, and a dummy that
never blocks has no advantage-on-block to show, no blockstun to count and no
punish window to open.

## Findings

### An opponent stays a function, and the behaviours are five lines each

`Match.advance(p1, p2)` takes two input frames, so an opponent is
`(match, side) => InputFrame` and `match.ts` never learns these exist. `stand`,
`crouch`, `blockAll`, `blockAfterFirstHit` and `mash` are `src/game/dummy.ts`, 90
lines including the comments.

Two things the behaviours could not be naive about:

- **Blocking has a height, and the attack states it.** `contactType` refuses a
  low blocked standing, so `blockAll` reads the incoming action's own `low` flag
  and holds down-back for it. Ryu's 2MK puts Ken in `GRD_CM`, his 5HP in
  `GRD_MH` — the engine picking the crouching reaction is the confirmation that
  the dummy picked the right stance.
- **Holding back is walking backwards.** A dummy that holds it unconditionally is
  in the corner within a few exchanges, which is a different training scenario
  than the one asked for. Back goes down only while something is on the way: the
  opponent mid-swing counting start-up, a live projectile, or blockstun already
  running.
- **Mashing is a press, not a hold.** A trigger fires on the press and a held
  button is one press however long it is held, so `mash` alternates frames.

### Advantage and the punish window are questions, not state

Neither is anything the match keeps. Advantage is the gap between the two
fighters becoming actionable, readable only by watching both and subtracting; the
punish window is *what the free fighter could have started* before the other one
recovered. `src/game/training.ts` owns both — `Advantage`, fed every advanced
frame, and `punishes(match, side, window)`, which filters the fighter's own
neutral list by start-up against the window and by `reach()` against the gap the
two are actually standing at.

That needed one thing from the runtime: `Fighter.neutralActions`, the private
neutral trigger list resolved to actions. The state machine asks the same
question through `options()`, which also has to handle mid-action cancel windows.

### The punish is spacing, not just speed

Ryu's 2MK blocked point blank leaves −6 and Ken two answers, and the fastest is
not a light: at that range 5LP's 141 units of reach falls short of the gap and
`SPA_TATSUMAKI_END`'s 224 does not. A panel that offered "the fastest thing you
have" without asking whether it reaches would have been wrong most of the time.

## Decision

`src/game/dummy.ts`, `src/game/training.ts`, both exported through `browser.ts`.
`web/play.html` gains the five dummies in its P2 dropdown and four panel rows:
punish, stun/floor per side, and the combo each side is taking with its scaling.

## Consequences

- Blocked Ryu 2MK reads **−6** on screen with `P2 +6 — TATSUMAKI_END 4f · 5LK 5f`
  beside it; blocked 5HP reads −2 with nothing in range. 2MK on hit shows the
  combo at `1 × 500 @80%` — ADR-0032's starter penalty, live.
- Five tests on the height rule, the corner walk, the press, the resolved
  advantage and the empty window. 241 green.
- The control surface's `step` / `press` / `scrub` now refresh the panel as well
  as the canvas, so a script reads the same DOM a player does.

## Not settled

- **`SPA_TATSUMAKI_END` is offered as a 4-frame punish.** It is in Ken's neutral
  trigger list and the list is the game's own, but a chain tail with a 4-frame
  first active window is more likely the dump grouping a family than a move
  anybody can press. Nothing filters it, because filtering by name is exactly the
  authoring this project does not do. Worth its own look.
- **Throw-tech, punish-after-block and DI on wake-up** from the spec are not
  built. Each is the same five lines against the same signature.
- The panel shows the punish that *was* available, held until the next exchange.
  It does not count down a live window.
