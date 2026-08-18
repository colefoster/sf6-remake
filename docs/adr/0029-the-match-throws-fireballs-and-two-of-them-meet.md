# ADR 0029 — The match throws fireballs, and two of them meet

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md),
  [ADR-0023](./0023-the-sim-throws-a-fireball.md),
  [ADR-0027](./0027-two-fighters-and-the-reaction-the-table-asks-for.md)

## Context

ADR-0027 gave the runtime two fighters and contact, and left one conspicuous
hole: `sf6 fight ryu ken "236+HPx3"` threw nothing. The scenario player has
modelled a projectile as a second actor since ADR-0023; the match had no notion
of one at all, which in a Ryu-versus-Ken game is the first thing anybody notices.

## Findings

### It is the same reading, and the outcome half was already shared-shaped

A projectile is a third body with its own action, its own frame count starting at
1 the frame it appears, its own origin motion, and the hit-data row of the action
that owns the box. That is ADR-0023's model verbatim; the only new work is that
there are now two fighters either of whom can throw.

Applying the outcome — reaction, stun, damage, hitstop, knockback — turned out to
be identical whether the box belonged to a fighter or a fireball, so `resolve`
split into "did this connect" and `land`, which takes the hit data and the
**box's** facing. That last part matters: a fireball's facing is the direction it
was thrown in, not where the thrower is looking now, and a thrower who turns
around mid-recovery would otherwise reverse their own knockback.

### Spawning has to be keyed on the action instance, for the same reason contact is

Hitstop freezes the match, action frames included, so "the frame equals the shot
frame" is true for as many frames as the hitstop lasts. Keying on
`<side>:<instance>:<shot index>` spawns exactly one — the same boundary ADR-0027
found for contact, met a second time.

### Two projectiles meet, which closes ADR-0023's last open item

They destroy each other before either is tested against a fighter. Mirror Ryu at
500 units: both throw, both vanish, nobody is touched — and the identical script
with the other side standing still connects for 600. That is the check.

Nothing else can destroy one. A fireball's hurtboxes are in the dump and the
runtime never consults them, so an attack cannot clear a projectile and there is
no trade.

### And Ken's Hadoken is a six-frame stub

Surveying every mapped projectile move's shot action: **27 travel 60 units or
more; 32 do not.** Most of the second group are stationary by design and already
named in ADR-0023 — Dhalsim's Yoga Frame, Ryu's Hashogeki, A.K.I.'s Jatoben.

**Ken is the exception.** His three Hadokens spawn an action that runs 6 frames
and travels 30, 35 and 40 units, where Ryu's runs 70 frames and travels 586. It
carries no branches, so nothing in the dump says where the rest of the flight
lives. Ken's fireball therefore dies in front of him, in the match and in
`src/sim` alike — and because `movingProjectile` in the grader only asks whether
travel is non-zero, those three moves are inside the 39-row projectile population
that ADR-0023 swept. Some of that sweep's fifteen misses are this.

## Decision

Model projectiles in `src/game/match.ts`: `Projectile` actors spawned from
`spawnsFrom` on the frame `ShotKey` names, advanced on their own clock, tested
against the opposing fighter's hurtboxes and against each other, and retired when
spent or when their action runs out.

Split the outcome half of `resolve` into `land`, shared by both. Export
`projectileBoxes` so the viewer draws them.

## Consequences

- `sf6 fight ryu ken "2x2,3x2,6+HPx3,5x120" --at 350` connects on frame 36 for
  600, with Ryu still recovering — the advantage curve, played out.
- `web/play.html` draws fireballs in amber, and a paused frame shows the shot
  mid-screen with the thrower still in recovery behind it.
- 168 tests pass. `sf6 verify` is untouched: `src/game` is imported by nothing
  the grader reads.

## Not settled

- **Ken's Hadoken.** Six frames and forty units, on all three strengths, with no
  branch to follow. Either the travelling action is reachable by something the
  extractor does not read, or the dump is wrong here. It is the only travelling
  fireball on the roster shaped like this.
- **A fireball cannot be hit.** Its hurtboxes exist and are ignored, so there is
  no clearing one with a normal and no trade.
- **`src/sim` and the match model a projectile twice.** They agree because they
  were written from the same ADR, not because anything checks them against each
  other. The advantage invariant in `tests/match.test.ts` covers ordinary moves
  and not this.
- **Multi-hit projectiles still land once.** The OD fireballs ADR-0023 measured
  at offsets 10 to 25 hit twice, and the match stops at the first, the same as
  everything else since ADR-0027.
- **No corner.** A fireball that reaches the edge of nothing keeps going until
  its action ends. The stage bounds are not in either dump and will have to be
  calibrated against an outside observation before they can be modelled honestly.
