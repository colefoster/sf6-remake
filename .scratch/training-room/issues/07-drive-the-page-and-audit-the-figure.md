# 07 — Drive the page from a script, then audit the figure

Status: `done` — ADR-0051
Follows: `06-the-figure-is-jank.md`, ADR-0050

## The ask

Make the engine programmatically interactive, then use Playwright and screenshots
to find and fix the remaining stick-man jank.

## Why the surface had to come first

Issue 06 fixed the five moves someone had looked at. Looking at a sixth meant
holding `j` for the right number of frame-steps, and looking at anything that
cannot be input from neutral — most of a 309-action roster — was not possible at
all. Nothing could be audited through a keyboard.

`window.play` on `web/play.html`:

| | |
|---|---|
| `select(side, id)` | load a character |
| `actions(side, filter)` | what it can do, with hurt extents |
| `scrub(side, action, frame)` | put a fighter on any action and frame, no match |
| `press(keys, frames, side)` | hold buttons for n *match* frames |
| `step(frames)` | advance the match |
| `pose(side)` | the joints, as numbers |
| `frame(side, span, solo)` | one fighter, fixed camera, for comparable shots |
| `pause` `boxes` `figures` `state` `reset` | the buttons, callable |

`press`/`step` tick the match directly instead of waiting on the animation frame,
so a script gets a deterministic result from one `evaluate`. `scrub` replays the
pose chain from the idle pose so a held-over part is held as it would be in play.

## What the audit found

`npm run pose:audit` scores all 385,607 poses against what a body cannot do.
Four rules came out of it, all of them the figure believing something the boxes
were not saying — a box tagged to all three parts, a part whose every box is out
on a limb, parts in the wrong order for a somersault, and a hitbox 524 units from
the nearest hurtbox drawn as an arm. Full write-up and the before/after counts
are in ADR-0051.

## Done when

- [x] the page drivable from a script, deterministically
- [x] an audit that ranks jank without eyes on it
- [x] every category down; head-off-the-shoulders 8,946 → 71
- [x] the residuals identified as the dump rather than the derivation
- [x] 236 tests green
- [x] the screenshot harness committed too — `npm run figure:sheet -- ryu:5LK:1,3,6`

## Not done

- Drawing a limb from its own hurtbox on startup and recovery frames. The
  footprint filter isolates exactly those boxes and throws them away.
