# ADR 0008 — Cancel windows come from the trigger keys, and the frame data confirms them

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0004](./0004-hitbox-geometry-from-mmdk-dumps.md)
- Follows: [ADR-0007](./0007-scenario-player.md)

## Context

ADR-0007 listed "the cancel and trigger state machine" among the things the
scenario player does not model, and pointed at `triggers.json` / `tgroups.json`
as unread. Without it the dummy cannot fight back, and frame traps stay a
frame-data question rather than a positional one.

The data turned out to be closer than that: the cancel windows were already in
`moves_dict.json`, in a key type the extractor had been discarding.

## Decision

Extract cancel windows and cancel lists into `data/geometry/<char>.json`. Fetch
`tgroups.json` (16 KB per fighter) to resolve the lists; leave `triggers.json`
(845 KB) and `commands.json` (445 KB) unfetched until the input side is wanted.

## Findings (how the cancel data works)

The chain is **action → `TriggerKey` → trigger group → trigger → command**.

- **`TriggerKey` is the cancel window.** Every action carries a list of them,
  each naming a `TriggerGroup` and a frame range in the same 0-indexed,
  exclusive-end convention as the collision keys. 41 of Ryu's 47 `ATK_` actions
  have them.
- **A trigger group is a cancel list.** MMDK's own UI calls them CancelLists.
  `tgroups.json` dumps each as a bit array whose set bits are trigger indices,
  already annotated with the action each leads to — which is why `triggers.json`
  is not needed to read them. Verified against all 435 of Ryu's group entries:
  every annotation matches the trigger's own `action_id`, no exceptions.
- **`_NotDefer` false marks the buffer.** Windows come in pairs: a deferred key
  where an input is held, abutting a live key where it comes out. Ryu's 5MP
  buffers its special cancel from frame 4 and executes it from frame 6, which is
  its first active frame.
- **A live window never opens before the move's first active frame.** True for
  all 342 cancellable moves across the roster. On a single-hit normal it opens
  *on* that frame (90% within 3); multi-hit moves open on a later hit.
- **The frame-1 window is not the cancel.** Nearly every attack opens a large
  group — specials, supers, Drive Impact, Drive Rush — for frame 1 alone. It is
  a distinct, pre-active thing, and reading it as the cancel window would make
  every move cancellable into everything.

**Validation**: FAT's `xx` column independently states which normals cancel into
specials or supers. Extracted windows agree with it on **505 of 511** normals
across the 24 characters. Four of the six disagreements are on mappings already
flagged `weak`, `close` or `frame-unique`; Guile's 2HP and Lily's air 2HP are
the patch-skew class ADR-0004 describes — the 2024 dump has no window where the
current frame data says there should be one.

## Consequences

- Each action gets `cancels: [{start, end, group, buffered, cond}]`, each file a
  `cancelGroups` map and the `neutralGroups` the idle actions open. Each mapped
  move gets `cancel: {start, end, buffer, groups}` when it is special-cancellable.
- `sf6 boxes` prints the window and how many specials it opens; `web/boxes.html`
  marks it along the frame strip and badges it.
- Distinguishing a special-cancel list from a target combo is done by content —
  a list holding something that is not an `ATK_` action — because specials are
  named for the move in Japanese and have no name pattern in common. A group
  entry naming an action with no collision data is ignored: several fighters
  open a one-frame group holding one such action at the end of a heavy
  (Chun-Li's stance handoff), which otherwise reads as a special cancel.
- **`ConditionFlag` is kept raw and undecoded.** It splits into `_Input`,
  `_Other` and a `_Condition` field that is two nibbles: bits 0-3 and bits
  10-13. The low nibble partitions cleanly by phase — 7 occurs almost only
  before the move is active (775 of 813), 11 from the active frame on, 4 only
  after — so it is some encoding of the attack's contact state. Which bit is
  which does not follow from the data alone: the two readings that fit the
  Drive Rush lists contradict each other on the pre-active buffer windows, and
  MMDK prints the field raw rather than decoding it. `cond` is stored so a later
  answer is a re-read and not a re-extract; nothing depends on it today.
- Not extracted: the input side. `preceding_time` (the buffer length in frames),
  Drive and super costs (`focus_need`, `gauge_need`), the situational gates
  (`cond_range`, `cond_vital_ratio`) and the ~60-flag move taxonomy all live in
  `triggers.json`; motion inputs, charge and rotate steps live in
  `commands.json`. The sim needs the first of those before the dummy can be made
  to press buttons.
