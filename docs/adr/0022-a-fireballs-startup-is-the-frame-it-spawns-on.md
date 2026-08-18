# ADR 0022 — A fireball's startup is the frame it spawns on, and `ShotKey` says which frame that is

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0021](./0021-specials-map-through-the-triggers.md)
- Extended by: [ADR-0024](./0024-a-hit-is-a-hitid-not-a-key.md) — the shot-only
  hit count below turned out to be a special case of a general rule, and is gone.
- Extended by: [ADR-0023](./0023-the-sim-throws-a-fireball.md) — the sim plays the
  projectile, and FAT turns out to measure one 8 frames after it appears.

## Context

[ADR-0021](./0021-specials-map-through-the-triggers.md) mapped 193 specials
through the triggers' own family and strength, and named the one family shape it
could not reach: **fireballs**. A projectile special's own action carries no
hitbox at all — the fireball is a separate action — so the family had no startup
to score, and the assignment skipped it. Ryu's Hadoken and Hashogeki were both
unmapped for that reason.

## Findings

### `ShotKey` is the projectile, and its frame is the startup

The parent action carries a `ShotKey` naming the fireball's own action, the frame
it appears on, and where it appears relative to the character origin:

```
SPA_HADO   ShotKey { ActionId: 909, _StartFrame: 15, PosOffset: { x: 79, y: 110 } }
```

`_StartFrame + 1`, in the 1-indexed frames everything else in this extraction
uses, is FAT's published startup. Five for five on the first character looked at:

| action | spawn frame | FAT |
|---|---|---|
| `SPA_HADO` (LP Hadoken) | 16 | 16 |
| `SPA_HADO(1)` (MP) | 14 | 14 |
| `SPA_HADO(2)` (HP) | 12 | 12 |
| `SPA_HADO(3)` (OD) | 12 | 12 |
| `SPA_HADOSHO_L` (LP Hashogeki) | 12 | 12 |

Roster-wide, over every move whose action throws rather than hits:
**75 mappings, 56 with a startup delta of 0.**

The misses are almost entirely **projectile supers** whose `WorldKey` carries no
timer, so there is no freeze to net out — Akuma's `SAA_GOZANKU_START` spawns on
57 against FAT's 10, and 57 − 10 + 1 = 48 is a freeze the dump never wrote down.
That is the same population ADR-0020 found from the invulnerability side, met
from a third direction. They all read `weak` and stay out of every graded
population.

### Which unblocks the families ADR-0021 skipped

| | ADR-0018 | ADR-0021 | now |
|---|---|---|---|
| specials `exact` | 0 | 193 | **234** |
| specials unmapped | 169 | 381 | **329** |
| moves mapped | 822 | 1,016 | **1,091** |

`total` on specials goes 36/43 to **43/51**, and the projectile invulnerability
check gains ten claims to grade (70/90 from 62/80). `sf6 boxes ryu 236LP` reads:

```
  active       no hitboxes
  projectile   SPA_HADO PROJ spawns frame 16 at (79, 110), active 1-70
```

### And exposed a trap the extractor had been carrying

The mapper preferred a `_Y\d$` action — the newest rebalance — by **filtering the
candidate pool** before scoring. That was safe only while shot-only actions had
no signature. Once they did, Juri's `ATK_5MP_TC2_SA1_Y2` — a super handoff, and
the only `_Y2` among her `ATK_5MP*` — became the whole pool and took her 5MP at a
delta of 73.

The preference is a **tie-break** now: the frames decide first, and the rebalance
only separates candidates the frames cannot. That is what it always meant. Fixing
it recovered two normals and moved every normal check up by two agreeing rows.

## Decision

Extract `ShotKey` as `shots` on the action: the spawned action id, the spawn
frame, and the offset. Give `signature()` a fallback that reads the startup from
the spawn frame and the active window from the projectile's own action, so a
fireball has frames to match on.

Add `spawnsFrom(geo, action)` on the read side and a `projectile` line to
`sf6 boxes`, so the decode is visible where a player would ask.

Make the `_Y` rebalance preference a sort tie-break rather than a pool filter.

## Consequences

- Pooled rates: 90.9 / 87.0 / 92.9 / 89.7 / 84.1. Normals move **up** two rows in
  every check from the `_Y` fix — 271/294, 305/326, 211/223, 123/132, 228/258.
- `PosOffset` is real projectile geometry — 79 units forward and 110 up for a
  Hadoken — which is what a projectile-aware sim will need.
- `tests/sim.test.ts` now excludes moves whose action has no hitbox of its own.
  The sim resolves contact from box overlap, so a fireball is not something it
  gets wrong; it is something it cannot attempt.
- 138 tests pass.

## Not settled

- ~~**The sim still cannot throw a fireball.**~~ Closed by
  [ADR-0023](./0023-the-sim-throws-a-fireball.md): a projectile is a second actor
  with its own clock, and it turns out FAT publishes a fireball's advantage 8
  frames after the shot appears — a constant that sweeps as a spike.
- **329 specials remain unmapped** — follow-ups, charge variants, and air
  versions whose notation carries no strength (`214P (charged)`, `214K (air)`),
  which the family join skips by construction.
- **A third of the roster's `ShotKey` actions belong to no mapped move.** 367
  actions carry a shot; 75 are reachable through a mapping. The rest are supers,
  follow-ups and the projectiles' own actions.
- **Projectile supers with no `WorldKey` timer** now have three independent
  estimates of a freeze the dump never records — startup, invulnerability window
  (ADR-0020) and spawn frame. Nothing yet says why those actions record no timer.
