# ADR 0023 — The sim throws a fireball, and FAT measures one 8 frames after it appears

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0007](./0007-scenario-player.md),
  [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md)

## Context

[ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md) extracted
everything a projectile needs — the spawned action, the spawn frame, the spawn
offset — and wired none of it in. ADR-0007 listed "projectiles as their own
actors" among what the scenario player does not model, and 234 mapped specials
were being graded by a sim that could not attempt a third of them.

## Findings

### A fireball is a second actor, and that is all it takes

The projectile keeps its own clock: it is on **its** frame 1 when the parent is
on the frame that spawned it. Its origin starts where the attacker's origin was
plus the shot's offset, and travels on the projectile action's own motion from
there — so it carries on across the screen while the attacker stands still
recovering. Contact is the same box-overlap test as any other attack; the outcome
comes from the *projectile's* hit-data row, because the parent action has none.

That is about forty lines. Nothing else in the player changed.

### Which makes a fireball's advantage a curve, not a number

The sim now says Ryu's LP Hadoken is **−13 blocked at point blank** and **−5
blocked at 208 units**, and the difference is exactly the frames of travel: every
frame the fireball spends in the air is a frame of Ryu's recovery already spent.

FAT publishes one number. So the question is which point on the curve it is.

### It is 8 frames after the shot appears, and the sweep is a spike

Swept the way ADR-0010 swept the guard release, over every mapped projectile
special in the clean population:

```
 0:  4/39     4:  1/39     8: 22/39    12:  1/39
 1:  0/39     5:  1/39     9:  0/39    13:  0/39
 2:  0/39     6:  0/39    10:  1/39    14:  0/39
 3:  0/39     7:  0/39    11:  1/39    15:  2/39
```

**22 of 39 at offset 8; every neighbour scores nothing.** Not a trend with a
maximum — a spike, which is what a real constant looks like and what a fitted one
does not.

The four at offset 0 are the honest exception rather than noise: Ryu's Hashogeki
and A.K.I.'s Jatoben spawn a "projectile" that does not travel at all, so there
is nowhere for FAT to measure it but on contact.

The remainder that match at neither are the OD versions — `236PP`, `46PP`,
`214PP` — sitting between 10 and 25. Those hit more than once, and FAT's number
describes a hit the sim stops before.

### This is a convention, not a mechanic

Which is why it lives in `src/verify` and not in `src/sim`. The guard release is
in the sim because the game really does hold the defender four extra frames;
`PROJECTILE_CONTACT` is in the grader because it is a statement about *where FAT
chose to stand*, not about the game. The sim keeps reporting the honest curve,
and `sf6 play ryu 236LP --at 208` gives the published number by having the
fireball actually get there.

## Decision

Model projectiles in `src/sim`: `Projectile` actors resolved from `spawnsFrom`,
`projectileBoxes` placing them per frame, contact tried against the attacker's
own boxes and every fireball in the air, outcome from whichever action owns the
box that landed.

Grade a projectile move's advantage against the sim's plus `PROJECTILE_CONTACT`,
exported and swept in the tests the way `GUARD_RELEASE` is.

Count a fireball's hits by distinct hit-data row rather than by key: the dump
splits a fireball's flight into a spawn flash and the travel proper, and counting
keys called every fireball multi-hit and kept it out of the clean population.

## Consequences

- **`total` on specials 43/51 → 71/80** and the clean special population roughly
  doubles, both from the hit-count fix letting fireballs in.
- **`advantage` on specials 16/37 → 38/74.** Projectiles are 22/39 of that.
- Pooled `advantage` reads 81.1%, down from 84.1%, on a population grown from 321
  rows to 360. The per-category numbers are the ones that mean anything.
- `sf6 play ryu 236LP --at 100` narrates the fireball: spawn, travel, contact,
  and who recovers first.
- ADR-0022's exclusion of hitbox-less moves from `tests/sim.test.ts` **stands**,
  and for a better reason than before: the sim can play them now, and its
  point-blank answer is deliberately not FAT's. Those tests assert equality with
  the published number, which for a projectile is a statement about the grader.
- 141 tests pass.

## Not settled

- **OD fireballs hit twice and the sim stops at the first.** They are the whole
  residue of the sweep — nine moves, offsets 10 to 25. A multi-hit projectile
  needs the player to keep going after contact, which is a bigger change than
  this one and touches every multi-hit move, not only fireballs.
- **Nothing ever hits the fireball.** Projectiles have hurtboxes in the dump and
  the dummy does not attack, so a fireball cannot be destroyed, clash, or trade.
  Two projectiles never meet.
- **Why 8?** Eight frames of travel is roughly 44 units for a Hadoken, and it is
  not obviously a round distance, a fixed spacing, or the width of anything. That
  the same 8 holds across characters whose fireballs travel at different speeds
  says it is counted in *frames*, not in distance — which is a real constraint on
  the explanation, and not the explanation.
- **Non-projectile specials are still 16/35 on `advantage`**, and they are the
  travelling ones: a tatsu, a dive kick, anything whose action carries the
  attacker through the defender. That is the same class of problem, met from the
  other side.
