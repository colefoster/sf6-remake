# ADR 0047 — A hit reaches through more than one box, and always has

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0024](./0024-a-hit-is-a-hitid-not-a-key.md),
  [ADR-0045](./0045-the-dump-is-the-live-game-now.md)

## Context

[ADR-0045](./0045-the-dump-is-the-live-game-now.md) re-pinned the dump onto the
live game and left one thing on its own list: Akuma's OD Tatsumaki has **eight
hit keys for five hits**, two of them apparently repeated verbatim, and the same
shape appears on Marisa's `2HP` and two of her supers. The suspicion recorded
there was the dumper writing a list twice — which would have meant "189 moved
rows" was partly an artifact of *how* the two dumps were taken rather than of the
game changing.

It is neither.

## Findings

### They are not duplicates. They are a second box for the same hit

Field by field, Akuma's paired keys differ in exactly the ways that matter:

| | key 4 | key 8 |
|---|---|---|
| frames | 18-20 | 18-20 |
| hit row | 157 | 157 |
| `HitID` | 1 | 1 |
| `BoxList` | **77** | **78** |
| `RootOffset` | 0, 0 | 0, **+5** |

Same window, same outcome, **different volume**. Extracted, that is a box at
`x 14..114, y 95..161` alongside one at `x -38..114, y 90..130`: a second reach
for the same blow. Marisa's `2HP` pair is the same box at `x +15` — the identical
volume, moved forward.

### And the shape is old, and everywhere

Counting keys that share a window and a hit row with another key:

| tree | extra keys | actions |
|---|---|---|
| Dec-2024 snapshot | 1,141 | 539 |
| live Aug-2026 dump | 1,385 | 632 |

So it long predates the live dump, and it is not rare — a sixth of every fighter's
actions with hit data. Whatever it is, both dumpers report it the same way,
because it is in the game's own key list.

### The 8-versus-7 count really was a patch

Akuma's Tatsumaki has two paired keys in **both** trees. What changed between
builds is separate: the first hit's key was **split**, `12-14` on row 156
becoming `12-15` on row **155** plus `15-16` on 156. A new hit row, a split
window, one more key — and `hitCount` stays 5, because ADR-0024 counts `HitID`s
and both halves carry `HitID` 0.

### Nothing was wrong, which is the point

ADR-0024's rule was written for exactly this: *"a hit is a `HitID`, not a key"*.
It has been quietly collapsing 1,141 of these since the first extraction, and the
extractor emits both boxes, so `sf6 boxes` has always drawn the second reach.
The only thing that was wrong was ADR-0045's guess about where the extra keys
came from.

## Decision

Record it, and pin it with a test: Akuma's OD Tatsumaki carries two strike keys
sharing frames 19-20 and `HitID` 1 with different boxes, and still counts five
hits. A future reader who sees a repeated key is now told what it is instead of
suspecting the dumper.

No extractor change. Nothing to fix.

## Consequences

- ADR-0045's open item is closed, and its 189 moved rows stand as the game
  changing rather than partly an artifact.
- The vocabulary gains a distinction worth having: a hit's **keys** are its
  volumes, and its `HitID` is the hit.

## Not settled

- **What the second volume is for.** Akuma's sits 5 units higher and Marisa's 15
  units forward, which reads like a box for catching an airborne or a distant
  opponent with the same blow, but the key carries no condition that says so —
  the `KindFlag` bits that differ on Akuma's pair (7 and 18) are identical on
  Marisa's, so the flags are not the discriminator and the geometry is all there
  is to go on.
- **Nothing grades a second box.** FAT publishes one active window per hit and no
  reach per box, so the only check that could see these is `boxes`-level and
  visual.
