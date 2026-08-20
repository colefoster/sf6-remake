# 04 — The panel says what the engine knows

Status: `ready-for-agent` — advantage and the input strip done (ADR-0049); punish window and stun counters remain
Depends on: `01-render-module.md`

## Why

The engine computes frame advantage, punish windows, combo scaling and an input
history. The page shows an action name, a frame number and a hit log.

## What

In the side panel of `play.html`, all from `match` state:

- **advantage** on block and on hit, live, the moment both fighters are
  actionable — the number `sf6 adv` prints, on screen while you play
- **punish window** — when the defender is plus, the fastest thing they have that
  reaches, from the mapping and `reach()`
- **combo** — hits, damage, and the scaling actually applied (ADR-0032's starter
  penalty), reset when the combo drops
- **input display** — `InputHistory` as a notation strip, newest at the bottom,
  so a missed motion is visible as a missed motion
- **stun / floor** — hitstun, blockstun and `DownTime` counting down, since
  those are the numbers the whole project grades

## Done when

- Blocking Ryu's 2MK shows −4 (or whatever the current tree says) without
  running the CLI
- A dropped combo visibly resets the counter
- The input strip shows `236` + `P` when a Hadoken comes out, and shows what came
  out instead when it does not
