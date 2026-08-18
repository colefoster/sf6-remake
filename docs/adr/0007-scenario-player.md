# ADR 0007 — A scenario player, and what it proves

- Status: accepted
- Date: 2026-08-17
- Builds on: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0005](./0005-origin-motion-from-place-and-steer-keys.md),
  [ADR-0006](./0006-hit-data.md)

## Context

ADR-0001 chose a frame-data engine over a simulation, because simulating needed
geometry and physics we didn't have. We have them now: boxes, the origin's
per-frame path, pushboxes, and the game's own outcome table.

## Decision

Add `src/sim` — two fighters on a shared 60 fps clock — **without** retiring the
frame-data engine. The engine answers frame questions in closed form; the sim
answers *positional* ones by playing them out. They are independent
derivations of the same truth, which is the point.

The sim never reads `onBlock` / `onHit`. It advances the attacking action frame
by frame, finds contact by hitbox-vs-hurtbox overlap at a given spacing, takes
stun and knockback from the hit-data table, subtracts the guard release, and
reports who becomes actionable first.

## The check that matters

Because it never reads the published advantage, it can be compared against it.
Run every mapped normal at the spacing the game would put them at:

| | blocked | on hit |
|---|---|---|
| Akuma | **13 / 13 exact** | 11 / 13 |
| Ryu | 8 / 12 | 10 / 12 |

Every miss is a move already flagged in ADR-0006 as one where the 2024 dump and
the frame-data set disagree (Ryu's 5HK, 2LK, 2HP, one target combo; 2HP and 2MK
on hit). Nothing new broke — the sim inherits exactly the known skew and nothing
else. `tests/sim.test.ts` locks this in, requiring Akuma to be perfect on block.

Meaty depth also falls out rather than being applied: contact simply isn't
tested until the chosen active frame, and advantage improves one frame per frame
of depth, matching the rule `CONTEXT.md` states.

## Consequences

- `sf6 play <char> <move> [--at N] [--vs char] [--on hit] [--crouch] [--meaty N]`
  prints the frame-by-frame story: hitbox out, contact, stun, knockback, who
  acts first, drive gained.
- Every scenario returns its full `frames` timeline (positions, phase, stun per
  frame), so a viewer can replay it without re-deriving anything.
- Spacing is honest in both directions: the fighters can't start closer than
  their pushboxes allow, and a move that walks in shoves the dummy before it hits.

## Not modelled

Inputs and buffers; the cancel and trigger state machine; drive and super
systems beyond reporting gain; juggle chains; throws; projectiles as their own
actors; the corner. The dummy blocks or stands — it never fights back, so
frame traps and counter hits are still questions for the frame-data engine
(`sf6 gap`, `sf6 punish`) rather than for the sim. Those need the trigger data
in `triggers.json` / `tgroups.json`, which remains unread.
