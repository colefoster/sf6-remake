# ADR 0046 — The shared rect tables, and the box a downed fighter has

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md),
  [ADR-0035](./0035-the-throwable-box-was-the-head-box.md),
  [ADR-0045](./0045-the-dump-is-the-live-game-now.md)

## Context

Since ADR-0004 the extractor has ended a run with a warning nobody could act on:

```
  ! pushbox BoxNo not in either rect list: 6
```

Every fighter's knockdown and tech actions reference pushbox `BoxNo` 6, and no
fighter's rect tables carry it. ADR-0004's note said it "lives in a shared asset
MMDK does not dump per fighter", which was a guess with nothing behind it.

The live dump has a **Dump Rects** output beside the atemi one:
`common_rects.json` at the dump root, 47 KB, the same shape as a fighter's own
`rects.json` — lists `00`-`10`, each a table of rect ids.

## Findings

### `BoxNo` 6 is in the shared list 5, and the actions that use it say what it is

The six keys that reference it, on every fighter, are exactly:

| action | what it is |
|---|---|
| `BAS_DN_STD_AO`, `BAS_DN_STD_UT` | lying down, face-up and face-down |
| `BAS_TECH_FN_AO`, `BAS_TECH_FN_UT` | forward tech, both facings |
| `BAS_TECH_BR_AO`, `BAS_TECH_BR_UT` | back tech, both facings |

So it is the **downed-state pushbox**, confirmed by the company it keeps rather
than by its shape. 19 of 24 fighters use it, 136 keys in total.

And four fighters do not use it: **Blanka and E.Honda carry their own at 80 wide,
Marisa's is 80 and offset forward, Zangief's is 86.** The four widest bodies in
the game are exactly the four that override the shared box, which is better
evidence than the action names that this is a default and that the fighter's own
table is meant to win.

Its shape is where it stops being clean: ±35 wide, which is the standing pushbox
family (±33 to ±35), but placed **y −117 to 13** — almost entirely below the
ground plane the rest of the extraction is expressed in. A pushbox's job here is
horizontal, and `calibrate` reads only the half-width, so nothing the runtime
does looks at that vertical extent. Recorded as read rather than explained.

### The shared tables fill in more than pushboxes

With the fighter's own tables searched first and the shared ones behind them, the
roster gains **174 pushboxes, 510 hurtboxes, 378 throwable boxes and 331
hitboxes**, and 49 actions that had no pushbox at all now have one. The
throwable-box ids (`7/10`, `7/11` — 671 lookups between them) are the largest
group after the hurtboxes, which matters because ADR-0035's throwable box is read
off exactly that list.

### And it moves no graded number at all

Graded both trees row by row with `skew-audit.mjs`: **10,746 rows, zero moved.**

That is the result worth stating plainly. The boxes are additions — the
fighter's own tables win everywhere they carry an id, so nothing is displaced —
and every check in `sf6 verify` reads frames, damage, windows and gauge values
rather than the boxes these fill in. The knockdown states now have geometry; no
percentage knows it yet.

### `common_moves.json` dumps nothing

The same MMDK build writes a `common_moves.json` containing `null`. Whatever
shared *action* data it is meant to hold, it does not produce it on this build.
Noted so the next person does not go looking for it twice.

## Decision

`makeRects` takes the shared tables as a fallback layer. A lookup may name
several lists in preference order — pushboxes are "the override list, then the
base list" — and **all** of the fighter's lists are searched before any shared
one, so a shared default can never displace a box the fighter carries. That
ordering is the whole correctness argument: consulting the shared list per list
instead resolved standing pushboxes to the shared ±35 and quietly replaced Ryu's
own ±33.

The extractor reports what it took from the shared tables, by list and id, per
fighter. A silent fallback is how a shared default becomes mistaken for a
per-character value.

## Consequences

- The `BoxNo` 6 warning is gone from all 24 fighters, and `sf6 boxes` on a
  knockdown action shows a pushbox for the first time.
- 1,393 boxes added across the roster; **no graded row changes.**
- A test asserts the downed pushbox on all 24 fighters and that it is the shared
  one rather than a fighter's own.

## Not settled

- **The downed pushbox's vertical placement**, above. Either the downed states
  use an origin that is not the feet, or the key's `RootOffset` is doing something
  the extractor ignores.
- **Nothing consumes it.** A downed fighter's pushbox should decide whether the
  attacker can walk over them and where a meaty lands; the runtime still treats a
  knockdown as a timer.
- **Which shared list a hit key means.** The hitbox additions come through
  `CollisionType`, and 41 of them resolve from shared list 3 on two fighters —
  the proximity list. Unexamined.
