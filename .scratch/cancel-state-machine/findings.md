# Findings: the cancel and input state machine

Read of `triggers.json` / `tgroups.json` / `commands.json` from the MMDK dumps
(Ryu, @ `831564f1`). Nothing extracted yet — this is the map of what the three
files are, so a spec can be written against it. The gap it closes is the one
ADR-0007 names: the dummy can't fight back without it.

## The three files, and how they join up

The chain runs **action → TriggerKey → trigger group → trigger → command**.

### `moves_dict.json` → `TriggerKey` (already in the dumps we parse)

Every attack action carries a `TriggerKey` list that the extractor currently
ignores. Each key is **a cancel window**:

```
ATK_5MP (53f, startup 6)
  f1-1    group 15  cond 7
  f6-10   group 50  cond 5131
  f11-11  group 50  cond 5131
  f4-5    group 30  cond 5135
  f6-9    group 30  cond 5131
```

`TriggerGroup` names a group, `_StartFrame`/`_EndFrame` the frames it is open
(0-indexed, exclusive end — same convention as the collision keys), and
`ConditionFlag` gates it. 41 of Ryu's 47 `ATK_` actions carry them.

MMDK's own UI calls trigger groups **CancelLists** (`MMDK.lua:1900`), which is
exactly what they are.

### `tgroups.json` — the cancel lists

33 groups for Ryu. Each is a **bit array**: the set bit indices are trigger
indices, and MMDK's dump helpfully annotates each with the action it leads to.

Verified: every one of the 435 group entries across Ryu's 33 groups resolves to
a trigger whose `action_id` matches the annotation. Zero mismatches, so the
slot-index-is-trigger-index reading is not a guess.

Ryu's groups read as the cancel vocabulary you would expect:

| group | size | what's in it |
|---|---|---|
| 15 | 41 | every `SPA_`/`SAA_` action plus Drive Impact and Drive Rush — **the special/super cancel list** |
| 30 | 40 | the chain/normal list |
| 0 | 65 | the largest — the neutral list (everything available from standing) |
| 50 | 1 | `ATK_5LK(1)` — a single target-combo follow-up |
| 46 | 58 | used only with condition 7183 |

Small groups (1–3 entries) are target combos and specific follow-ups; large ones
are the general cancel categories.

### `triggers.json` — what a trigger is

86 top-level keys, each an **action id** (zero-padded to 4), mapping trigger
index → record. 97 triggers for Ryu. A record is "how you get into this action",
and it carries everything the sim currently has no answer for:

- `norm` / `easy` / `sprt` / `supr` — the same trigger under Classic, Modern,
  and the two assist styles. Each holds `command_index` (into `commands.json`),
  `ok_key_flags` / `ng_key_flags` (button bits), and **`preceding_time`** —
  the input buffer, in frames. Ryu's 5MP special-cancel trigger buffers 4.
- `focus_need` / `focus_consume` — Drive gauge. `gauge_need` / `gauge_consume` —
  super. `vital_need` — health (Akuma's Raging Demon-likes).
- `cond_range`, `cond_vital_ratio`, `cond_atk_limit`, `cond_jump_cmd_count`,
  `cond_air_jump_count`, `cond_limit_shot_num` — the situational gates.
- `_Is*` flag block (~60 booleans): `_IsSpecial`, `_IsLight`, `_IsKick`,
  `_IsCrouch`, `_IsAir`, `_IsChainCombo`, `_IsDrive`, `_IsDriveDash`,
  `_IsReversal`, `_IsParry`, `_IsLv1`…`_IsLv4`. This is the move taxonomy the
  engine has been inferring from FAT strings.

### `commands.json` — the motion inputs

29 command entries for Ryu, each an input sequence: `input_num` steps, a
`CommandTimer` (frames the whole motion may take), and per-step `normal` key
masks, `rotate` (count + point — the 360/720 motions), and `charge`
(`charge_bit`, `id`, `is_release`). This is the layer the engine least needs:
it answers "what do I press", not "what happens". Worth extracting last, if at
all.

## What is decoded, and what isn't

Decoded and verified: the action → group → trigger → action chain, the frame
windows, and the meter/buffer/condition fields listed above.

**`ConditionFlag` is not decoded.** MMDK doesn't decode it either — it prints
the raw integer. It splits into `_Input` (0xC000 bits), `_Other`, and
`_Condition`. Across Ryu's `ATK_` actions `_Condition` takes eight values:

| value | count | bits |
|---|---|---|
| 5131 | 64 | 0,1,3,10,12 |
| 5135 | 41 | 0,1,2,3,10,12 |
| 7 | 16 | 0,1,2 |
| 5127 | 8 | 0,1,2,10,12 |
| 4 | 7 | 2 |
| 7183 | 4 | 0,1,2,3,10,11,12 |
| 4111 | 2 | 0,1,2,3,12 |
| 1025 | 2 | 0,10 |

Bit 2 is the only difference between the two dominant values. The obvious guess
— "bit 2 means the attack must have connected" — is **contradicted** by 5MP,
where group 30 is condition 5135 on frames 4–5 (before the move is even active)
and 5131 on frames 6–9. So it is more likely a buffer/lead-in distinction than a
hit-confirm one. Needs a discriminating case: a Drive Rush cancel (hit/block
only in game) against a raw special cancel (available on whiff).

This matters because it is the difference between "5MP can cancel into a
special" and "5MP can cancel into a special **only on contact**" — which is
exactly the frame-trap and counter-hit question the sim was built to answer.

## Cost

Not currently fetched. Per character: `triggers.json` 845 KB, `commands.json`
445 KB, `tgroups.json` 16 KB — about 31 MB more of gitignored raw dump across 24
characters. The extracted artifact should be small: the cancel windows are a few
hundred bytes per action, and the trigger records reduce to maybe 20 useful
fields out of ~100.

## Suggested order

1. Extract `TriggerKey` windows onto each action (`cancels: [{start, end, group,
   condition}]`) and the groups as `group → [actionId]`. That alone gives the
   viewer a "what can this cancel into, and when" panel and gives the sim its
   cancel table.
2. Decode `ConditionFlag` against known in-game rules. This is the real unknown
   and it gates correctness, not coverage.
3. Pull the trigger fields the sim needs: `preceding_time` (buffer),
   `focus_need`/`gauge_need` (can I afford it), the `_Is*` taxonomy.
4. `commands.json` last, and only if input notation is ever wanted.
