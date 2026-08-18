# ADR 0025 — What to press, and what a hit does to you

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0002](./0002-data-sourcing.md),
  [ADR-0006](./0006-hit-data.md),
  [ADR-0009](./0009-what-a-cancel-costs.md)

## Context

Everything before this ADR was built to answer frame-data questions. The goal has
changed: a locally playable simulator. So the first question is whether the data
is the blocker, and it is not — a survey of `data/geometry/` found **2,724
actions carrying hitboxes and complete hit data, of which only 990 are joined to
a FAT move**. The unmapped specials are a labelling gap. Every movement, guard,
reaction, knockdown, wakeup, throw and Drive action is already extracted, for all
24 fighters.

What *is* missing is narrower and entirely inside the extractor. Three sources
were being dropped:

- `commands.json` — the motion inputs. `fetch-mmdk.mjs` named it and declined to
  fetch it, correctly: a grader never needs to know what to press.
- `char_info.json` — fetched since ADR-0002 and never read.
- 91 of the 104 fields on every `HIT_DT` row.

## Findings

### The input bitmask is four directions and six buttons, and it reads off the motions

`ok_key_flags` is a bitfield. The low nibble is direction and the next six bits
are buttons:

| bit | 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 |
|---|---|---|---|---|---|---|---|---|---|---|
| | up | down | back | forward | LP | MP | HP | LK | MK | HK |

Nothing states this; it falls out of the sequences. Ryu's command 1 is
`0x2, 0xa, 0x8` and FAT calls the move `236` — down, down-forward, forward. His
command 2 is `0x2, 0x6, 0x4` against a published `214`.

The multi-button masks are plain unions, so **OD needs no flag**: `0x70` is all
three punches and `0x380` all three kicks, `0x90` is LP+LK (throw), `0x120`
MP+MK (Drive Parry) and `0x240` HP+HK (Drive Impact). Every `Extra` trigger on
the roster carries exactly three buttons.

### A command is a list of steps, and the unpinned ones are wildcards

A step with bit 30 set and `rotate.point` non-zero matches **any direction it
does not forbid**. It is how the table writes the parts of a motion that are not
checked: a `236236` is stored as wildcard-`6`-wildcard-`6` (and, in the other
listed variant, `2`-wildcard-`6`-`2`-`6`), and a `66` dash as wildcard-`6`-
wildcard-`6` with back and down forbidden.

A command group holds **several accepted inputs**, which is the game's own input
leniency written down. Ryu's Hadoken accepts `236`, `4236` and `4136`. No
published source states that.

### Graded against FAT's notation: 245/286

Over every exact-mapped special and super whose trigger carries a motion, asking
whether the dump's pinned directions are an ordered subsequence of FAT's
notation: **245 of 286 — 85.7%**.

**Thirty-nine of the forty-one misses are the same move.** The dragon punch is
stored as `626` — forward, down, forward — on all eleven fighters that have one,
at every strength. FAT publishes `623`. Both describe the same input; `623` is
what players are taught and `626` is what the table checks. That is the dump
saying something the published data does not, which is the outcome this project
exists to produce. The remaining two are Guile's LP and OD Sonic Boom, whose
command group holds a two-step `1, 2` that nothing yet explains.

### The charge direction is not in the table, and is inferred from the release

A charge step writes its **slot id** into the low bits and sets bit 16, so the
nibble is not a direction there. Which way the slot is held is stated nowhere,
and the slot ids are per-character (Guile uses 0, 2, 5, 6, 7, 8, 9; Blanka 0 and
1).

But across the six charge fighters the release settles it: **every slot released
into forward is a back charge** (`[4]6`, `[4]646`) and **every slot released into
up is a down charge** (`[2]8`). Fourteen commands, no counterexample. That is an
inference rather than a reading, and `chargeHold()` is named and commented so it
stays visible as one.

### The hit table's other ninety-one columns are the playable half

`hitOutcome()` kept 13 fields. The rest are not decoration:

- `_IsStrength_L/M/H/S`, `DmgKind`, `DmgPart`, `Attr0..3` — **which reaction the
  defender plays.** This is the missing link between "a hit landed" and "the
  defender enters a real state", and the `DMG_*` / `GRD_*` actions it selects are
  already extracted, fifteen of each per fighter.
- `_kabe_bound`, `_kabe_tataki`, `WallDest/Stop/Time` — the corner.
- `_jimen_bound`, `FloorDest/Time`, `BoundDest` — the ground bounce.
- `ComboAdd`, `_no_combo`, `_black_combo`, `DmgRecover`, `PiyoPoint` — combo
  counting, grey damage, and the road to a dizzy.
- `DriveNorm` / `DriveJust` — what blocking and parrying cost the **defender's**
  Drive gauge. `65535` is the table's "no entry" sentinel, not a value.
- `MutekiTime`, `_kezu_*`, `_no_death`, `_chara_forward/_reverse`, `_weak_attack`.

Sound, hit sparks, screen shake and the animation curves stay dropped.

### And a fighter's own constants were on disk the whole time

`char_info.json` gives `Vitality: 10000` (health), `Gauge: 30000` (super), armour
points and timer, body size, and — in `Styles[0].StyleData.Basic` — the Drive
gauge's regeneration rates (`FocusRecoverNM: 40` neutral, `IC: 50` in burnout,
and the airborne pair) plus the offensive, defensive, move-speed and gauge-gain
scales.

**The Drive maximum is still not in the dump.** ADR-0009 inferred 60000 from what
an OD special costs; that inference is now recorded on the type rather than
assumed at each use.

## Decision

Fetch `commands.json`. Decode the input bitmask as `KEY_BITS`, a command as an
ordered step list with wildcards kept as `any`, and a charge as its slot plus an
inferred hold direction. Put the accepted motions and the buttons on the existing
`Trigger` record, beside the buffer and the cost that are already there.

Widen `hitOutcome()` to the reaction, corner, floor, combo, chip and
Drive-damage fields. Add `extractFighter()` and put it on `GeometryFile` as
`fighter`.

Re-admit boxless `NGD_*` actions. Being thrown is a real state a fighter spends
frames in, and it carries no boxes precisely because you cannot be hit while
held — so the "no boxes, drop it" rule was throwing away a state the machine
needs. Nothing else boxless is re-admitted: the rest are round intros and win
poses.

Grade the motions against FAT's notation in `tests/inputs.test.ts`, and pin the
dragon punch's `626` by name so the disagreement is asserted rather than
tolerated.

## Consequences

- `sf6 verify` does not move by one row: 93.2 / 88.7 / 94.2 / 90.1 / 81.8%, the
  same populations. This ADR adds fields and removes nothing.
- Ryu's file grows to 694 KB and carries 52 triggers with motions, health,
  meter, Drive regen, and two `NGD_*` states it did not have.
- 147 tests pass.
- `node scripts/fetch-mmdk.mjs` with no arguments now tops up whatever has
  already been fetched, which is what a re-run after widening `FILES` wants.

## Not settled

- **`ok_key_cond_flags` is undecoded.** It takes a small set of values —
  `0x4020` on a normal, `0x14020` on a special, `0x14060` on an OD, `0x4060` on
  a throw or Drive move — so it plainly encodes something about how the press is
  read (hold vs press vs release, and priority). Nothing here depends on it yet.
- **The charge hold direction is inferred, not read.** If a fighter ever ships a
  charge released into something other than forward or up, the rule gives no
  answer and `chargeHold()` returns null rather than guessing.
- **Guile's LP and OD Sonic Boom** pin `1, 2`, which is not the `[4]6` FAT
  publishes and is not a charge command. Two rows, unexplained.
- **The wildcard's contents are not stated.** A `236236` pins two of its six
  directions and the table never says what the sweep must pass through. An input
  reader has to choose a rule; whatever it chooses is an assumption.
- **`DmgKind` / `DmgPart` / `Attr*` are extracted but not decoded.** They are
  believed to select the reaction action. That decode is self-grading — a wrong
  reading names a `DMG_*` action that does not exist — and has not been run.
- **Branch chasing is still not done.** Sixty neutral-triggered actions carry
  their hitboxes on an action they branch into. ADR-0024 named this too. It is
  deferred to the read side rather than done in `signature()`, because widening
  the signature is what put a super handoff on Juri's 5MP in ADR-0022.
- **Stage width and the damage-scaling ladder are in neither dump.** Both will
  have to be calibrated from observation and labelled as assumptions.
