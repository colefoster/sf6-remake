# ADR 0009 — What a cancel costs, and how long the input buffers

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0008](./0008-cancel-windows.md)

## Context

ADR-0008 extracted *when* a move can be cancelled and *into what*, but left the
question a player actually asks unanswered: **can I afford it?** A cancel list
holds Hadoken, EX Hadoken and three levels of super side by side, and the sim
had no way to tell them apart.

That is what `triggers.json` holds, and ADR-0008 deferred fetching it.

## Decision

Fetch `triggers.json` (roughly 700 KB per fighter, gitignored) and extract the
handful of fields that decide whether an option is available: what it costs,
how long its input buffers, and the game's own classification of it. Change the
cancel lists to hold **trigger indices** rather than action ids, which is what
they actually contain — a list holds one trigger per strength, and it is the
trigger, not the action, that carries the price.

## Findings

- **The chain resolves exactly.** Every one of the 9895 cancel-list entries
  across the 24 fighters resolves to a trigger, and every trigger's `action_id`
  matches the action MMDK annotated the entry with. No unresolved indices, no
  mismatches.
- **Costs are in gauge units, and they are the numbers players quote.** Drive is
  60000 across six bars and super 30000 across three, so `focus_consume` and
  `gauge_consume` read straight off:

  | option | cost | bars |
  |---|---|---|
  | EX ("Extra") special | 20000 | 2 Drive |
  | Drive Impact | 10000 | 1 Drive |
  | Drive Reversal | 20000 | 2 Drive |
  | Drive Rush cancel | 30000 | 3 Drive |
  | Drive Parry | 5000 | ½ Drive |
  | SA1 / SA2 / SA3 | 10000 / 20000 / 30000 | 1 / 2 / 3 super |

  Nothing had to be calibrated to get this: the units were already the game's,
  and every published cost fell out of them. That is the validation.
- **`focus_need` is a flag, not an amount** — 0 or 1 on all but one trigger in
  the roster. `focus_consume` is the number that matters.
- **A move's later parts are free.** 87 of the 282 `Extra` triggers and every
  follow-up part of a super cost nothing, because the trigger that started the
  sequence already took the meter — Ken's Jinrai follow-ups, Dee Jay's Jus Cool
  string, Akuma's demon flip enders. Eleven of these are reachable from a
  normal's cancel list, which is correct rather than a leak: the list is shared
  with the parent move.
- **One bar of Drive is a real price**, on 22 triggers: Juri's Fuha stock
  releases and a charged Guile and Luke variant. Everything else is 2.
- **The buffer is 4 frames.** `preceding_time` is 4 on 1851 of 2460 triggers,
  6 on air specials, and never above 7.
- **The `_Is` flags are the taxonomy the engine has been inferring** from FAT
  strings: `Extra` for EX, `Lv1`..`Lv4` for super level (`Lv4` is the level 3
  again at low health — the Critical Art — at the same price), `Special_1`..`_n`
  for which special slot, plus `DImpact`, `DReversal`, `DriveDash`, `Parry`,
  `ParryDash`, `ChainCombo`, and the strength and button bits.

## Consequences

- `GeometryFile.triggers` maps trigger index to `{action, buffer, drive?,
  super?, kind?}`. 2437 triggers across the roster, about 9 KB per fighter.
- `cancelOptions` resolves a move's window through group → trigger → action and
  returns each option with its price; `affordable` filters by what is in the
  gauges. `cancelTargets` keeps returning distinct actions.
- `sf6 boxes` prints the menu by price — *18 free, 7 at 2 drive, SA1, SA2, SA3*
  — and the buffer; `web/boxes.html` badges the same.
- Tests assert the prices rather than the parse: supers cost one bar per level,
  EX costs two, Drive Impact one, Drive Rush three, Drive Parry a half. If the
  extraction drifts, those break before anything else does.
- **`commands.json` stays unfetched.** It is the motion inputs — button masks,
  charge times, the rotate steps of a 360 — and it answers what to press rather
  than what happens. The engine has FAT's notation for that already.
- Still not modelled: the sim does not spend the meter it can now read. Making
  the dummy fight back needs a policy ("reversal with the cheapest thing that
  beats this") on top of the options, which is a separate decision.
