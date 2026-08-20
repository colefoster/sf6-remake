# ADR 0048 — JavaScript hoisted the Denjin Hadoken

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0021](./0021-specials-map-through-the-triggers.md),
  [ADR-0040](./0040-a-fireball-outlives-its-action-and-a-second-hit-is-a-second-body.md),
  [ADR-0045](./0045-the-dump-is-the-live-game-now.md)

## Context

ADR-0040 added the projectile-speed check and immediately found something no
frame-based check could see: **Ryu's `236HP` maps to an action whose fireball
travels 12 units a frame against a published 0.085.** It said the mapper was
wrong, guessed the Denjin variants, and left the fix alone because touching
ADR-0021's mapper moves every other check.

ADR-0042 then established that half of that residual was version skew — OD
Hadoken's shot moved 9.5 → 11.2 between builds and 11.2 is exactly FAT's 0.112 —
and that `236HP`'s half was not: the plain HP Hadoken's shot is **8.5 in both
trees**, which is FAT's 0.085 to the digit, and the mapper was pointing somewhere
else.

Somewhere else was the Denjin Charge Hadoken.

## Findings

### The dump's Hadoken family has six members and four strength labels

`Special_1` on Ryu, by the trigger flags ADR-0021 reads:

| strength | action | shot speed | FAT |
|---|---|---|---|
| Light | `SPA_HADO` | 5.5 | `236LP` 0.055 |
| Middle | `SPA_HADO(1)` | 7 | `236MP` 0.07 |
| **Heavy** | `SPA_HADO(2)` | 8.5 | `236HP` 0.085 |
| **Heavy** | `SPA_HADO(4)` | 12 | `236P` Denjin Charge 0.12 |
| **Extra** | `SPA_HADO(3)` | 11.2 | `236PP` OD 0.112 |
| **Extra** | `SPA_HADO(5)` | 14.5 | `236PP` OD Denjin Charge 0.145 |

Two triggers per strength, because the Denjin-charged versions are the same
motion and the same button with a stock spent. `specialFamilies` keeps the
**first** trigger it sees for a strength, which is the right rule — the base
variant is authored first — and it was reading them in the wrong order.

### `triggers.json` is keyed by action id, and JavaScript reorders it

The file's slots are keyed `"0900"`, `"0902"`, `"0904"`, `"0906"`, `"1052"`,
`"1053"`. MMDK zero-pads three-digit ids and not four-digit ones, and **an
integer-like property key is not a string key to JavaScript**: `Object.values`
returns canonical array indices first, in ascending numeric order, and only then
the string keys in insertion order. `"1052"` is canonical; `"0900"` is not.

So the iteration that looks like it walks the file top to bottom actually hands
back the **Denjin triggers first**, and "first wins" gave them the Heavy and OD
slots. Read in Python — which preserves file order — the same file looks correct,
which is why staring at the dump never showed it.

This is the whole bug. One line of ordering, on an assumption nobody wrote down.

### What it cost, and what it did not

Fixing the order and re-extracting moves **five rows**, all Ryu's:

| row | before | after | FAT |
|---|---|---|---|
| `total 236HP` | 40 | **47** | 47 |
| `advantage 236HP` | −7 | **−9** | −9 |
| `projHits 236HP` | 2 | **1** | 1 |
| `projSpeed 236HP` | 12 | **8.5** | 0.085 |
| `total 236PP` | 38 | 40 | 40 |

Five rows, and nothing else in the roster moved: no other fighter has two
triggers on one strength of a family whose slot keys straddle 1000.

### And a mirror of it in the graders

With `236PP` finally on the OD Hadoken, its speed check *broke* — 11.2 against a
published 0.145. FAT reuses a `numCmd` for charged and stocked variants **371
times** across the roster (267 of them Jamie's drink levels, 65 Kimberly's), and
the extractor's `assignSpecials` has always mapped the *first* entry and left the
rest unmapped. Three of the four graders kept the **last**, so they were grading
the mapping of one move against the published numbers of another.

The projectile hit-count cache already had the rule, with a comment explaining
it. The speed cache two functions below did not.

## Decision

`triggersInOrder(file)` — every trigger in the dump's own numeric order, slot
then index — and both order-sensitive readers of `triggers.json` go through it.
The two order-insensitive ones do too, so the trap cannot be re-entered.

Make `numCmd` lookups first-wins in `verify/index.ts`, `verify/armor.ts`,
`verify/invuln.ts` and the speed cache in `verify/projectiles.ts`, matching the
extractor. A grader and the mapping it grades have to be talking about the same
move.

Two tests: Ryu's four mapped Hadokens carry the four published speeds, and the
two Denjin actions are mapped by nothing; and `236PP`'s published speed reads
0.112 rather than the 0.145 of the entry that shares its notation.

## Consequences

- `total` 95.0% → **95.2%**, `advantage` 82.8% → **83.0%**, projectile speed
  78.9% → **81.6%**, projectile hit count 86.5% → **88.5%**. The other checks are
  unmoved.
- ADR-0040's oldest open item is closed, and closed as a *mapper* bug after all —
  though not the one it guessed at.
- 223 tests pass.

## Not settled

- **`236PP` is −7 on block where FAT publishes −1.** Newly visible, because until
  now that row was compared against the Denjin entry. A fireball's advantage is a
  distance question (ADR-0023's contact convention), so this may be the check's
  premise rather than the data.
- **The Denjin variants are mapped by nothing**, which is correct — FAT's `236P`
  and its second `236PP` are the entries `assignSpecials` deliberately drops — but
  it means four of Ryu's real moves have no geometry the CLI can reach.
- **Nothing else in the codebase is audited for this hazard.** Every
  `Object.keys`/`values`/`entries` over a dump file whose keys are numeric strings
  has the same reordering, and only a reader that takes "the first" is affected.
  Two were found by looking; the rest were not.
