# ADR 0042 — The atemi table was behind another button, and the armor halves the hit

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0016](./0016-armor-is-per-hurtbox.md),
  [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md),
  [ADR-0037](./0037-armor-absorbs-and-the-boxes-that-connected-are-the-ones-that-matter.md),
  [ADR-0039](./0039-the-atemi-index-is-the-armors-name-and-fat-holds-the-payload.md)
- Corrects: [ADR-0040](./0040-a-fireball-outlives-its-action-and-a-second-hit-is-a-second-body.md)

## Context

Three ADRs in a row have been written around a sentence: *"there is no atemi
table in the dump."* ADR-0016 checked six files for it and found none. ADR-0017
closed the attack side by establishing there was nothing to read. ADR-0039 went
outside for the payload and resolved the hit count off FAT's prose, three rows of
it, and left the rest of what an armor row might carry as unknown.

The sentence was about MMDK's *character* dump. MMDK has a separate **Dump
Atemis** button, and a live dump taken off the running game (Aug-2026 build, 21
fighters, `data/raw/mmdk-fresh/`) has it: `common_atemi.json` at the dump root
plus per-fighter `atemi.json` for the three fighters that need one.

## Findings

### Two layers in one index space, and the fighter's own row wins

`common_atemi.json` holds rows **1, 2, 3, 4, 6**. Luke carries a row `05`,
Zangief `07` and `08`, Marisa `07`, `08` and `09` — zero-padded keys in the
per-character file, bare ones in the common file, and the same index space. No
row is defined in both layers, so the merge is uncontested in this dump; the
resolution is still per fighter, because index 7 is Marisa's Gladius on Marisa
and Zangief's 5HP on Zangief.

Across the 21 fighters dumped, the indices actually referenced are 1, 2 and 3
from the common table and 5, 7, 8, 9 from the three private ones. Common rows 4
and 6 are shipped and referenced by nobody.

### `ResistLimit` is the hit count, and it disagrees with FAT once

| index | `ResistLimit` | ADR-0039's count, from FAT |
|---|---|---|
| 1 (Drive Impact, all fighters) | 2 | 2 |
| 3 (E.Honda's OD Headbutt) | **2** | **1** |
| 7 on Marisa (Gladius family) | 1 | 1 |

Two of the three rows ADR-0039 named from outside are confirmed by the table
itself. The third is a real two-source disagreement: FAT publishes *"1 hit of
armor"* for Honda's `46PP` and the row says two. That move is also the one whose
*window* has never joined — ADR-0016 recorded its published `1-8` against the
dump's `1-56`, and its prose describes two windows in one sentence — so the
likeliest reading is that Honda's OD Headbutt has two one-hit stages and FAT
publishes them as two claims where the dump has one row. Not settled, and no
longer hidden: the grader names the row rather than averaging it away.

### Three fields nobody had

Every row that does damage carries `DamageRatio` 50, `RecoverRatio` 50 and
`GaugeRatio` 50. The two rows that carry 0 for all three — common 6 and
Zangief's `08` — are the ones that take no damage at all.

`DamageRatio` is unambiguous: an absorbed hit costs half. `RecoverRatio` is read
here as the share of *that* damage which is recoverable, which closes ADR-0039's
"armor damage is not recoverable" item and matches what SF6 shows — armor damage
grows back. It is a reading, not a decode: `ConvertRatio` is 100 on every row
that does damage and 0 on both rows that do not, so it is perfectly collinear
with `DamageRatio` and could be the conversion instead. Nothing in the table
separates them and nothing published grades either.

### The index space is a property of the build, so the table cannot be borrowed

Between the pinned snapshot and the live dump, two indices moved without the
moves moving:

| move | pinned index | live index |
|---|---|---|
| Luke `SPA_SOKUTOU_L(1)` | 6 | 5 |
| Zangief `ATK_5HP(2..MAX)` | 6 | 7 |

Both are now rows in those fighters' own tables. Pasting the live table onto the
pinned geometry would resolve Zangief's 5HP armor to common row 6 — the row that
takes **no** damage — and quietly make his heavy punch armor free. So the table
is read from the dump being extracted, and the read side falls back to ADR-0039's
FAT-derived map when the tree has no table, which is what the pinned tree is.

### ADR-0040's Ryu residual was the snapshot, not the mapper

ADR-0040 left "Ryu's 236HP and 236PP are mapped to the wrong actions" open, on
launch speeds of 12 and 14.5 against a published 0.085 and 0.112. Half of that is
version skew:

- `SPA_HADO(3) PROJ` — OD Hadoken — is **9.5 in the pinned dump and 11.2 in the
  live one**, and FAT publishes 0.112. The value is exact in the current game.
- `SAA_HADOUKEN PROJ` moves 12 → 15 the same way, against a published 0.15.
- `SPA_HADO(2) PROJ` is 8.5 in **both** trees against the published 0.085 for
  `236HP`, and the mapper puts `236HP` on `SPA_HADO(4)` at 12. That half is ours,
  and it survives the live dump.

So the fireball speeds the project could not reproduce were partly a year-old
snapshot being graded against current frame data, exactly the confound
`docs/agents/refresh-the-dump.md` exists to name.

## Decision

Extract the table. `extract-geometry.mjs` reads `common_atemi.json` from the dump
root and `<Char>/atemi.json` beside the fighter's other files, merges them by
numeric index with the fighter's own rows winning, and emits `atemi` on the
geometry file — `hits`, `damageRatio`, `recoverRatio`, `gaugeRatio` per row.
Absent files mean no `atemi` key, not an error.

Read side: `atemiRow(geo, window)`, `armorHits(geo, window)` — the row's
`ResistLimit`, or ADR-0039's map where there is no row — and `armorDamage(row,
damage)`, which returns what the defender takes and how much of it is grey. With
no row, `armorDamage` is the identity and ADR-0037's behaviour.

In the match, an absorbed hit applies `armorDamage` rather than the raw `DmgValue`
and adds the grey to the recoverable pool.

The grader now compares `ResistLimit` against FAT's published count where the
tree has the table, and prints the row that disagrees by name. Where it does not,
it grades ADR-0039's map against the source that map came from — which is
circular, and the report says so.

## Consequences

- Ryu's 5MP into Ken's Drive Impact costs **360 of 720, with 180 recoverable**,
  on a tree extracted from the live dump. On the pinned tree it costs 720 and
  none of it comes back, unchanged.
- `sf6 verify` on the live tree: armor window 24/26 92.3%, hit count **25/26
  96.2%** with `E.Honda 46PP atemi 3 says 2 hit(s), published 1` named under it.
  On the pinned tree the armor report is unchanged — 27/29 and 29/29 — because
  nothing there resolves through the table.
- The original five are unmoved: 93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 217 tests pass.

## Not settled

- **`GaugeRatio` is extracted and unread.** 50 on every armor row, and which
  gauge it scales is not stated — the armor path touches one gauge number (the
  `DriveNorm` drain ADR-0039 applied) and there is no reason beyond the name to
  think that is the one.
- **`ConvertRatio` versus `RecoverRatio`** as the home of the grey conversion,
  above. Both readings produce identical numbers on every row in this dump.
- **Row 3's two hits against FAT's one**, above.
- **The pinned tree gets none of this.** The live dump is missing Ed, M.Bison and
  Terry, which the pinned one has, plus the six that have never been dumped, so
  re-pinning would trade three playable fighters for the table. Neither tree is
  strictly better and both stay side by side, per
  `docs/agents/refresh-the-dump.md`.
- **`PlData.ArmorPoint` 100 and `ArmorTimer` 50/30 are still unread**, and the
  table does not explain them: `ResistLimit` counts hits, so a pool of 100 and a
  timer of 50 are a second armor model with no visible consumer.
- **Grey health still does not grow back.** No dump states a regeneration rate;
  ADR-0041's finding stands, and armor damage now lands in the same pool.
