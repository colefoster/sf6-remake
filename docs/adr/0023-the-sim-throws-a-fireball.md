# ADR 0023 — The sim throws a fireball, and FAT measures one 8 frames after it appears

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0007](./0007-scenario-player.md),
  [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md)
- Extended by: [ADR-0024](./0024-a-hit-is-a-hitid-not-a-key.md) — the hit count
  below was counting keys, so most of the population this ADR blamed on the sim
  was single-hit all along. `HitID` per window replaces the shot special case.

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
 0:  4/39     4:  4/39     8: 24/39    12:  5/39
 1:  4/39     5:  4/39     9:  4/39    13:  4/39
 2:  4/39     6:  4/39    10:  5/39    14:  4/39
 3:  4/39     7:  4/39    11:  4/39    15:  5/39
```

**24 of 39 at offset 8, against a flat floor of four.** Not a trend with a
maximum — a spike, which is what a real constant looks like and what a fitted one
does not.

The floor is the projectiles the constant does not apply to, and it is flat
because they score the same whatever the offset is: **a shot that does not
travel gives FAT no flight to measure at.** Ryu's Hashogeki and A.K.I.'s Jatoben
spawn a hitbox that stays where it is put, so FAT measures those on contact like
anything else, and the check gates on the projectile's own motion.

The remainder that match at neither are the OD versions — `236PP`, `46PP`,
`214PP` — sitting between 10 and 25. Those hit more than once, and FAT's number
describes a hit the sim stops before.

### The rule is about projectiles, not about travel — a travelling *attacker* has no constant

The obvious next hypothesis is that any move that covers ground is measured the
same way. It is not. Swept over the 31 travelling non-projectile specials in the
clean population — tatsus, dive kicks, rushing punches:

```
-6: 1   -3: 1   -2: 1    0: 16    2: 2    3: 1    4: 1    7: 1    9: 1   10: 1   11: 1
```

**The peak is offset 0**, and the residue is scattered from −17 to +11 with no
second peak anywhere. FAT measures a travelling attacker on its first active
frame, like everything else.

That is the whole shape of the finding, and it is a mechanical distinction rather
than an editorial one: an attacker that travels carries its own recovery with it,
so the first frame it can connect on *is* its first active frame. A fireball
separates from its owner — it can only connect on its own frame 1 at point blank,
and everywhere else it arrives later while the thrower is already recovering.

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
exported and swept in the tests the way `GUARD_RELEASE` is — and only where the
shot **travels**, since a stationary one gives FAT nothing to measure at.

Count a fireball's hits by distinct hit-data row rather than by key: the dump
splits a fireball's flight into a spawn flash and the travel proper, and counting
keys called every fireball multi-hit and kept it out of the clean population.

## Consequences

- **`total` on specials 43/51 → 71/80** and the clean special population roughly
  doubles, both from the hit-count fix letting fireballs in.
- **`advantage` on specials 16/37 → 40/74.** Projectiles are 24/39 of that.
- Pooled `advantage` reads 81.7%, down from 84.1%, on a population grown from 321
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
  this one and touches every multi-hit move, not only fireballs. Still open, but
  [ADR-0024](./0024-a-hit-is-a-hitid-not-a-key.md) cut the population it touches
  from a claimed 435 moves to a real 142.
- **Nothing ever hits the fireball.** Projectiles have hurtboxes in the dump and
  the dummy does not attack, so a fireball cannot be destroyed, clash, or trade.
  Two projectiles never meet.
- **Why 8?** Eight frames of travel is roughly 44 units for a Hadoken, and it is
  not obviously a round distance, a fixed spacing, or the width of anything. That
  the same 8 holds across characters whose fireballs travel at different speeds
  says it is counted in *frames*, not in distance — which is a real constraint on
  the explanation, and not the explanation.
- **The non-projectile residue is two move families, not a systematic offset.**
  Rashid's four Eagle Spikes are all published −36 regardless of strength while
  the dump gives −19 to −28, and Jamie's four rekka starters run +7 to +11 the
  other way. A per-family cause rather than a per-category one; nothing else in
  the travelling population is off by more than four.
