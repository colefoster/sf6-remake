# ADR 0041 — Getting up, getting out, and the damage that was not read

- Status: accepted
- Date: 2026-08-19
- Extends: [ADR-0025](./0025-what-to-press-and-what-a-hit-does-to-you.md),
  [ADR-0033](./0033-dmgtype-is-the-knockdown-and-the-floor-time-is-not-recoverable.md),
  [ADR-0034](./0034-a-throw-is-a-range-check-and-its-damage-is-somewhere-else.md)

## Context

Three of the runtime's stated gaps — quick rise, throw teching, and grey health
— and one measurement ADR-0033 gave up on. Taken together because two of them
turn out to be the same shape: the dump holds the *rule* and not the *input*.

## Findings

### `DmgRecover` is the Drive Reversal's damage, and it was being thrown away

`DmgRecover` is set on 27 of 3,167 hit rows, which reads like noise until you
look at *which*: it is `ATK_CTA_4` — the Drive Reversal — on all 22 fighters
that have one, and nothing else. Those rows state `DmgValue: 0` and
`DmgRecover: 500`, and **FAT publishes the move's damage as 500**.

So a Drive Reversal deals only recoverable damage, and reading `DmgValue` alone
made it a free hit in the match. Recoverable damage is damage; what makes it
recoverable is a pool that grows back, and no regeneration rate is in either
dump, so it comes off health here and stays off. The match tracks how much of
what each side has lost was grey, and nothing gives it back.

Adding the field also buys a new grader check that did not exist:

| reading | agreement |
|---|---|
| `DmgValue` alone | 594/703 84.5% |
| `DmgValue + DmgRecover` | 614/703 87.3% |

which lands in `sf6 verify` as `damage 602/661 91.1%` over its own population.

### Quick rise is `DownTime`, refused

There is one down action per fighter — `BAS_DN_STD_AO` — and it does not come in
two lengths, so the *animation* of a quick rise is not in the dump. What is in
the dump is the split ADR-0033 already found: the floor is `DownTime` plus the
down action's own recovery, and `hardKnockdown` (`_no_rolling` or `DownTime` 0,
96.1% against FAT's `HKD`) says whether the knockdown is soft.

That is enough for the mechanic. **`DownTime` is the refusable part**; the get-up
is not. Ken quick-rising Ryu's Drive Impact stands up exactly 12 frames sooner,
which is its `DownTime` to the frame.

`hardKnockdown` moves into the geometry module so the runtime and the grader
read one rule, the same move ADR-0037 made for `breaksArmor`. The *input* — down
— is asserted, and marked as such.

### `NGE` and `NGF` are the throw tech, and their being equal is the mechanic

Both have been in every fighter's action list since the geometry was first
extracted with nothing routing into them: 43 frames each, no hitbox, no motion,
`MarginFrame` of −1.

Equal length with no recovery of their own is exactly a throw tech: both sides
free on the same frame, at neutral. The condition needs no invented window
either — the defender has to be in their own `NGS`, and `NGS`'s five frames
before the catch branch *are* the window.

(An earlier attempt used the throw trigger's four-frame input buffer via the
fighter's press history. It never fires: `fired` deletes a button's press once a
trigger consumes it, so by the time the throw connects the defender's own throw
has eaten the evidence. Asking what action they are in is both simpler and true.)

### The knockdown advantage is still not reconstructible, and now more precisely so

ADR-0033 reported 13% on FAT's `KD +N`. Re-running it over 119 clean moves with
everything decoded since:

- **`HitStun` equals `MoveTime` on every knockdown row**, so those two are one
  number and not two candidates.
- The best formula built from stun, `DownTime`, the reaction action and the down
  action reaches **2.5%**.
- What is left over, `KD + attackerActionable − stun − DownTime`, sits between 28
  and 40 with no field in the row predicting where. It is **32 on all 19 Drive
  Impacts** — a genuine constant for one move — and scattered everywhere else.
- The scatter tracks being *launched* (`knockback.y > 0`), which points at an
  airborne arc: the defender's flight time before they reach the floor. No
  gravity constant is in either dump, so it cannot be computed.

Recorded as a dead end with its cause named, rather than a fourth attempt.

## Decision

Read `recoverable` as damage and track the grey total on the match. Add a
`damage` check to `sf6 verify`.

Move `hardDown` from the grader into the geometry module as `hardKnockdown`. Let
`react` carry whether the floor is refusable, and let a fighter holding down skip
the `DownTime`.

Add `Match.teched`: a throw whose defender is themselves in `NGS` puts both into
`NGE`/`NGF` for no damage.

## Consequences

- Ryu's Drive Reversal deals 500, where it dealt 0.
- A quick-risen Drive Impact knockdown gets up 12 frames sooner; a sweep cannot
  be quick-risen, because Ryu's 2HK carries `_no_rolling` on every condition.
- Two throws at once tech, and both fighters end at neutral.
- `sf6 verify` gains `damage 602/661 91.1%`. The original five are unmoved:
  93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 213 tests pass.

## Not settled

- **Grey health never comes back.** No regeneration rate is in either dump — the
  only `Recover*` fields on `PlData` are the Drive gauge's.
- **The quick-rise input is asserted**, and only down. SF6 also takes two
  buttons.
- **Back rise is not modelled.** FAT's own phrasing for a hard knockdown is
  "denies back-roll option on wake-up", so there is a third wake-up option and
  no action in the dump plays it.
- **A tech does not push the two apart.** `NGE` and `NGF` carry no motion at all,
  so the separation SF6 gives a teched throw is not in them.
- **`KD +N` is unreconstructed**, for the reason above: the missing term is an
  airborne arc with no stated gravity.
