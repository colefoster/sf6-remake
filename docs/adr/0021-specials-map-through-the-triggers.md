# ADR 0021 — Specials map through the trigger's own family and strength, a family at a time

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0016](./0016-armor-is-per-hurtbox.md),
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md),
  [ADR-0018](./0018-cmnname-says-what-a-move-is.md)
- Extended by:
  [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md) — `ShotKey`
  gives the fireball families a startup to score, so they map too.

## Context

[ADR-0018](./0018-cmnname-says-what-a-move-is.md) measured how much of FAT the
mapping reaches and found **0 specials solidly mapped of 196** — the largest
coverage gap in the project, and the reason ADR-0014 and ADR-0016 had claims they
could not grade. It named `cmnName` as the way in: `"MP Fireball"`, `"LK Tatsu"`,
`"OD Rekka 1"`.

`cmnName` turns out to be the wrong key. It is an *archetype* label — Ryu's
Hashogeki is `"LP Palm Thrust"` — and the dump names the same move `SPA_HADOSHO`.
Nothing joins those two strings. But the thing `cmnName` was going to supply is
already in the dump, stated better.

## Findings

### The triggers classify specials the way they classify supers

ADR-0009 extracted a trigger's `_Is*` flags and ADR-0018 used the `_IsLv1..4`
ones to pool supers. The same flags say everything about a special:

```
SPA_HADO            Ground Light  Projectile Special SpecialKind Special_1
SPA_HADO(1)         Ground Middle Projectile Special SpecialKind Special_1
SPA_HADO(2)         Ground Heavy  Projectile Special SpecialKind Special_1
SPA_HADO(3)  20000  Ground Extra  Projectile         SpecialKind Special_1
```

`Special_<n>` is the **family**, `Light`/`Middle`/`Heavy` the **strength**,
`Extra` the OD version, and `Punch`/`Kick` the button. FAT's notation carries
exactly the same three facts: `236LP` is light punch, `236PP` is the OD one.

### One startup is a weak fingerprint; a family is a strong one

Matching a special one move at a time is what put Drive Impact on a special in
ADR-0017. Ryu has four punch families and several share a startup.

So the assignment is made **a whole family at a time**: every (notation family,
dump family) pair is scored by mean disagreement across the strengths they share,
the pairs are taken cheapest first, each side is used once, and nothing averaging
worse than a frame is taken at all. Three or four startups have to agree
simultaneously, which no coincidence does.

Assigning greedily rather than per-family is load-bearing, not tidiness. Scored
independently, A.K.I.'s `214P` and `236P` both take `SPA_Kyosyutotu` and Akuma's
`236P` and `214P` both take `SPA_SYORYU`. Used-once assignment removes 112 of
those wrong answers outright.

### It works, and the numbers are not close

| specials | ADR-0018 | now |
|---|---|---|
| solidly mapped (`exact`) | **0** | **193** |
| `close` / `frame-unique` / `weak` | 0 / 27 / 0 | 4 / 45 / 14 |

**1,016 moves mapped, up from 895.** `sf6 boxes marisa 623MP` reaches MP Phalanx
and prints `armor 7-13 on body — a low attack goes under it`.

### Every prose grader got wider, because the mapping was what they were missing

ADR-0018 predicted this: *"Every 'could not be joined' caveat in ADR-0014 and
ADR-0016 traces back to this."* It did.

| check | before | after |
|---|---|---|
| `airborne-strike` | 45/55 — 81.8% | **75/88 — 85.2%** |
| `projectile` | 49/63 — 77.8% | 62/80 — 77.5% |
| `full` | 52/66 — 78.8% | **63/77 — 81.8%** |
| `strike` | 23/23 — 100% | 23/23 — 100% |
| armor window | 26/26 | **27/29** |
| armor "loses to Low" | 2/2 | **4/4** |

`airborne-strike` gained 33 claims and its rate went *up*. The `strike` check is
untouched at 100%, which is the control.

**ADR-0016's named caveat is closed.** Marisa's Phalanx is mapped and its armor
windows are FAT's to the frame — 7-11, 7-13, 10-15 — body-only, with FAT saying
"loses to Low attacks" about exactly those.

### The normal population did not move by one row

| clean population, normals only | before | after |
|---|---|---|
| `hitstun` | 269/292 | 269/292 |
| `blockstun` | 303/324 | 303/324 |
| `total` | 209/221 | 209/221 |
| `cancelEnd` | 122/131 | 122/131 |
| `advantage` | 226/256 | 226/256 |

Identical. Every pooled number that moved, moved because a new category joined.

### And specials are not an equal population

| clean population, specials | |
|---|---|
| `total` | 36/43 — 83.7% |
| `blockstun` | 29/40 — 72.5% |
| `cancelEnd` | 17/24 — 70.8% |
| `advantage` | **16/37 — 43.2%** |

Read together these say the mapping is right and the *sim* is wrong. `total`
compares the action's own `MarginFrame` to FAT and mostly agrees, which a wrong
action would not do. `advantage` is the sim playing the move out, and a special
is the category it models worst: a tatsu travels through the defender, a fireball
leaves the screen, and the scenario player models neither.

## Decision

Map specials through `specialFamilies` (the triggers' own classification) and
`assignSpecials` (greedy family-at-a-time assignment, mean disagreement ≤ 1
frame), in `scripts/extract-geometry.mjs`. Score the match quality from the
frames as every other path does, so a family that lands on a disagreeing startup
still reads `weak` and stays out of the graded populations.

Report and assert per category. The pooled floors drop to 0.80 and `cancelEnd`'s
to 0.88; the sharp assertions are per category, and specials get their own — with
`advantage` written as a **ceiling** rather than a floor, so improving the sim's
handling of specials shows up as a test break rather than passing silently.

## Consequences

- Pooled rates move to 90.8 / 86.9 / 93.0 / 89.7 / 84.0 from 92.1 / 88.3 / 93.5 /
  91.0 / 89.0. Every point of that is composition, not regression.
- The "no character fails wholesale" test now measures normals. Jamie reads 72.3%
  pooled and 95.9% on his normals — he has more specials, not worse data.
- 136 tests pass.

## Not settled

- **Armor Break's rule is broken, and by exactly two moves.** ADR-0017 established
  it as a move-class rule — supers and Drive Reversal, nothing else — and ADR-0018
  found all thirteen exceptions running the harmless way, FAT declining to tag a
  command-grab super. With specials mapped, **Marisa's `623PP` (OD Phalanx) and
  `236KK` (OD Quadriga) are published as Armor Break and the rule does not predict
  them.** Two counterexamples in the direction that means the rule is wrong rather
  than the tag being editorial. The rate is unchanged at 992/1007 — 98.5% — and
  the two are pinned by name in the test. What would settle it is a field: both
  are OD specials, and no OD flag by itself predicts Armor Break, since most OD
  specials do not have it.
- ~~**Fireballs cannot be mapped this way.**~~ Closed by
  [ADR-0022](./0022-a-fireballs-startup-is-the-frame-it-spawns-on.md): the parent
  action's `ShotKey` names the projectile's action and the frame it spawns on,
  and that frame is FAT's published startup. Specials go 193 → **234** exact.
- **329 specials remain unmapped**, mostly follow-ups, charge variants and air
  versions whose notation carries no strength (`214P (charged)`, `214K (air)`).
- **The two armor windows that miss are both OD** — Marisa's `623PP` (FAT 6-17 vs
  dump 6-12) and E.Honda's `46PP` (1-8 vs 1-56). The Honda one is on an `_AIR`
  action, so it may be the wrong sibling of the family rather than a bad window.
