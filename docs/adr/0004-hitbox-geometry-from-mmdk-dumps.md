# ADR 0004 — Hitbox/hurtbox geometry comes from MMDK's dumps of the game's own data

- Status: accepted
- Date: 2026-08-17
- Supersedes: [ADR-0003](./0003-hitbox-geometry-deferred.md)

## Context

ADR-0003 concluded that SF6 box geometry existed only as live-rendered visuals,
so `Move.geometry` shipped unpopulated and spacing questions fell back to a
coarse `reach` scalar. That conclusion was wrong — or rather, it stopped at the
hitbox *viewer*.

**[alphazolam/MMDK](https://github.com/alphazolam/MMDK)** (Moveset Mod
Development Kit) is a REFramework kit for SF6 that dumps the game's own
`CharacterAsset` data to JSON, and **commits those dumps to the repo** for all 24
characters it covers. They contain the collision rect tables and every action's
per-frame collision keys: the actual numbers the game collides with.

## Decision

Populate geometry from the MMDK dumps, via two scripts:

- `scripts/fetch-mmdk.mjs` — downloads the dumps (pinned to one commit) into
  `data/raw/mmdk/`, gitignored because they are large and unmodified upstream data.
- `scripts/extract-geometry.mjs` — resolves them into `data/geometry/<char>.json`
  (committed, ~250 KB per character) and a copy in `web/` for the box viewer.

`src/data/geometry.ts` is the read side: box lookups per frame, plus `reach`
and `connectFrames` for spacing questions. `sf6 boxes <char> <move>` and
`web/boxes.html` are the two front ends.

## Findings (how the raw data works)

Reverse-engineered from `MMDK.lua:350-403`, then validated against FAT:

- An action's collision is a set of typed keys, each covering a frame range and
  naming box ids into the fighter's rect tables:
  `AttackCollisionKey` with `AttackDataListIndex > -1` → `rects[CollisionType]`
  (hitbox); the same key with `CollisionType 3` and no attack data → `rects[3]`
  (proximity guard box); `DamageCollisionKey`'s Head/Body/Leg/Throw lists →
  `rects[8]` (hurtbox).
- A rect is a **centre plus half-extents**, not a corner plus size. Ryu's
  standing head/body/leg hurtboxes tile exactly 0-54, 54-138, 138-166 game
  units, which is what confirmed the interpretation.
- Key frames are 0-indexed with an exclusive end. We emit 1-indexed inclusive
  frames, so "first active frame == startup" holds as `CONTEXT.md` defines it.
- Units: `x = 0` is the character origin, `y = 0` the ground, `+x` forward, and
  a fighter is ~166 units tall.
- **Pushboxes live in two rect lists**, which MMDK's own code never resolved
  (`"fixme, 5 or 9 or 10?"`). Settled here by looking at what references them:
  `rects[7]` holds the base body boxes, and its ids 1 / 2 / 3 are used by
  (respectively) every standing damage reaction, every crouching one, and every
  jumping attack — with the geometry that implies: x ±33 y 0-130 standing,
  y 0-100 crouching, y 90-180 airborne, identical between Ryu and Akuma as SF6's
  standardised pushboxes should be. `rects[5]` holds per-move overrides at id
  32+: the box that rises through a Shoryuken (`53` then `54`), the raised one a
  Tatsumaki spins in, a fireball's own body. Overrides win where both define an
  id. The one id in neither list is `6`, referenced only by knockdown/tech
  actions — the downed pushbox lives in a shared asset MMDK doesn't dump.

**Validation**: extracted startup/active agree exactly with FAT's published
numbers on 24 of Ryu's 26 named normals and every special the mapping resolves.
The two stragglers are reported by the extractor rather than smoothed over.

## Consequences

- Spacing questions are real now: `reach` is computed from box overlap against
  the defender's actual standing or crouching hurtboxes, not a scalar.
- `Move.reach` (FAT's `range`) stays as the fallback for characters whose
  geometry has not been extracted.
- **Move ↔ action mapping is the soft joint**, not the geometry. Action names are
  inputs for normals (`ATK_2MK_Y2`) but Japanese move names for specials
  (`SPA_SYORYU_START`), so mappings are made by name where possible and by a
  unique frame-data fingerprint otherwise, and every mapping carries a `match`
  quality. `weak` means don't trust it.
- **Pushboxes give spacing a floor.** Point blank is the distance at which the
  two pushboxes touch — 66 units between two standing fighters — so a move's
  usable spacing is the band from there out to its reach, and any question below
  that floor is about a position the game cannot produce. The CLI and the viewer
  both refuse it rather than answering.
- **The dumps are a snapshot** of whatever patch the MMDK author last dumped
  (currently late 2024, so pre-Season-3 roster and balance). Refreshing them
  means running MMDK's own dump buttons with SF6 + REFramework on Windows; the
  commit sha is recorded in every extracted file.
- Moving moves (dashes, jumps, Drive Rush) place their boxes relative to the
  character origin, and the per-frame position deltas that carry that origin
  forward are not extracted — so a jump-in's boxes are correct in shape but not
  in world position over time.
