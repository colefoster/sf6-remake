# ADR 0040 — A fireball outlives its action, and a second hit is a second body

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md),
  [ADR-0023](./0023-the-sim-throws-a-fireball.md),
  [ADR-0029](./0029-the-match-throws-fireballs-and-two-of-them-meet.md),
  [ADR-0032](./0032-a-combo-is-a-hitid-a-counter-and-one-scaling-number.md)

## Context

Two of ADR-0029's open items were about the same object and had never been put
side by side.

**Ken's Hadoken is a six-frame stub.** His three Hadokens spawn an action that
runs 6 frames and travels 30, 35 and 40 units, where Ryu's runs 70 and travels
586. Ken's fireball died in front of him, in the match and in the scenario
player alike.

**A multi-hit projectile is a type-45 branch.** ADR-0032 found that Ryu's OD
Hadoken carries two hit keys with the same `HitID` — one hit by ADR-0024's rule
— and that the second hit is a `BranchKey` of type 45 into a different action
with its own row. It recorded the structure and modelled none of it.

## Findings

### No shot action is as long as its flight, so the action was never the lifetime

Ryu's Hadoken is the *long* one and it is 70 frames at 5.5 units a frame: 385
units of a stage that is 1530 wide. It does not reach the other corner either.
Once you notice that, Ken stops being an anomaly and the premise is the bug —
the action is the **authored** part of a flight, not its duration.

Everything past the last authored frame is the same box carried on at the same
speed. The exception is a shot that has no speed left: Ryu's Hashogeki and
A.K.I.'s Jatoben are stationary by design (ADR-0023), and those do end with
their animation, which is what `flightEnds` asks.

### The speed is in the dump, and FAT publishes it

The projectile's `SteerKey` is not a curve but a **fixed velocity** —
`_IsFixValue` with a `FixValue` of 5.5 for Ryu's LP Hadoken and 6 for Ken's.
FAT publishes `Projectile Speed: 0.055` and `0.06` in `extraInfo`.

The factor is **100**, the same one ADR-0034 found turning published throw range
into game units, and the same ruler ADR-0030 borrowed the stage width with. It
grades at **29/38** on launch velocity.

That check earns its place twice over, because it is the only thing in the
project that grades the special-move **mapping** without going through frames.
Ryu's Hadoken family is six actions of identical length at 5.5 / 7 / 8.5 / 9.5 /
12 / 14.5, and the mapper has 236HP on the 12. Every frame-based check is blind
to that; this one is not.

### A second hit is a second *body*

The type-45 branch target is a whole projectile: `_1056 PROJ` is 70 frames with
its own hit row (167 against the parent's 163) and its own velocity (12). It is
not a second hitbox on one fireball, it is a second fireball flying alongside.

Counting a shot plus its type-45 branches against FAT's "N-hit projectile"
agrees on **45 of 52 specials**. It does *not* work on supers (48/66 over the
whole population): Chun-Li's Kikoushou is published as 5 hits and puts two
bodies in the air, because the rest of its hits are repeats in time. So the
check is reported for specials, where the reading holds, and the super
population is recorded as a miss rather than folded in.

## Decision

Extract `motion.velocity` (the speed still carried when the curve ends) and
`motion.launch` (the speed it set off at) on every action.

Add `flightOrigin`, `flightHitboxes` and `flightEnds` to the geometry module. A
projectile past its action's last frame holds that frame's boxes and integrates
`velocity`; it is retired by the wall, or by its action if it has stopped.

Make `spawnsFrom` return the type-45 branch target as a second `Spawn`.

Add `src/verify/projectiles.ts`, grading launch speed and special hit count.

## Consequences

- Ken's HP Hadoken connects at 500 units on frame 54. Before this it could not
  connect past about 170.
- Ryu's OD Hadoken puts two bodies in the air in the match and the sim.
- `sf6 verify` gains a projectiles section: speed 29/38 76.3%, hit count 45/52
  86.5%.
- The original five are unmoved: 93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 208 tests pass.

## Not settled

- ~~**Ryu's 236HP is mapped to the wrong action**~~ — 12 against a published
  0.085, most likely the Denjin variant. Closed by
  [ADR-0048](./0048-javascript-hoisted-the-denjin-hadoken.md): it *was* the Denjin
  variant, and the cause was JavaScript hoisting integer-like keys so the mapper
  read `triggers.json` in the wrong order. Five rows moved, all Ryu's, and the
  speed check went 78.9% → 81.6%.
  **236PP was not the mapper.**
  [ADR-0042](./0042-the-atemi-table-was-behind-another-button.md) grades a live
  dump: OD Hadoken's `SPA_HADO(3) PROJ` is 9.5 in the pinned snapshot and 11.2 in
  the current game, which is FAT's 0.112 exactly. The residual was version skew.
  236HP's is not — its action is 8.5 in both trees.
- **A super's hit count is not its body count.** Nine published multi-hit
  projectile supers put fewer bodies in the air than they have hits, and what
  repeats them is not decoded.
- **Nine speeds disagree**, of which Ken's OD `0.95` is a FAT typo for `0.095`
  (the dump says 9.5) and Guile's `214LP` publishes `0` for a blade the dump
  gives no velocity at all.
- **A fireball still has no hurtbox.** ADR-0029's finding stands: the shot's own
  hurtboxes are in the dump and unread, so nothing but another fireball clears one.
