# Spec — Drive Parry

Status: `done` — ADR-0054
Date: 2026-08-20

`src/game/match.ts` has named Drive Parry as a gap in its own header since it was
written. It is the last SF6 system of any size the engine does not have, and the
two things that made it untestable — a dummy that blocks, and a panel that shows
advantage and Drive — shipped in ADR-0052.

## What the dump already says

Read of Ryu's `moves_dict.json`, `triggers.json`, `char_info.json` and `HIT_DT`.
Almost all of it is there:

| | |
|---|---|
| **the input** | trigger kind `Parry`, **5000 Drive** up front — half a bar |
| **the stance** | `DPA_STD_START` (161f) branches at its end into `DPA_STD_Loop` (597f) |
| **crouching** | `DPA_CRH_START` (151f), same shape |
| **the drain** | `EventKey` `_IsCHARA_GAUGE_ADD`, gauge 4, **−50 per frame**, from frame 4 to the end — on `_START` and on `_Loop` alike |
| **the release** | `DPA_STD_END`, `MarginFrame` 33 → actionable on frame 34 |
| **the catch** | `DPA_L` / `DPA_M` / `DPA_H`, 34 frames, one per attack strength |
| **acting out of it** | those three carry a cancel window over their whole length — group 11 and group 10, from frame 1 |
| **the freeze** | `HIT_DT`'s `ParryStopOwner` / `ParryStopTarget`, set on 5,625 and 3,075 rows |
| **the Drive** | `HIT_DT`'s `DriveNorm` / `DriveJust`, set on 16,445 and 8,432 rows — 5000 and 20000 are the commonest |

`ParryStopOwner` / `ParryStopTarget` are the only two of those the extractor does
not currently emit.

## The one thing it does not say

**How long the just-parry window is.** No frame count anywhere names it: not in
the `DPA_` actions, not in `char_info`, not in the hit rows — which carry a
`DriveJust` *value* without saying when it applies.

The dump's only candidate is a boundary, and it is a suggestive one. Both
`DPA_STD_START` and `DPA_CRH_START` split **two independent key lists at exactly
the same place**: the hurt keys run 1–2 then 3–end, and the cancel keys run 1–2
buffered then 3–end live. Nothing else in either action changes there. A 2-frame
window at the very start of the parry is also what the community has measured
Perfect Parry to be.

That is an inference, not a reading, and it is marked as one wherever it lands.

## Shape

1. **`parryStop` out of the extractor**, beside `driveDamage`. Regenerate.
2. **The stance, in `Fighter`.** The trigger already resolves; what is missing is
   holding it (the `_START` → `_Loop` branch is a type-0 branch inside a family
   the state machine does not currently walk), the per-frame drain, and the
   release into `DPA_STD_END` when the buttons come up.
3. **A fourth `Contact`.** `contactType` returns `block | hit | counter |
   punishCounter`; parry is the fifth answer and it is not a block: no damage, no
   chip, no blockstun, the defender in `DPA_<strength>` for 34 frames and
   cancellable out of it from frame 1.
4. **The Drive economy.** `driveDamage.normal` on a parry, `.just` on a just
   parry, and the −50 a frame while holding.
5. **The dummy and the panel.** `parryAll` beside `blockAll`; the panel says when
   a hit was parried and what it did to the gauge.

## Deliberately not in scope

- **Drive Rush out of a parry.** The cancel window is right there in `DPA_M`'s
  group 11 and the rush is decoded (ADR-0036), but chaining them is its own
  piece.
- **Parrying a throw.** A throw is unblockable and the dump does not say a parry
  changes that.
- **The visual.** A parried hit looks like any other frame; the figure has no
  pose for it beyond the `DPA_` boxes, which it already derives.

## Issues

- `01-parry-stop-and-the-extractor.md`
- `02-holding-the-stance.md`
- `03-the-fifth-contact.md`
- `04-the-dummy-and-the-panel.md`

## Outcome

Done, ADR-0054. The inference about the 2-frame just window was **not** taken:
the engine implements the normal parry and leaves `driveDamage.just` unread,
because a boundary two key lists happen to share is evidence and not a reading.

Two things the spec did not expect:

- **Walking forward regenerates Drive**, 20 a frame. It fell out of extracting
  the parry's drain, because both are the same kind of `EventKey`, and the engine
  had neither.
- **Parrying a normal and releasing leaves you 13–26 frames minus**, against
  roughly even for a block, because `DPA_STD_END` costs 33. The parry's value is
  in what the catch cancels into, which is the piece that stayed out of scope.
