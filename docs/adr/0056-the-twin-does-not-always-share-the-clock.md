# ADR 0056 — The twin does not always share the clock

- Status: accepted
- Date: 2026-08-20
- Extends: [ADR-0055](./0055-a-blocked-move-hands-over-to-its-twin.md),
  [ADR-0011](./0011-recovery-from-marginframe.md)

## Context

ADR-0055 took `advantage` from 83.0% to 84.4% by handing a blocked move over to
its GUARD twin and reading the twin's `MarginFrame`. It left 86 failures, GUARD
right "7 times in 10, not 10", and two grader blind spots that stopped the rest
being attributed at all.

## Findings

### FAT's bracketed total was being dropped, not graded

`plainInt` accepted `24` and refused `24(26)`, so **89 clean moves got no
`total` comparison** — the very moves ADR-0055 was about. Read as a pair, the
leading number is the base action's own `MarginFrame` on **77 of the 89**. The
`total` check now grades them: 473/497 → **550/587**, a rate of 93.7% over 18%
more moves.

The other blind spot is not worth closing. Twenty-one clean moves state
blockstun as something other than an integer, and the forms are three different
quantities wearing one column — `19*13 (21 total)`, `36(26)`, `28 total`. Taking
the leading number agrees on **2 of the 21**. There is no reading here; the
population is small and heterogeneous, and grading it would add noise.

### With `total` graded, the failures attribute

Of the 86 advantage failures, only **15** had both a verified-agreeing blockstun
and a verified-agreeing total. Twenty-eight had a disagreeing blockstun, 19 a
disagreeing total, 26 no blockstun at all (a projectile: the shot carries the
hit data, not the caster's action).

The 15 clustered hard. Four sweeps — Akuma, Ken, Rashid and Ryu's `2HK` — were
each about **+9**, and every one of them carries a GUARD branch that ADR-0055's
rule should already have followed.

### The branch says whether the twin restarts

`BranchKey` carries `_InheritFrameX` and `ActionFrame`, and the extraction was
reading neither.

```
A.K.I. ATK_5MP -> 604  GUARD  start 10  ActionFrame 0  _InheritFrameX true
Akuma  ATK_2HK -> 645  GUARD  start  8  ActionFrame 0  _InheritFrameX false
Ryu    ATK_5HK -> 618  GUARD  start 11  ActionFrame 0  _InheritFrameX false
Ryu    ATK_5HK -> 618  GUARD  start 12  ActionFrame 1  _InheritFrameX false
Ryu    ATK_5HK -> 618  GUARD  start 13  ActionFrame 2  _InheritFrameX false
```

Ryu's four keys are the same handover on four consecutive frames, each naming
the frame the twin starts on: the twin's clock is the base's minus 12. So there
are two kinds of twin, and the dump distinguishes them:

- **inheriting** — one clock. The twin's `MarginFrame` is in the base action's
  frame space.
- **restarting** — two clocks. The twin begins at `ActionFrame` and its
  `MarginFrame` counts from there.

Which is why FAT publishes the bracket in two different columns, and it splits
without a single crossover:

| branch | n | twin == FAT's 2nd **total** | twin == FAT's 2nd **recovery** |
|---|---|---|---|
| inheriting | 26 | **18** | 0 |
| restarting | 6 | 0 | **6** |

Across every mapped attack, 167 contact branches inherit and 69 restart — GUARD
is the type that restarts most often (36 of 61).

Reading a restarting twin on the base's clock was not a small error, it was a
sign error: Akuma's `ATK_2HK` ends at 34 and `ATK_2HK_G` at 29, so a **blocked**
sweep recovered five frames **sooner** than a whiffed one.

## Decision

`GeometryAction["branches"]` carries `inherit` and `actionFrame`.
`contactHandover` returns the branch alongside the twin and `handoverFrame`
converts a frame of the base action into the twin's own — inheriting branches
pass it through, restarting ones rebase it onto `actionFrame`. The sim measures
the attacker's remaining recovery from that frame rather than from the base's,
and `Fighter.handOver` moves the runtime's frame the same way.

`publishedTotal` in `src/verify/index.ts` reads FAT's bracketed total as its
leading member.

## Consequences

- **advantage 467/553 → 484/553, 84.4% → 87.5%.** Seventeen moves, no other
  check moved.
- **total 473/497 → 550/587**, 95.2% → 93.7% over 90 more moves.
- Specials' advantage went 0.59 → 0.66, which broke the ceiling
  `tests/verify.test.ts` records for them. The ceiling moved with it.
- The unattributed population — a failure whose blockstun and total both agree —
  is down from 62 at ADR-0055 to **5**.

## Not settled

- **Projectiles, 26 failures.** The caster's action has no block row, so they
  get no blockstun comparison and the sim leans on `PROJECTILE_CONTACT = 8`
  (ADR-0023) for all of them. The errors run −2 to −25 and are not one constant.
- **Blockstun, 28 failures**, and 21 more moves whose published blockstun is not
  an integer at all.
- **The other ten branch types** remain unread, type 46 the commonest of them.
  ADR-0055's note stands; nothing here touched it.
- **Five failures with both inputs verified**: E.Honda 2HP, Luke 5MK, Manon 5HK,
  Manon 214HK, Terry 214LK, all within three frames.
