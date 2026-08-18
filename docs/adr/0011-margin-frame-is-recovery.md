# ADR 0011 — `MarginFrame` is recovery, and the sim now reads nothing published

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0007](./0007-scenario-player.md), [ADR-0010](./0010-the-grader.md)
- Extended by: [ADR-0012](./0012-landing-recovery.md) — the actions with no
  margin at all turn out to keep theirs on the landing they branch into.

## Context

ADR-0010 amended the record on how independent the scenario player really was.
It never reads `onBlock` or `onHit` — that part of ADR-0007 was exact — but it
did read FAT's `active` and `recovery` to know when the attacker recovers. Since
published blockstun is `onBlock + active + recovery + 4`, two thirds of the
identity were coming from the source being checked. What the sim proved was
narrower than "derived, not looked up" implied.

The number to close that gap has been in every extracted file since ADR-0004.
`scripts/extract-geometry.mjs` emits `marginFrame` and `src/data/geometry.ts`
types it, and nothing had ever read it.

## Decision

Take the attacker's recovery from the action's own `MarginFrame`, in the frame
space the sim is already counting in, and fall back on the published
`active + recovery` only where an action has no margin recorded. Record which
was used on the result (`recoverySource`).

## Findings

**`MarginFrame` is the last frame the attacker is committed to; you are free on
the next one.** Two things establish it:

- **It is strictly less than the action's own `frames` on all 484 mapped moves,
  and on every action in the roster** — never equal, never greater. An animation
  length would equal `frames`. This is what "the animation plays on past the
  point you can act" looks like, and it is the fact that settles what the field
  is. The alternative reading — that it is the animation's length — is not
  merely unsupported, it is contradicted.
- **It equals FAT's published `total` on 94.0% of moves and 97.6% of exactly
  mapped ones**, once one structural difference is accounted for.

That difference: **FAT measures a target combo's `total` from the start of the
whole string, while `MarginFrame` measures the action alone.**

| population | agreement |
|---|---|
| plain inputs (`5MP`, `2HK`) | 363/386 — 94.0% |
| plain and exactly mapped | 279/286 — **97.6%** |
| chained inputs (`5MP > LK`, `236K > MK`) | 58/98 — 59.2% |

The chained figure is not error. `5MP > LK` maps to `ATK_5LK`, whose margin is
18; FAT publishes 23 for the string. **The sim is more right than FAT here**,
because it plays one action and the action's own number is the one that applies.

What is left after that split is 23 disagreements on plain inputs: eight are
multi-hit specials, supers and command throws where FAT's `total` is measured to
a different endpoint (Chun-Li's SA2 reads 73 against FAT's 144, Lily's enhanced
DP 138 against 60), and the rest are the ±1-3 patch skew already documented.

## Consequences

- **The sim's advantage no longer touches the published frame data.** Stun comes
  from the hit table, recovery from `MarginFrame`, contact from box overlap,
  positions from the extracted motion. Comparing its answer to FAT's `onBlock`
  is now two independent sources agreeing.
- **Accuracy is unchanged: 204 of 221 either way.** Four moves changed hands —
  Ryu 2HP and Terry 2HK fixed, Guile 6MP and Manon 5MP broken — and all four are
  moves `sf6 verify` already flags as disagreeing on `total`. The sim inherits
  the dump's skew instead of FAT's, and nothing new broke. That the number did
  not move is the point: what changed is what it means.
- `advantage` joins the grader as a fifth check (86.9% on the clean population,
  the lowest of the five because it compounds three extractions into one
  number). `src/verify` imports `src/sim` to do it; the arrow points that way on
  purpose, and a grader may read what it grades so long as it is never read back.
- **The duplicated advantage math in `web/boxes.html` got smaller.** It parsed
  `move.fat.active` and `move.fat.recovery` behind a `Number.isFinite` guard,
  because those strings can read `"11(13)"`. `marginFrame` is one integer with no
  parse and no guard. The duplication ADR-0007 flagged still exists — the viewer
  cannot import `src/sim`, which reads through `node:fs` — but it is three lines
  rather than six and has lost its fragile part.
- `actionableFrame(action)` is the read side, returning `marginFrame + 1` or
  `undefined`. 157 of 613 normals have no margin recorded and keep the fallback.
- The README's claim about the sim is corrected rather than caveated: it was
  amended in ADR-0010 to admit the FAT inputs, and this removes them.

## Not settled

Whether `MarginFrame` is the frame the attacker can *act* or the frame the
action is *cancellable* into a recovery state is not distinguished by this data;
both predict the same number for a normal. A move with a special recovery — a
landing, a knockdown — could tell them apart, and those are exactly the eight
multi-hit outliers above. Composing an action with its continuation
(ADR-0005's deferred jump-arc problem, ADR-0004's downed pushbox) is the same
piece of work and would close all three at once.
