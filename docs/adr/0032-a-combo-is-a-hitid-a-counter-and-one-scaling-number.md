# ADR 0032 — A combo is a HitID, a counter, and one scaling number

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0024](./0024-a-hit-is-a-hitid-not-a-key.md),
  [ADR-0027](./0027-two-fighters-and-the-reaction-the-table-asks-for.md),
  [ADR-0031](./0031-the-gauges-are-priced-by-the-dump-and-graded-by-fat.md)

## Context

Juggles and combo scaling were the last stage of the plan, and the plan named
its own grader: SF6's Combo Trials. A trial is the game asserting that a
particular sequence combos, which would check a juggle model against the game
rather than against a reading of it.

## Findings

### The Combo Trials are not reachable, and that is settled

MMDK dumps `reframework/data/MMDK/PlayerData` and eight files per fighter:
`char_info`, `commands`, `HIT_DT`, `moves_dict`, `Names`, `rects`, `tgroups`,
`triggers`. `scripts/fetch-mmdk.mjs` hardcodes that list, and the URL template
is per-character by construction. A case-insensitive search of the whole dump
for trial, mission, challenge, tutorial, course, lesson, `TRL_`, `MSN_` returns
**zero hits**, in filenames and contents alike.

This is structural rather than an oversight. Combo Trials live in SF6's mission
assets, not in per-fighter `CharacterAsset` data, so no amount of re-running the
fetch script reaches them. Extracting them would mean unpacking the game's own
PAKs from an install — a different project. **The intended grader does not
exist and cannot be made to exist here.**

### It did not matter, because FAT publishes the juggle system

The dump states the juggle numbers on every hit-data row — `Juggle1st`,
`JuggleAdd`, `JuggleLimit` — and they were already being extracted as
`juggle: { start, add, limit }` and never read. FAT publishes the same three as
`jugStart`, `jugIncr`, `jugLimit`. Two independent descriptions of one thing is
the setup this project has run on since ADR-0010, and it grades:

| check | clean | |
|---|---|---|
| `juggleStart` | 240/249 **96.4%** | `Juggle1st` == `jugStart` |
| `juggleAdd` | 282/291 **96.9%** | `JuggleAdd` == `jugIncr` |
| `juggleLimit` | 285/300 **95.0%** | `JuggleLimit` == `jugLimit` |
| `startScaling` | 196/200 **98.0%** | `_StartScaling` == `dmgScaling` |

So the thread stayed gradeable. It is graded per *move*, against published
numbers, rather than per *sequence* against the game's own combos — which is a
weaker claim than a trial would have supported, and worth naming as such.

### The scaling the dump states is the starter's, and only the starter's

`moves_dict` carries `fab.Combo` on every action with three fields —
`_StartScaling`, `ComboScaling`, `InstScaling` — all −1 when unset, which is
most of them. `_StartScaling` is 20 on Ryu's 5LP, 30 on his Shoryuken, 20 on
Drive Impact, and lines up with FAT's `dmgScaling` prose exactly:

```
ATK_5LP            _StartScaling 20   FAT "Stand LP: 20% Start"
SPA_SYORYU_START(2) _StartScaling 30   FAT "MP Shoryuken: 30% Start"
ATK_CTA            _StartScaling 20   FAT "Drive Impact: 20% Start"
ATK_5MP            _StartScaling -1   FAT no dmgScaling column
```

Only the `"N% Start"` form is graded. FAT's same column also carries
`"20% Immediate"`, `"15% Multiplier (Mid-Combo)"` and `"Combo (5% extra)"`,
which are different quantities sharing a field.

**SF6's per-hit scaling curve is in neither file.** The familiar "every hit
after the third scales it further" is a system rule, not a per-move number, and
nothing in `char_info` or `moves_dict` states it. So the runtime applies the
starter's penalty and nothing else — combo damage here is closer to correct than
it was, and still not right.

### The action instance was the wrong boundary in the other direction

ADR-0027 keyed contact on the action instance because hitstop outlasts the
active window, and ADR-0029 restated it. It stopped the re-hit and it also
capped Ryu's 6MP — two hits on one action — at one. ADR-0024 had already found
the boundary the game uses: a hit is a **HitID**. Keying on
`<side>:<instance>:<HitID>` fixes both ends, and 6MP now lands on frames 19 and
28 as it should. Nothing else moved: the "connects once per swing" guard still
passes, because 5MP is one HitID.

A refused hit is not marked. The juggle rules can turn a contact down, and a
turned-down hit has not been spent — the hitbox is still out.

### The rule the juggle numbers feed is asserted

The dump states `start`, `add` and `limit` and never says what to do with them.
The reading here — a defender already airborne is being juggled, a move connects
only while the counter is at or under its `limit`, each hit adds its `add`, and
a hit that starts the juggle sets the counter to its `start` — is the one the
field names invite. It is an assertion, in the same class as ADR-0026's movement
table: the numbers are the dump's and the seams between them are ours.

### The juggle numbers are per defender state, and the air row is the one that matters

`HIT_DT`'s `param` block turns out to be the five conditions crossed with the
**four defender states** — stand, crouch, air, down — where `common` is the
condition alone. The juggle values differ across it: `JuggleAdd` differs between
the ground and air rows on 69 rows, `Juggle1st` on 32, `JuggleLimit` on 11. Ryu's
OD Hadoken states a limit of **2 on the ground and 3 in the air**.

The extractor keeps exactly one `param` entry — index `02`, the airborne hit,
already surfaced as `airHit` — so a juggle reads its rules from the airborne row
when the defender is airborne. The other fifteen `param` entries are dropped,
including every "down" state and the airborne counter and punish-counter rows.

### A multi-hit projectile is a *branch*, not a second HitID

Ryu's OD Hadoken spawns one shot whose action carries two hit keys with the same
`HitID` and the same data row — one hit by ADR-0024's rule. The second hit is a
`BranchKey` of type 45 into an entirely different action with its own row, its
own 400 damage and its own juggle limit of 6. That is why FAT's `jugLimit`
`"1*6"` has a second value that matches nothing the extractor counts. The whole
`SPA_HADO` family is built this way.

So the HitID change does nothing for projectiles, and the reason is structural
rather than an oversight in `flyProjectiles`.

## Decision

Key contact on `<side>:<action instance>:<HitID>` and let `land` refuse.

Add a `Combo` per fighter: `hits`, `damage`, `juggle`, `scaling`. A hit landing
while the defender is already in hitstun continues the combo; anything else
starts one and takes its scaling from whatever opened it. Damage after the
starter is scaled by that percentage.

Extract `fab.Combo` as `action.scaling`, and add four checks to `src/verify`.

## Consequences

- `sf6 fight ryu ken "6+MPx3,5x80" --at 120` lands both hits and reports
  `combo 0/2 hits`.
- `sf6 verify` runs fourteen checks. The original five are unmoved:
  93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 183 tests pass.

## Not settled

- **No trial grader, and no prospect of one.** Every combo claim this project
  makes is per-move against FAT, never per-sequence against the game.
- **The per-hit scaling curve is not modelled**, because it is not in the data.
  A long combo here does close to full damage.
- **The juggle rule is asserted.** It is also barely exercised: the match has no
  launcher path worth the name, so the counter is set and rarely tested against
  a limit.
- **`ComboScaling` and `InstScaling` are extracted and unread**, as is
  `ComboAdd`. `_no_combo` and `_black_combo` are kept and are `false` on all
  79,175 condition rows in the roster, so they say nothing at all.
- **FAT's `"50% Minimum"` has no counterpart in the dump.** Nothing there states
  a scaling floor.
- **Projectiles still land once per shot.** The HitID change cannot fix this:
  their second hit is a type-45 branch into another action, so following it
  means giving a fireball the branch-walking a fighter already has.
- **Fifteen of the sixteen `param` rows are dropped**, including the airborne
  counter and punish-counter rows and every "down" state.
- **`_no_rolling` (11,131 rows true), `_bound_piyo` and `_no_zu` are dropped**,
  and nothing else in the row says whether a knockdown can be quick-risen.
- **Nothing resets a combo but the defender recovering.** There is no drop, no
  reset on a whiffed link, and no combo-valid check of any kind.
