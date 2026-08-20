# ADR 0054 — The parry is in the dump; the just window is not

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0031](./0031-the-gauges-are-priced-by-the-dump-and-graded-by-fat.md),
  [ADR-0052](./0052-the-opponent-is-a-function-and-the-panel-asks-the-questions.md)

## Context

`match.ts` has named Drive Parry as a gap in its own header since it was written.
It was the last SF6 system of any size the engine did not have, and the two
things that made it untestable — a dummy that defends, and a panel that shows
advantage and Drive — shipped in ADR-0052.

## Findings

### Nearly all of it was already there, in four different places

| | where |
|---|---|
| costs half a bar | the `Parry` trigger's `focus_consume`, 5000 |
| the stance | `DPA_STD_START` → `DPA_STD_Loop`, a type-0 branch |
| crouching | `DPA_CRH_START`, the same shape |
| drains 50 a frame | an `EventKey` on those actions |
| the release costs 33 frames | `DPA_STD_END`'s `MarginFrame` |
| the catch | `DPA_L` / `DPA_M` / `DPA_H`, one per attack strength |
| the freeze | `HIT_DT`'s `ParryStopOwner`, on 5,625 rows |
| what it costs the defender | `HIT_DT`'s `DriveNorm` — and `DriveJust` beside it |

### The input is in the dump, one trigger over

The `Parry` trigger states its price and its action and **no buttons at all**:
`ok_key_flags` is absent on all 24 fighters. The buttons are on its neighbour —
the `DriveDash` trigger that carries no motion is the parry-into-rush, and it is
`MP+MK` on all 24. So the extractor fills the parry's keys from that sibling
rather than this repo authoring the input. Without it the parry cannot fire.

### One gauge rule, three mechanics

`_IsCHARA_GAUGE_ADD` events say what an action does to a gauge **per frame while
it runs**. 270 actions across the roster carry one and they are three mechanics:
holding Drive Parry drains **50**, walking forward regenerates **20**, and a
throw tech hands back half a bar over its single frame. Applying the events
rather than the parry gave the forward-walk regeneration — which the engine also
did not have — for nothing.

### A parry is not a block with better numbers

No damage, no chip, no blockstun, no combo, and no height rule: the low/overhead
check is the *block*'s, and a parry catches whatever came. It is a fifth
`Contact`, resolved on its own path.

### Measured: the parry leaves you worse off, and that is the point

| Ryu, point blank | blocked | parried |
|---|---|---|
| 2MK | −6 | **+14** |
| 5LP | −1 | **+26** |
| 5HP | −2 | **+15** |
| 5HK | 0 | **+13** |

Positive is the attacker's advantage, so parrying a normal and letting go leaves
the defender 13 to 26 frames minus, against roughly even for a block. That is
not a bug: it is `DPA_STD_END`'s 33 frames. **The value of a parry is not in the
frames it leaves, it is in what the catch cancels into**, and `DPA_M` carries a
cancel window over its whole length for exactly that. Cancelling it into a Drive
Rush is the next piece of work.

### The one thing not stated: when a parry is *just*

`DriveJust` sits beside `DriveNorm` on 8,432 rows — the dump prices a just parry
without ever saying when one happens. No frame count names the window: not in the
`DPA_` actions, not in `char_info`, not in the hit rows.

The only candidate is a boundary. Both `DPA_STD_START` and `DPA_CRH_START` split
**two independent key lists at the same place** — hurt keys 1–2 then 3–end,
cancel keys 1–2 buffered then 3–end live — and nothing else in either action
changes there. A 2-frame window at the very start is also what the community has
measured Perfect Parry to be. That is an inference, and it is not modelled here:
the engine implements the normal parry and leaves `driveDamage.just` unread.

## Decision

`gauge` events and `parryStop` out of the extractor; `driveTickAt` in geometry;
`Fighter.parrying`, the stance chain, the per-frame gauge tick and the release in
`index.ts`; `"parry"` as the fifth `Contact` in `match.ts`; `parryAll` in
`dummy.ts` and in the page's P2 dropdown.

## Consequences

- `sf6` plays Drive Parry. Holding `I`+`K` on `play.html` parries, and P2 can be
  set to parry everything.
- Six tests, 248 green, and the roster grades unchanged — the parry adds a state
  nothing else enters.
- Walking forward now regenerates Drive at 20 a frame, which is a mechanic the
  engine was missing and never had an issue open for.
- `actionable()` is false while parrying. The parry actions all state
  `MarginFrame` −1, which everywhere else means "movement, leave whenever";
  read that way a parried 2MK came out at −31 for a defender who could not in
  fact do anything.

## Not settled

- **The just-parry window**, above.
- **Parry into Drive Rush.** The cancel window is in `DPA_M`'s group 11 and the
  rush is decoded (ADR-0036); chaining them is its own piece, and it is what
  makes the numbers above read the way a player expects.
- **Passive Drive regeneration does not stop while parrying.** `FocusRecoverNM`
  is applied every frame whatever the action, so the parry's real cost is 50
  minus 40. Nothing in the dump says the game suppresses it; nothing says it
  does not either.
- **`DriveNorm` is applied as the defender's cost on a parry only.** Blocking
  still drains from `driveHit`, which is what the graded numbers were built on
  and is left alone.
