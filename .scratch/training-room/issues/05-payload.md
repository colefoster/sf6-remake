# 05 — A payload a browser should download

Status: `needs-info` (blocked on: does this deploy publicly?)

## Why

`web/` is 45 MB. Each character's geometry is 0.65–1.38 MB and the page fetches
a whole file per fighter. 205 of Ryu's 309 actions are hurtbox-only states
nothing draws, and every box coordinate is a full-precision number.

Irrelevant on localhost. Blocking if this goes on `colefoster.ca`.

## What, if it deploys

A build step emitting `<char>.play.json` beside the full artifact:

- drop actions nothing can reach in a match (round intros, win poses, demos) —
  keep `NGD_*`, which ADR-0025 kept for a reason
- drop `commands`, `unmapped`, and the FAT snapshot on each move — the page needs
  triggers and boxes, not the grading metadata
- round box coordinates to integers (they already are, in game units) and drop
  duplicate consecutive keys

Target: under 150 KB per fighter, and the viewer keeps using the full file.

## Open question for the maintainer

Does this deploy? If yes, `deployer` handles `ash` + Cloudflare and this becomes
worth doing before the render module hardens. If no, close as `wontfix` and
revisit.
