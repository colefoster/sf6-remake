# 03 — An opponent that does something

Status: done — ADR-0049, as an unresponsive dummy by decision

## Why

P2 is a second keyboard. There is nothing to practise against.

## What

`src/game/dummy.ts`. An opponent is a function:

```
type Opponent = (match: Match, side: 0 | 1) => InputFrame
```

`Match.advance(p1, p2)` already takes two input frames, so **nothing in
`match.ts` changes**. That matters: it is 930 lines already and a controller does
not belong in it.

Ship the training-mode staples:

- stand / crouch / jump-in-place
- block all, block high only, block low only
- block the first hit then retaliate (the frame-trap tester)
- mash 5LP — the armor and gap tester
- throw-tech on contact
- punish after block: the dummy already knows the advantage, so it presses its
  fastest normal exactly when it is plus
- Drive Impact on wake-up

Selected from a dropdown in `play.html` next to the P2 character select, with
"human" as one of the options so the two-keyboard mode survives.

## Later, not here

A rule-based fighter that reads what the engine knows — advantage, `reach()`,
`minDistance`, what the gauge affords. Worth doing *after* the figure is on
screen, because watching it move is what tells you which behaviours matter.

## Done when

- Every listed behaviour is selectable and visibly does its thing
- `match.ts` is untouched
- `sf6 fight` can drive the same opponents from the CLI (they are just functions)
