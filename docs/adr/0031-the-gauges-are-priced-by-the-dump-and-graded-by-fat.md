# ADR 0031 — The gauges are priced by the dump, and graded by FAT

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0009](./0009-what-a-cancel-costs.md),
  [ADR-0025](./0025-what-to-press-and-what-a-hit-does-to-you.md),
  [ADR-0026](./0026-the-fighter-moves-under-its-own-power.md),
  [ADR-0030](./0030-the-stage-is-borrowed-and-the-corner-is-derived.md)

## Context

The runtime could throw an OD Hadoken all day for free. Every trigger in the
dump carries a price — ADR-0009 read `focus_consume` and `gauge_consume` two
years of ADRs ago — and nothing had ever checked one. `_tired` actions and their
type-47 branches sat extracted and untakeable, because burnout is a thing that
happens to a gauge and there was no gauge.

Unlike ADR-0030's stage width, almost none of this had to be borrowed.

## Findings

### The prices are all there, and they are uniform across the roster

`focus_consume` takes four values and nothing else: 5000 (Drive Parry), 10000
(Drive Impact), 20000 (OD specials, Drive Reversal), 30000 (Drive Rush).
`gauge_consume` takes 10000 / 20000 / 30000 for SA1 / SA2 / SA3, and equals
`gauge_need` on all 2,460 triggers. Costs are identical on all 24 fighters.

Enforcing them is one filter in `fired()`. That single line is what makes a
gauge mean anything to the state machine: an unaffordable trigger is not an
option, so the same quarter-circle-and-two-punches reaches the **ordinary**
Hadoken when the Drive gauge is under two bars, rather than reaching nothing.

### FAT publishes seven gauge columns, so the gauge economy is gradeable

This is the part that matters. `DGain`, `DDoH`, `DDoB`, `SelfSoH`, `SelfSoB`,
`OppSoH`, `OppSoB` are on ~2,000 of FAT's 2,445 records, and every one has a
counterpart already extracted from `HIT_DT` (`FocusOwn`, `FocusTgt`, `SuperOwn`,
`SuperTgt`). Five new checks went into `src/verify` on the same registry as the
other five, and they score in line with everything else:

| check | clean | against |
|---|---|---|
| `driveGain` | 539/611 **88.2%** | `FocusOwn` == `DGain` |
| `driveOnHit` | 597/620 **96.3%** | Drive drain == `DDoH` |
| `driveOnBlock` | 603/619 **97.4%** | Drive drain == `DDoB` |
| `superGain` | 558/599 **93.2%** | `SuperOwn` == `SelfSoH` |
| `superGiven` | 558/569 **98.1%** | `SuperTgt` == `OppSoH` |

FAT publishes no *cost* column — a cost is a negative `DGain` or `SelfSoH` — so
the `plainInt` filter drops the spending side along with the multi-hit strings.
What these grade is the per-hit economy, and it is graded on 3,018 comparisons.

### The Drive drain is not on the row it should be on

Written the obvious way, `driveOnHit` scored **0/633** and `driveOnBlock`
**223/619 (36%)**. The obvious way is wrong, and the grader is what said so.

`FocusTgt` on the hit row is **0**. On the block row it is a *positive* 1500 —
the defender gaining Drive, which is not what blocking does in SF6. The drain
FAT publishes is authored on the rows the extractor labels `punishCounter` and
`driveHit`:

| Ryu 5MP, `HIT_DT` row 018 | `FocusTgt` | FAT |
|---|---|---|
| `common.0` hit | 0 | `DDoH` 4000 |
| `common.1` block | +1500 | `DDoB` 3000 |
| `common.3` punishCounter | **−4000** | = `DDoH` |
| `common.4` driveHit | **−3000** | = `DDoB` |

Roster-wide over the clean population: `DDoH` matches `common.3` on **526/554**
and `common.0` on **0/554**; `DDoB` matches `common.4` on **526/538** and
`common.1` on 190/538.

The labels are not the error. Condition 3 really is the punish counter — its
hitstun minus the hit row's equals FAT's `onPC` minus `onHit` on **268/275**
moves, which is as direct a confirmation as the dump offers. Damage is byte
identical across conditions 0, 2 and 3, so a counter does not change the base
damage, only the stun. Two things are therefore both true: condition 3 is the
punish-counter row, **and** it is the row carrying the Drive drain for an
ordinary hit. The most economical reading is that Drive damage does not vary by
counter state, so it is authored once, on the rows that carry the variants —
but that is a reading, and the honest statement is the measurement: the drain is
there, at 96% and 97%, and it is not on conditions 0 and 1.

### Everything a gauge needs is in the dump except one number and one duration

`char_info` gives the super maximum outright (`Gauge: 30000`, all 24 fighters),
the regeneration rates (`FocusRecoverNM` 40 grounded, `NMA` 20 airborne, `IC` 50
in burnout, `ICA` 20), and `RecoverDrvNorm`/`Just` at 10000.

**The Drive maximum is not in the dump.** 60000 — six bars of 10000 — is an
inference from OD costing 20000 and the game calling that two bars, and it has
lived in comments since ADR-0009. `DRIVE_MAX` is the first place it has had to
be a number. It is the second borrowed constant in the runtime after ADR-0030's
stage width, and unlike that one it has no outside measurement behind it, only
internal consistency.

**Burnout's duration is not in the dump either.** The `_tired` twins are there,
the type-47 branches that reach them are there on every ground state, the faster
`IC` regeneration is there — and nothing says how long it lasts or what ends it.
Modelled as: enter at zero Drive, leave when the gauge is full again, which at
50 a frame is 1,200 frames. The regeneration rates' own *period* is undecoded,
so reading them as units-per-frame is a decode and not a measurement.

### A correction to ADR-0026

ADR-0026 describes the burnout walk as "a visibly slower walk (846 units over
181 frames against 531 over 114)". The per-frame deltas say otherwise:
`BAS_FORWARD_Loop` and `BAS_FORWARD_Loop_tired` are **both 4.70 units a frame**,
and backward is −3.20 in both. The tired loop is the same speed over a longer
loop, not a slower one. The totals in that ADR are right; the conclusion drawn
from them is not.

## Decision

Add five gauge checks to `src/verify`, reading the Drive drain from the
punish-counter and driveHit rows and comparing magnitudes.

Give `Fighter` a `drive`, a `superMeter`, a `superMax` from `char_info`, and a
`burnout` flag. Filter every trigger by what the gauges can pay for, deduct on
fire, regenerate each frame at the rate `char_info` states for the situation,
and enter burnout at zero. `Match` applies the hit row's `drive.own`,
`super.own` and `super.target`, and drains the defender by the authored amount.

The viewer draws Drive in its six segments and super in three; the CLI reports
both.

## Consequences

- `sf6 fight ryu ken "2x2,3x2,6+LP+MPx3,5x120" --at 350` throws `SPA_HADO(3)`,
  the OD fireball, and ends `gauges 4.9D/0.0S / 6.0D/0.0S` — two bars spent and
  a little regenerated.
- With one bar in the gauge the same input throws the ordinary Hadoken.
- `sf6 verify` now runs ten checks. The five original ones are unmoved:
  93.2 / 88.7 / 94.2 / 90.1 / 81.8%.
- 178 tests pass.

## Not settled

- **`DRIVE_MAX` is inferred.** Six bars is consistent with every price in the
  dump and stated nowhere in it.
- **Burnout's duration and exit are invented.** "Full again" is a rule this
  project chose. The type-47 branches are still not *taken* — a burnt-out
  fighter here keeps playing the ordinary actions rather than the `_tired`
  twins, so burnout currently costs the moves it prices out and nothing else.
- **`driveGain` is 0/41 on the Drive moves and `superGain` 0/30 on the supers.**
  Both are populations where the dump says zero and FAT publishes a number;
  neither has been chased.
- **The positive `FocusTgt` on the hit and block rows is unmodelled.** It is a
  real number in the dump that this reading has no use for, which usually means
  the reading is incomplete.
- **`combo_sp_gain`, and every per-frame `EventKey` gauge event, are dropped by
  the extractor.** The latter is where Drive Parry's −50 a frame lives, and
  where walking forward's +20 lives. Neither is modelled, so parry cannot yet
  drain and neutral cannot yet build.
- **No Drive Impact, Drive Rush, Drive Reversal or Parry as *states*.** Their
  prices are now enforced and their actions play, but the armor, the rush
  cancel, and the parry window are not modelled.
- **Super Arts do not spend on a freeze-aware clock.** ADR-0019 found the
  cinematic freeze; the gauge does not yet interact with it.
