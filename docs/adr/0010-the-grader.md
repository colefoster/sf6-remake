# ADR 0010 — The grader is a third thing, and it belongs to neither derivation

- Status: accepted
- Date: 2026-08-17
- Extends: [ADR-0001](./0001-frame-data-engine-not-simulation.md),
  [ADR-0006](./0006-hit-data.md), [ADR-0007](./0007-scenario-player.md)

## Context

Every finding in this project landed the same way: the game's dumped data was
checked against the published frame data, the agreement was counted, and the
count was written into an ADR as prose. Startup and active against FAT's columns
(ADR-0004), blockstun against the derived identity (ADR-0006), the sim's
advantage against published advantage (ADR-0007), cancellability against FAT's
`xx` column (ADR-0008).

Each of those was a one-off script, run once and thrown away. The numbers in the
ADRs are therefore *claims about a moment*, and nothing re-checks them. Worse,
one of them was checked against the thing it was derived from — ADR-0006 caught
exactly that failure once already ("the old test asserting 14 was checking the
identity against itself") and fixed the instance without fixing the pattern.

Four of FAT's own columns had never been read at all: `hitstun`, `blockstun`,
`total`, `hcWinSpCa`. `src/data/fat-adapter.ts` drops them. They turn out to be
external graders for three of the project's central claims.

## Decision

Add `src/verify` — a standing comparison of the two sources — and a
`sf6 verify [char ...]` command that prints it. It is a **third thing**, not a
layer on either side:

- `src/engine` answers frame questions from FAT alone.
- `src/sim` plays them out from the dump alone.
- `src/verify` compares them and belongs to neither.

Nothing under `engine/`, `sim/`, `data/` or `domain/` may import it, and
`tests/verify.test.ts` asserts that mechanically. It reads
`data/raw/SF6FrameData.json` directly rather than through the domain model for
the same reason: `blockstun` is a grader, and putting it on `Move` would let it
leak into `stunFrom` and quietly couple the two sides.

Results are split into a **clean population** — an exact name-and-frame mapping
of a single-hit move whose startup already agrees — and everything else. A
disagreement only means something in the first; the rest is the multi-hit and
soft-mapping noise ADR-0004 and ADR-0008 already describe.

## Findings

Four checks at the time of writing, over the 24 characters with geometry. A
fifth, `advantage`, was added by [ADR-0011](./0011-margin-frame-is-recovery.md),
and three more — invulnerability, graded against prose rather than a column — by
[ADR-0014](./0014-per-frame-invulnerability.md).

> **The rates below were measured over 19 characters, not 24.**
> [ADR-0014](./0014-per-frame-invulnerability.md) found that `loadGeometry`
> silently missed the five fighters whose ids carry punctuation. Four of the five
> rates move by under a point once they are included; `cancelEnd` drops to 88.8%,
> because those five are worse than the roster on that check specifically.

| check | clean | what it compares |
|---|---|---|
| `hitstun` | 91.3% | the hit table's hitstun vs FAT's published `hitstun` |
| `blockstun` | 93.4% | the hit table's blockstun vs FAT's `blockstun` + 4 |
| `total` | 93.3% | the action's `MarginFrame` vs FAT's published `total` |
| `cancelEnd` | 91.8% | the cancel window's last frame vs FAT's `hcWinSpCa` |

- **The guard release survives being swept.** ADR-0006 measured
  `GUARD_RELEASE = 4` against the hit table and derived it from the engine's own
  identity. FAT publishes its own `blockstun` column, so the constant can be
  tested against an outside number at every value:

  ```
  +0   0.0%     +3   1.6%     +6   1.2%
  +1   0.4%     +4  93.4%     +7   0.0%
  +2   2.7%     +5   0.0%     +8   0.8%
  ```

  A spike, not a trend. Four is the answer and its neighbours are noise. This is
  the strongest form the claim can take and it is now a test.
- **Hitstun carries no constant**, as ADR-0006 said: offset 0 agrees outright.
  That is the control the blockstun sweep is read against.
- **`hcWinSpCa` checks the cancel window's boundary**, which ADR-0008 could not.
  `hcWinSpCa = cancelEnd − startup + hitstop + 2` holds on 91.8% of the clean
  population. ADR-0008 validated only that a window *exists* where FAT says one
  should; this validates where it ends.
- **`MarginFrame` is FAT's `total`** on 93.3% of the clean population. It has
  been extracted and typed since ADR-0004 and read by nothing.
- **The disagreements cluster by move, not by check** — a move that disagrees
  tends to disagree on several checks at once, which is what patch skew looks
  like and what extraction noise would not. That clustering is itself a test.

Two errors in the record, found by the checks and corrected:

- **`CONTEXT.md` had `Total` one frame long.** It read
  `startup + active + recovery`; startup already counts the first active frame,
  so the identity is `startup + active + recovery − 1`. FAT's `total` and the
  game's `MarginFrame` agree with each other and both said so.
  `totalFrames` in `frames.ts` had the same off-by-one and is corrected. This is
  the second time the prose and the data have disagreed by one frame in this
  direction (ADR-0006 was the first).
- **The README overstated the sim's independence.** ADR-0007's claim is exact —
  the sim never reads `onBlock`/`onHit` — but `src/sim/index.ts` does read FAT's
  `active` and `recovery` to know when the attacker recovers. Since published
  blockstun is `onBlock + active + recovery + 4`, half of the identity is
  supplied by the source being checked. Still a real check, but a narrower one
  than "derived, not looked up" implies, and now stated as such.

## Consequences

- `sf6 verify` prints the four checks, the worst characters, and every
  disagreement in the clean population. It is the artifact that makes the
  project's method visible instead of restating it in prose.
- `tests/verify.test.ts` asserts agreement floors per check, the guard-release
  sweep, the disagreement clustering, and that no character fails wholesale — a
  character far below the rest means the extraction broke for them specifically,
  which is a bug rather than skew.
- The floors are set below today's rates on purpose. They are there to catch a
  regression, not to pin an exact number that a re-dump would move.
- **This made `MarginFrame` the obvious next question**, and the grader is what
  answered it. It agreed with FAT's `total` on 93.3% of clean moves while being
  read by nothing, and `src/sim` was borrowing FAT's `active + recovery` for
  exactly that number. The open worry was that it might be the animation's
  length rather than the actionable frame — Ryu's Tatsus read 47/62/79 against
  FAT's 29/27/32. It is not:
  [ADR-0011](./0011-margin-frame-is-recovery.md) settles it as recovery, the sim
  uses it, and the sim now reads nothing published at all.
