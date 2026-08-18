# ADR 0006 — Hit outcomes come from the game's table, and it corrected our blockstun

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md)

## Context

The engine treats advantage as the single source of truth and **derives**
blockstun and hitstun from it (`stunFrom` in `frames.ts`). That was a deliberate
minimality choice in ADR-0001, made when the real numbers weren't available.

They are available. `HIT_DT.json` in the MMDK dumps is the outcome table that an
`AttackCollisionKey`'s `AttackDataListIndex` points into — what the hit actually
does, in the game's own numbers.

## Decision

Extract it into `data/geometry/<char>.json` as `hitData`, keyed by that index,
and use it to check the derivation rather than to replace the model. Where a
character has geometry, `hitDataFor` gives the real numbers; elsewhere
`stunFrom` still derives them, now with a corrected identity.

## Findings

Each entry has a `common` list indexed by how the attack landed, and a `param`
list crossing that with the defender's state. The conditions decode themselves:

| index | damage | stun vs hit | drive to defender | reading |
|---|---|---|---|---|
| 0 | 500 | — | 0 | hit |
| 1 | 0 | −3 | +2000 | block |
| 2 | 600 | **+2** | 0 | counter hit |
| 3 | 600 | **+4** | −4000 | punish counter |

(Ryu 2MK's numbers.) Counter hit is +2 frames of hitstun and punish counter +4
on **every** mapped move across both characters — the rule of thumb everyone
quotes turns out to be exact, and `scripts/build-site.mjs` was already deriving
counter-hit advantage that way on faith.

Two results about our own identity, measured across 25 moves whose frame data is
plain enough to check:

- **Hitstun is exactly `onHit + active + recovery`** — 21 of 25, and the four
  exceptions are explained (2HP on both characters takes its active frames from
  a spliced continuation action; one target combo; one patch-skewed move).
- **Blockstun is that plus 4.** Uniformly. All 13 of Akuma's mapped moves, 8 of
  Ryu's 12, and Ryu's four stragglers are the same moves whose startup the two
  sources already disagree about — patch skew between a 2024 dump and a newer
  frame-data set, not a broken rule.

So the last 4 frames of blockstun are frames the defender can already act out
of: a **guard release** tail that advantage doesn't count. `CONTEXT.md` also
stated the identity as `advantage + (active − 1) + recovery`, one frame short of
what the code has always computed; the prose was wrong, not the code.

## Consequences

- `stunFrom(move, "block")` gains a documented `GUARD_RELEASE = 4`. Ryu 5MP now
  derives to blockstun 18, which is what the game's table says; the old test
  asserting 14 was checking the identity against itself and has been repointed
  at the real number.
- Beyond stun, each outcome carries damage, hitstop, the knockback destination
  and its duration, juggle limits, down time, and drive/super gain for both
  players — the numbers a scenario player needs to resolve a hit rather than
  just time it.
- The airborne variant is kept alongside: a move that pushes a grounded opponent
  50 units back launches an airborne one 100 up and 70 back, which is why air
  hits can't reuse the grounded outcome.
- The table is per attack, not per move, so multi-hit moves expose a sequence of
  outcomes (`hitDataSequence`).
- Not extracted: the remaining ~180 fields per entry (sound, camera shake, VFX,
  hit sparks), and the `param` matrix beyond its airborne column.
