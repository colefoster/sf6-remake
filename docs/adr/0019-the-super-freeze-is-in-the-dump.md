# ADR 0019 — The cinematic freeze is in the dump, and it explains three open numbers

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0017](./0017-armor-break-is-a-rule-not-a-flag.md),
  [ADR-0018](./0018-cmnname-says-what-a-move-is.md)
- Extended by:
  [ADR-0020](./0020-full-invulnerability-is-the-absence-of-a-hurtbox.md) — a super
  has no hurtboxes during its freeze, which is what "fully invincible" means and
  what lets supers into the invulnerability checks.

## Context

[ADR-0018](./0018-cmnname-says-what-a-move-is.md) mapped 73 Super Arts and then had
to quarantine them: their action's first active frame runs 47 to 115 frames later
than FAT's published startup, scaling with the level, and no constant corrects it.
That was named as the thing to find — "if the dump records the flash duration,
supers become gradeable" — with `MotionKey` and `VfxKey` as where to look.

It is neither. A super action carries four key lists a normal does not
(`TimelineKey`, `MotionCameraKey`, `SystemCameraKey`, `WorldKey`), and the number
is in `WorldKey`.

## Findings

### `WorldKey.Timer` is the freeze, in frames

Ryu's `SAA_SHINSYORYU_START` carries `{ Timer: -56, _IsTIMER: true, _StartFrame: 0 }`
and its first hit lands on frame 61. FAT publishes startup 5.

The identity, over every mapped super with both numbers:

> `startup − freeze + 1 == FAT's startup` — **43 of 46 exact**

The `− 1` is not a fudge. It is the frame the freeze and the startup share, and it
is the **third** time this project has met the same off-by-one: ADR-0010 corrected
`total = startup + active + recovery − 1` in `CONTEXT.md` and `frames.ts` for
exactly this reason, and ADR-0006 before it. Without it the residual is a flat −1
on 43 of 46 rows, which is what a shared frame looks like.

**317 actions across the roster carry a timer**, and it is not a super-only field.

### Which settles ADR-0017's leftover +4

`ATK_CTA_4` — Drive Reversal — carries **`freeze: 5` on all 50 of its actions**, and
`5 − 1 = 4`. ADR-0017 recorded FAT's Drive Reversal startup as "4 higher than the
action's own first active frame, on all 22 fighters, exactly 4 every time, so
structural rather than skew — not chased". It is the freeze, and it was in the dump
the whole time. Drive Rush (`ATK_CTA_DASH`, `ATK_CTA_RUSH`) carries 10-11.

### Supers become gradeable, and they grade like everything else

Netting the freeze out of `MarginFrame` as well:

| check, exactly-mapped supers | raw | net of freeze |
|---|---|---|
| `total` | 1/50 — 2% | **45/50 — 90%** |

Ninety per cent is the roster's own rate for normals. Supers are back in the clean
population on the same terms as everything else, and `startupDelta` on a mapping is
now recorded in FAT's frame space while `startup` stays in the action's — the sim
counts in one, the grader in the other, and both are wanted.

### And immediately turn up a fourth constant

Promoting Drive Reversal out of `weak` put 18 new rows into the blockstun check,
and every one of them disagrees by exactly the same amount:

```
6HPHK   dump 27   published 25     +2, on all 18 fighters
```

**Drive Reversal's blockstun is FAT's published value plus 6, not the plus 4
ADR-0006 measured on normals.** Uniform across the roster, which makes it a second
guard-release constant rather than skew. It is left in the pooled number rather than
curated out, and asserted as its own test.

## Decision

Extract `freeze` on the action from `WorldKey`, and `inFatFrames(action, frame)` as
the one place the conversion lives. Score a mapping's `startupDelta` in FAT's frame
space and grade `total` there too. Let supers back into the clean population.

**Report the checks per move category as well as pooled.** The clean population is
no longer one population, and a single percentage now hides more than it says —
`blockstun` reads 88.3% pooled and 303/324 on normals with an 0/18 block of one
uniform constant beside it. `sf6 verify` prints the breakdown, and the tests assert
per category rather than only on the pool.

## Consequences

- `total` **93.3% → 93.5%** and `advantage` **87.9% → 89.0%**, both from supers and
  Drive Reversal joining and agreeing. `blockstun` reads **88.3% pooled**, which is
  303/324 on normals plus Drive Reversal's uniform +2.
- The guard-release sweep is now run over normals, the population ADR-0006 measured
  it on. Drive Reversal's +6 would otherwise blunt the spike by 18 rows — and the
  sweep still picks 4 uniquely, which is the claim.
- **56 supers map `exact` with a startup delta of 0**, up from 1 solidly mapped
  before ADR-0018.
- ADR-0017's "not settled" entry on Drive Reversal is closed, and ADR-0018's on the
  super freeze is closed.

## Not settled

- **The three supers the identity misses** are Ken's SA1 (−8 twice) and Luke's
  `214214P` (+2). Ken's is off by the same amount twice, so it is one cause.
- ~~**Supers stay out of `src/verify/invuln.ts` and `src/verify/armor.ts`**~~ —
  the invulnerability half is closed by
  [ADR-0020](./0020-full-invulnerability-is-the-absence-of-a-hurtbox.md): a super
  has no hurtboxes during its freeze, that *is* full invulnerability, and it
  grades at 52/66 through `inFatFrames`. Supers are now in all four
  invulnerability checks. `src/verify/armor.ts` still excludes them.
- ~~**Specials are still 0 solidly mapped of 196**~~ — closed by
  [ADR-0021](./0021-specials-map-through-the-triggers.md): the triggers classify
  specials by family and strength the same way they classify supers by level, and
  193 map exact.
- Whether the large `WorldKey` timers — 406 to 579 on Critical Art actions — are the
  same field meaning the same thing, or the cinematic's own length. The startup
  identity holds taking the largest timer per action, which is weak evidence that
  they are the freeze; nothing else tests it.
