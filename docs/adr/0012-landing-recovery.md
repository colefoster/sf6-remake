# ADR 0012 — An airborne move recovers on landing, and the dump says where

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0011](./0011-margin-frame-is-recovery.md)
- Closes part of: [ADR-0005](./0005-origin-motion-from-place-and-steer-keys.md)

## Context

ADR-0011 took the attacker's recovery from the action's own `MarginFrame` and
left one hole: 157 of Ryu's 307 actions have no margin at all, and the ones that
matter are every Shoryuken, every air normal, every dive kick. Those fell back
on the published `active + recovery` — except FAT does not publish a plain
number for them either. It publishes `null` for air normals and `"21+12"` for a
Shoryuken, and `Number("21+12")` is `NaN`.

So the sim was computing a jump HP's recovery as **zero** and calling a blocked
jump-in **+9**.

## Decision

Extract where an airborne action puts itself down. An action with no margin of
its own branches into a landing action that has one; record it as
`lands: {action, margin}`, and take the handoff frame from the action's own
motion curve — the frame its `y` returns to the ground.

## Findings

**An airborne action has no margin because there is nothing to recover from
until you touch down.** The recovery lives on the landing action, and FAT's
two-part recovery notation is exactly that split.

Ryu's 623LP, published recovery **`21+12`**:

| | |
|---|---|
| `SPA_SYORYU_START` | 35 frames, margin −1, branches at f29 into `SPA_SYORYU_END` |
| its motion curve | leaves the ground on frame 8, back to `y = 0` on frame **35** |
| `SPA_SYORYU_END` | margin **12** |
| FAT | startup 5, active 10, recovery `21 + 12` |

`35 − (5 + 10 − 1) = 21`, and the landing action's margin is `12`. **Both halves
of the published number come out of the dump**, and the action runs precisely
until it lands — the curve and the frame count agree to the frame.

Across the roster: **the landing action's margin equals FAT's second number on
18 of 20** moves that publish one, and **touchdown + landing margin reproduces
FAT's whole total on 10 of 14**. The misses are moves that hover rather than
arc — Kimberly's Bushin Senpu, Dee Jay's EX Jack Knife.

**Air normals are the case with no answer, and that is the finding.** `ATK_8HP`
carries no motion of its own; it inherits the jump's, so when it lands depends
on when it was pressed. There is no single number, which is precisely why FAT
publishes `null`. Both sources agree the question is malformed as asked.

## Consequences

- `actionableFrame` returns `{frame, source}` with `source` of `action` or
  `landing`, and **undefined for an air normal**. `ScenarioResult.recoverySource`
  carries it through, and `sf6 play` says *"the attacker's recovery is unknown"*
  with a note rather than printing a number.
- **20 moves are now answered from the landing, 13 of them correctly. Under the
  old path 0 of 20 were right**, and 13 of those could not be parsed at all —
  `"21+12"` went through `Number()` and came out `NaN`. Ryu's 623LP now derives
  to **−23**, which is what FAT publishes.
- **Nothing regressed.** Every move the landing path answers wrongly was already
  answered wrongly, and the 11 air normals moved from a confidently wrong number
  to an explicit refusal.
- `web/boxes.html` mirrors `actionableFrame`, so the viewer now derives
  advantage for Shoryukens, which previously showed nothing at all.
- **ADR-0005's air-spacing gap is half closed.** It deferred composing an air
  normal with its jump as "a scenario-player concern". The recovery half is
  answered — by establishing that it *cannot* be answered per action. The
  positional half stands: an air normal's boxes still draw at ground level,
  because placing them needs a press frame the sim does not model.

## Not settled

- **Which branch is the landing** is chosen by chasing to the first target with
  a real margin, depth-capped because branches cycle. It picks correctly on the
  cases checked, but `branch.type` is undecoded, so a move with several
  continuations could be resolved to the wrong one. The four wrong answers above
  (Kimberly's, Ken's `6HPHK`) are candidates.
- ADR-0011 asked whether `MarginFrame` means "can act" or "cancellable into a
  recovery state". This does not settle it: a landing distinguishes the two in
  principle, but every case here agrees.
- ADR-0004's downed pushbox (`BoxNo 6`) is untouched. It lives in a shared asset
  MMDK does not dump per fighter, so it is not reachable from this data at all.
