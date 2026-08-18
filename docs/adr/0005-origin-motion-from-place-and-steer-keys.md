# ADR 0005 — The character origin moves, and spacing is measured from where the move began

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md)

## Context

ADR-0004 left one gap: boxes are placed relative to the character origin, and
the origin travels during dashes, jumps and stepping attacks. Without it, every
moving move's boxes were the right shape at the wrong world position, and reach
was understated for anything that steps in — which is most of the buttons people
actually ask spacing questions about.

The dumps carry the movement too, in two key types that had gone unread.

## Decision

Extract a per-frame origin path (`action.motion`) and measure spacing from the
position the attacker held **when the move began**, not from wherever the origin
ends up mid-move. That is the question a player is asking: *if I press this from
here, does it hit?*

## Findings (the movement model)

- **`PlaceKey`** is an explicit per-frame position curve on one axis: a `PosList`
  of absolute offsets from the action's starting position. Ryu's forward dash is
  `0, 8.19, 16.72, … 125.21` — the dash covers 125 units over 16 frames and then
  holds. His back dash covers 92.
- **`SteerKey`** sets velocity and acceleration: `ValueType` 0/1 are x/y
  velocity, 3/4 are x/y acceleration. Ryu's forward jump sets x velocity 5,
  y velocity 24 and gravity −1.17, which integrates to a 234-unit apex around
  frame 21 and predicts ~41 frames of airtime for an action that lasts 40. The
  model validates itself against the published jump duration.
- **`PlaceKey` wins wherever it has a value.** The two disagree on moves that
  carry both — Ryu's Shoryuken steers x at 3.0/frame but *places* itself 30.3
  units forward — because the curve is the animation's own root motion. The
  SteerKeys integrate everywhere the curve is silent, resuming from wherever the
  curve left the origin.
- **A JS ordering trap** cost a rebuild: `PosList` is keyed `"00".."39"`, and
  JavaScript iterates canonical integer keys (`"10"`+) before zero-padded string
  ones, which turns the curve into a sawtooth. Sorting numerically is the fix,
  and `tests/geometry.test.ts` asserts the dash curve stays monotonic.

## Consequences

- **Reach now includes the step-in.** Ryu's 2MK moves 46 units forward before
  its hitbox appears, so its reach against a standing opponent is 188 units, not
  the 142 the box alone implies. Stationary moves are unaffected.
- The viewer draws every box at the moved origin and traces the trajectory, so a
  dash or a Shoryuken reads as one shape rather than boxes appearing in place.
- **Air normals don't carry the jump's arc.** The motion lives on the jump
  action (`BAS_JUMP_F_AIR`), while the attack is its own action (`ATK_8HP`) with
  no motion of its own, so a jump attack shown alone hangs at ground level. Air
  spacing needs the two composed, which is a scenario-player concern rather than
  a per-action one.
- Only `OperationType` 1 (set) and 6 (stop) are integrated. The ~20 remaining
  keys use target-relative steering modes — homing throws and the like — and are
  skipped rather than guessed at.
