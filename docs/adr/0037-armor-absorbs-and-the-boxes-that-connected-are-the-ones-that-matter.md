# ADR 0037 — Armor absorbs, and the boxes that connected are the ones that matter

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0016](./0016-armor-is-per-hurtbox.md),
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md),
  [ADR-0036](./0036-a-drive-rush-cancel-spends-the-rushs-freeze-not-the-moves-recovery.md)

## Context

Armor has been decoded and graded since ADR-0016 — the windows agree with FAT's
published armor frames on 27 of 29, and ADR-0017's rule for what breaks it
agrees on 1,064 of 1,082. The runtime read none of it. Drive Impact was a move
that hit you and then died to any poke, which is the opposite of what it is for.

## Findings

### Both halves were already graded; only the consequence was missing

Nothing new had to be decoded. `armorWindows` and `armoredAt` were sitting in
the geometry module with a per-part `covers`, and `verifyArmorBreak` already
encoded "a Super Art or a Drive Reversal" as the break rule. What the match
needed was to ask them, and then to do the right thing with the answer: an
absorbed hit still costs health and still freezes both sides, and does not
interrupt.

Extracting the break rule into `breaksArmor` puts the runtime and the grader on
one reading rather than two — it is the same triggers-based test, moved so both
can call it.

### Armor is per hurtbox, so the runtime has to know which box was hit

ADR-0016's finding is that body-only armor is armor a low goes under. Acting on
that means the match cannot ask "is this fighter armored"; it has to ask "is the
part this attack landed on armored", which meant a `partHit` that walks head,
body and leg separately instead of the flattened list contact resolution uses.

Drive Impact's own window covers all three, so a low does *not* go under it —
which is the case the runtime now reproduces.

### And the first implementation silently missed every projectile

The armor check first recomputed the attacker's boxes from
`hitboxesAt(attack, me.state.frame)`. For a fighter's own hitbox that is
correct. For a **projectile** it is nonsense: `attack` is the fireball's action
but `me` is the thrower, whose frame and position have nothing to do with where
the shot is. `partHit` found no overlap, so nothing was ever absorbed, and a
Hadoken went straight through a Drive Impact.

The fix is to stop recomputing. Both call sites — `resolve` and
`flyProjectiles` — have already worked out the boxes that connected, and `land`
now takes them. Drive Impact eats fireballs, which is most of the reason it
exists.

## Decision

Add `breaksArmor` to the geometry module, sharing ADR-0017's rule with the
grader. Add `partHit` to the match. Before applying an outcome, check whether
the part struck is armored on that frame and the attack does not break armor; if
so, apply the damage and the hitstop and stop there.

Pass the connecting boxes into `land` rather than recomputing them.

## Consequences

- Ryu's 5MP into Ken's Drive Impact is absorbed for 720 and Ken's Impact lands
  for 960, knocking Ryu down.
- Ryu's Hadoken is absorbed by the same window.
- Ryu's 2MK does not go under it, because the window covers the legs.
- 201 tests pass. `sf6 verify` is untouched — this reads the grader's findings
  rather than adding to them.

## Not settled

- **Drive Impact's armor is infinite here.** SF6 gives it one hit; the dump has
  no count — ADR-0017 found `ArmorPoint` is 0 on all 79,175 occurrences — so
  nothing says when armor should stop absorbing. A second poke is absorbed too.
- **Absorbed hits cost no Drive.** The dump says a blocked Drive Impact drains
  20000 (`DriveNorm` on row 127), and the armor path applies health damage only.
- **The damage is not recoverable.** SF6 makes armor damage grey health, and
  `recoverable` is on the hit row and unread.
- **Armor break is a rule about the *move*, not the hit.** A super that whiffs
  its armored frames still counts as breaking, because the test never looks at
  timing.
- **`atemi` still identifies armor without describing it.** The table it indexes
  is not in the dump (ADR-0016), so every armor behaves identically here.
