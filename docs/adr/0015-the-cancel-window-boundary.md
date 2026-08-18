# ADR 0015 — The cancel window's boundary: a chained input can't be graded, and nibble 4 is not a special cancel

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0008](./0008-cancel-windows.md), [ADR-0010](./0010-the-grader.md),
  [ADR-0013](./0013-conditionflag.md)

## Context

[ADR-0014](./0014-per-frame-invulnerability.md) fixed a slug mismatch that had
hidden five fighters from `loadGeometry`, and the grader's rates moved with the
larger population. Four of the five moved by under a point. `cancelEnd` dropped
from 91.8% to 88.8%, and the five newly visible characters scored 75.0% on it
against 91.8% for the rest. That is the signature of something real rather than
skew, so it was worth chasing rather than recording.

The identity under test, from ADR-0010:
`hcWinSpCa = cancelEnd − startup + hitstop + 2`.

## Findings

### The check was pooling two populations, one of which it cannot grade

Splitting the clean population the way [ADR-0011](./0011-margin-frame-is-recovery.md)
split `total`:

| population | agreement |
|---|---|
| plain inputs (`5MP`, `2LK`) | 111/120 — 92.5% |
| chained inputs (`5MP > HP > HK`) | **0/7 — 0.0%** |

**This is the same structural difference ADR-0011 found, in its extreme form.**
FAT measures a target combo's numbers from the start of the whole string; the
dump measures the action alone. On `total` that left the chained population
merely worse (59.2%). On `hcWinSpCa` it is total: not one chained input agrees,
and the misses are enormous — Dee Jay's `5MP > HP > HK` reads 19 against FAT's
73. Nothing is wrong with either number. They are answers to different questions,
and pooling them is what dragged the headline down.

The five characters were not worse at anything. They simply had more chained
inputs among their mapped moves.

### `hcWinTc` is the rival reading, and it loses outright

FAT publishes *two* confirm windows: `hcWinSpCa` for special cancels and
`hcWinTc` for target combos. ADR-0008 assumed the extracted window was the
special-cancel list. That assumption had never been tested against the
alternative, and 13 plain moves publish different values for the two columns —
enough to separate them.

| the extracted window matches | on the 13 moves where the columns differ |
|---|---|
| `hcWinSpCa` | **13/13 — 100%** |
| `hcWinTc` | 0/13 — 0% |

Not a preference, a partition. `verify()` takes a `confirmColumn` option so this
runs as a test rather than sitting in prose, on the same principle as ADR-0010's
guard-release sweep: a window compared only to the column it was assumed to be is
not being checked.

### `ConditionFlag` nibble 4 marks a window FAT's special-cancel column excludes

ADR-0013 established, from the dump alone, that low nibble 4 occurs almost only
*after* a move's active frames and is overwhelmingly on the Drive Rush group. It
could not say what the nibble meant, because no published column separated a
whiff cancel from a contact cancel.

`hcWinSpCa` turns out to separate something adjacent. Chun-Li's lights carry
three live keys where other fighters carry one:

```
Chun-Li 2LP    f4-6  g32   nibble 11
               f4-6  g150  nibble 11   (Drive Rush)
               f7-8  g150  nibble  4   (Drive Rush)
```

The window as extracted took the union and ended at frame 8. FAT publishes a
confirm window that ends where the **nibble-11** key ends, at frame 6.

| moves carrying a live nibble-4 key | as extracted | nibble 4 excluded |
|---|---|---|
| 4 (all Chun-Li) | 0/4 — 0% | **4/4 — 100%** |

**Two independent lines now agree that the nibble-4 window is not a special
cancel** — ADR-0013's structural observation from the dump, and FAT's
special-cancel column from outside it. That is a decode of what the window is
*for*, and it is the first external constraint anything in the low nibble has
had.

**It does not settle ADR-0013.** That ADR's open question is what bit 2 *means*,
and both of its rival readings still predict this result: whether bit 2 says "the
attack connected" or "nothing has connected yet", the late Drive-Rush-only window
is still a distinct window that a special-cancel column would not measure. The
decisive experiment is unchanged — frame-stepping the game on a Windows box — and
the population here is four moves on one character, which is a clean signal and a
narrow one.

## Decision

Exclude nibble-4 keys from the special-cancel window in
`scripts/extract-geometry.mjs`, falling back on the whole set where excluding
them would leave no window at all — an empty window is a worse answer than a long
one, and ADR-0008's count of 6 disagreements with FAT's `xx` column is unchanged
either way.

Keep the pooled `cancelEnd` headline and assert the plain/chained split
separately, rather than redefining the clean population. Redefining it would move
all five checks' numbers to fix one, and the split is more informative as a stated
fact than as a filter.

## Consequences

- `cancelEnd` goes from 88.8% to **91.0%** pooled, and **95.0%** on plain inputs
  alone. The gain is the nibble-4 exclusion; the rest of the story is that the
  91.8% in ADR-0010 was measured on a smaller and accidentally cleaner set.
- Three new tests: the plain/chained split with the chained population asserted at
  exactly zero so the two are never silently merged again, the `hcWinSpCa` vs
  `hcWinTc` partition, and the raised floor.
- **ADR-0008's central claim is stronger than when it was written.** It validated
  that a window exists where FAT says one should; ADR-0010 validated where it
  ends; this validates *which of FAT's two windows it is*, which is the part that
  could have been quietly wrong all along.

## Not settled

- **The six remaining plain disagreements** are +2 on A.K.I.'s 5MP and Ryu's 2LP,
  +8 on Akuma's 5LP, +5 on Cammy's 8MP, and −1 on Jamie's and Luke's lights. Each
  has a single live key, so there is no window union to blame and no nibble to
  exclude; they look like the patch skew ADR-0004 describes. Akuma's 5LP is the
  exception worth a look — its window is set by a one-frame key at f14 in a group
  that also opens at f1-3, which is a shape no other fighter has.
- **Whether a chained input can be graded at all on this check.** It would need
  the string's own startup rather than the action's, which means composing an
  action with its predecessor — the same deferred work ADR-0011 and ADR-0012 keep
  arriving at from different directions.
