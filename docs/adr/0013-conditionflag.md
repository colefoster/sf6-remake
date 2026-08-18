# ADR 0013 — `ConditionFlag`: the airborne gate reads, the low nibble does not

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0008](./0008-cancel-windows.md)

## Context

ADR-0008 extracted cancel windows and left `ConditionFlag` deliberately raw,
noting that its low nibble partitions by phase but that "which bit is which does
not follow from the data alone". It was named as the next real unknown. This is
the attempt, and it is a **partial success and a documented negative**.

The question matters because it is the difference between "2MK can cancel into a
special" and "2MK can cancel into a special *only on contact*" — the frame-trap
question.

## Findings

### The flag is four packed fields, not one

Across all 12,273 trigger keys in the roster:

| field | bits | values |
|---|---|---|
| `_Condition` low | 0-3 | 1, 3, 4, 7, 9, 10, 11, 12, 15 |
| `_Condition` high | 10-13 | 0, 5, 7 (as a nibble) |
| `_Input` | 14-16 | 0, 1, 2, 3, 6, 7 (as a 3-bit field) |
| `_Other` | 6 and 17 | 64, 131072 |

Bits 4-9 are never set outside `_Other`'s bit 6. `_Exception`, `ATTR`,
`_ON_Prop`, `_OFF_Prop`, `NoticeON`, `NoticeOFF` and `MasterID` are constant
across the entire roster and carry nothing.

### `_State` is the character-state gate, and its airborne bits read

`_State` is a separate field on the key, and **bits 18, 19 and 20 mark a window
that only opens off the ground**. Measured against the actions the keys sit on:

| | keys | on an airborne action |
|---|---|---|
| all cancel keys | 12,218 | **9.6%** |
| `_State` bit 18 | 133 | **98.5%** |
| `_State` bit 19 | 240 | **98.3%** |
| `_State` bit 20 | 35 | **100%** |

A tenfold lift over the base rate, on three bits, is a decode. Bits 4 and 5 of
the same field are common and sit near the base rate, so they are something else
— grounded and crouching are the obvious candidates, and neither separates
cleanly enough to claim.

This matters on its own: `airOnly(key)` says whether a cancel option requires
the attacker to be in the air, which is a real gate the sim would otherwise
offer to a grounded fighter.

### The low nibble still does not read, and cannot be made to

The structure is real and reproducible:

- **Nibble 7 occurs almost only before the move is active** (775 of 813), and
  never after it.
- **Nibble 4 occurs almost only after** the active frames, and is overwhelmingly
  on the Drive Rush group.
- **Nibble 11 runs from the first active frame**, and is the dominant live
  cancel key.
- **Nibble 15 is what an idle action opens with** — everything available from
  neutral carries all four bits.
- `_Other` 64 correlates exactly with `_NotDefer: false`, so the buffer is
  already readable without the nibble.

Two readings fit, and they contradict each other:

- **bit 2 means "the attack connected".** Then the late Drive-Rush-only window
  (nibble 4) is the on-contact extension, which matches the game — but the
  earlier window (nibble 11, no bit 2) would then permit a Drive Rush cancel on
  whiff, which the game does not.
- **bit 2 means "nothing has connected yet".** Then the early window is
  contact-only, which matches — but the late Drive-Rush window becomes
  whiff-only, which is nonsense.

**The decisive experiment is not available.** ADR-0010 established that this
project's method is grading one source against another, and there is no source
here to grade against. FAT publishes `xx` (which normals cancel), `hcWinSpCa`
(where the window ends) and `DRoH`/`DRoB` (Drive Rush advantage) — and
`DRoB` turns out to be published for exactly the moves `xx` marks
special-cancellable, so it does not separate the two populations either. **No
published column distinguishes a whiff cancel from a contact cancel**, because
no frame-data set records it.

Two hypotheses were tested and killed rather than left open:

- **The four bits are not the four control styles.** `_ValidStyle` is its own
  field on the key, non-zero on 311 keys, so style is handled elsewhere.
- **They are not the character's state.** That is `_State`, as above.

## Decision

Keep the flag whole and stop guessing. `cancels[]` now carries `state`, `input`
and `other` alongside `cond`, so the next attempt is a re-read rather than a
re-extract. `airOnly()` exposes the part that does read.

## Consequences

- The negative result is recorded as a result. Nothing downstream depends on the
  low nibble, exactly as ADR-0008 arranged, so nothing is blocked by it.
- **What would settle it is frame-stepping the game**: set a normal to whiff at
  range, attempt the cancel, and watch which windows accept the input. That
  needs SF6 with REFramework on Windows — the same blocker as refreshing the
  dumps (ADR-0004), and the same person.
- Until then the sim treats every extracted window as available, which is right
  for special cancels on contact and over-permissive on whiff. Where that
  matters is a dummy that fights back, which ADR-0009 already listed as needing
  a policy decision rather than more extraction.
