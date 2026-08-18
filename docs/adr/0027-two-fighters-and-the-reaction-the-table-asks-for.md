# ADR 0027 — Two fighters, and the reaction the table asks for

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0006](./0006-hit-data.md),
  [ADR-0008](./0008-cancel-windows.md),
  [ADR-0025](./0025-what-to-press-and-what-a-hit-does-to-you.md),
  [ADR-0026](./0026-the-fighter-moves-under-its-own-power.md)

## Context

ADR-0026 gave the runtime a fighter that moves. This gives it attacks, a second
fighter, and contact — the point at which the project stops being a frame-data
engine with a viewer and becomes something you can play.

Three things had to be decoded first, and two of them turned out to be one field.

## Findings

### `dc_exc_flags` is the direction a button has to be pressed with

Ryu's `5MP`, `2MP` and `6MP` are three triggers, one button, and identical in
every field but one: `norm.dc_exc_flags` is 0, 2 and 8. That is the same
direction nibble ADR-0025 decoded — neutral, down, forward — and it is the only
thing separating a crouching normal from a standing one.

Read across the neutral list it is exact: `4HK` and `4HP` read back, `2LP`
through `2HK` read down, `6MP`, `6HP` and `3HK` read forward.

### The reaction is `part` + `strength`, and the check is that the action exists

A hit row carries `_IsStrength_L/M/H/S` and `DmgPart`. The fighters carry
`DMG_{H,M,L,C,D}{M,H}` and `GRD_{H,M,L,C,D}{M,H}` — fifteen of each. Reading
`part` as the height letter and `strength` as the suffix, with `L`/`M` folding
to `M` and `H`/`S` to `H`, and a crouching defender using the `C`/`D` pair:

**Every one of the 3,167 hit rows on the roster names an action that exists.**
That is what makes it a decode rather than a guess — a wrong reading names a
`DMG_*` the fighter does not have, and 122 rows did exactly that until `part: 3`
was folded in with the low ones.

`part: 3` is worth naming: the rows carrying it are overwhelmingly kicks — `5LK`,
`2LK`, `2MK`, `2HK` — which suggests it is the *body part* that struck rather
than the height it struck at. Folding it to `L` produces an action that exists on
every fighter, and nothing yet distinguishes that from the alternative.

### The reaction names the animation; the table names the duration

The obvious next hypothesis is that the reaction action's own `MarginFrame` is
the stun. It is not. `GRD_*M` states 17 and `GRD_*H` 25 on every fighter, and
those agree with the hit table's `HitStun` on **134 of 3,167 rows**.

So the animation is generic and the table is authoritative: two sources for one
quantity, and the specific one wins. Recorded because the alternative is
attractive and wrong.

### One contact per swing, and the boundary is the action instance

A hitbox is out for three frames and hitstop is eleven. During hitstop the whole
match is frozen — including the attacker's action clock — so the same hitbox is
still overlapping the same hurtbox when it resumes. Anything that deduplicates
on *time* re-hits: the first version drained Ken to nothing off a single medium
punch, four hits, twelve frames apart, forever.

The honest boundary is the attacker's action **instance** — bumped every time an
action is entered. Multi-hit moves need juggles, which is a later stage, and
ADR-0024 already established how many hits a move actually has.

### Counter and punish counter are before and after the last active frame

`actionable()` is false for both a defender in start-up and one in recovery, so
it cannot tell them apart. The active window can: caught at or before its last
active frame is a counter hit, after it a punish counter. That is SF6's own rule
and the reason ADR-0006's two extra outcome rows exist.

The counter row is the game's, not a multiplier applied here — Ryu's 5MP does
600 on hit and the table's own counter row does 720.

### `MarginFrame` is the last committed frame, not the first free one

ADR-0011 says so and `actionableFrame()` returns `marginFrame + 1`. The runtime
read it as `frame >= marginFrame`, which made every move one frame more plus
than the scenario player said — invisible until the two were compared.

That comparison is the point: **`src/game` and `src/sim` now agree on the
advantage of a blocked move**, from two completely different code paths. The sim
plays one action against a passive dummy; the match plays two fighters that
walk, block, get pushed apart and knocked back. Neither reads a published number.

## Decision

Give `Fighter` buttons: presses tracked with their own timestamps so a trigger's
`preceding_time` buffer is real, options resolved from the neutral list or —
mid-attack — from the action's own open cancel windows, and a specificity order
so that crouching and pressing MK finds `2MK` rather than `5MK` and LP+LK finds
the throw rather than the jab.

Add `src/game/match.ts`: two fighters on one clock, pushbox separation, facing,
box-overlap contact, `contactType` from the defender's actual state, the reaction
from `reactionFor`, stun from the table, hitstop, knockback and health.

Assert the invariant that the match's advantage equals the scenario player's.

Add `sf6 fight <a> <b> <script> [script]`, where a script is
`<numpad>[+BTN]x<frames>` steps: `2+MKx3,5x60`.

## Consequences

- `sf6 fight ryu ken "2+MKx3,5x60" "3x80" --at 150` prints a blocked crouching
  MK into `GRD_CM`, 16 frames of stun, Ken pushed from 150 units to 205.
- `2MK xx HP Hadoken` comes out, through the game's own cancel window, into the
  right strength, off a button pressed inside the buffer.
- 165 tests pass. `sf6 verify` is unchanged: nothing in `src/game` is imported by
  the grader, the engine or the sim.
- The advantage invariant caught the `MarginFrame` off-by-one immediately, which
  is the argument for having written it before the feature it guards.

## Not settled

- **Blocking's rule is asserted.** Holding back on the ground blocks; a low must
  be blocked crouching and an overhead standing. The dump flags the attack, not
  what beats it.
- **Projectiles are in `src/sim` and not here.** `sf6 fight ryu ken 236+HPx3`
  throws nothing. The scenario player models a fireball as a second actor
  (ADR-0023) and the match does not yet.
- **One hit per swing means multi-hit moves under-hit.** 142 moves genuinely
  connect more than once (ADR-0024) and every one of them lands once here.
- **No juggles, no combo scaling, no corner, no throws as a state, no Drive or
  super gauge.** `NGS` comes out on LP+LK and connects as an ordinary attack;
  `NGD_*`, the being-thrown state ADR-0025 re-admitted, is never entered.
- **`part: 3` is folded to `L` on the evidence that it produces an action that
  exists.** Its rows are mostly kicks, which suggests it is a body part rather
  than a height. Nothing distinguishes the two readings yet, and getting it wrong
  changes only which animation plays — the stun comes from the table either way.
- **The dummy never blocks a mix-up correctly by itself.** There is no AI; the
  second fighter is a script.
