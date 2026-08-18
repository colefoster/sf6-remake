# ADR 0034 — A throw is a range check, and its damage is somewhere else

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0020](./0020-full-invulnerability-is-the-absence-of-a-hurtbox.md),
  [ADR-0030](./0030-the-stage-is-borrowed-and-the-corner-is-derived.md),
  [ADR-0033](./0033-dmgtype-is-the-knockdown-and-the-floor-time-is-not-recoverable.md)

## Context

`match.ts` has listed "throws as a state" under WHAT IT DOES NOT since ADR-0027.
That undersold it: throws were not merely absent, they were **wrong**. A
throw-kind hit key went through the same path as a strike, so it connected
against head/body/leg boxes, could be blocked by holding back, and worked on a
jumping opponent.

## Findings

### The two boxes are built never to touch

Every fighter's throw hitbox spans **y 0 to 130**. Every fighter's throwable
hurtbox sits at **y 132 to 166** — two units above it. On all 24 characters.

That gap is not an accident, and it means a throw is not an intersection test.
It is a **range check**: the throw's x-extent against the throwable box's
x-extent, with y playing no part. Ryu's throw box reaches 80 units and Ken's
throwable box extends 30 toward him, so the throw connects up to 110 units of
origin separation and not one unit further — which is what the runtime now does.

This also explains why FAT publishes the two as separate per-character stats
rather than one range: they are the two halves that have to meet.

### FAT's throw stats are the dump's boxes, times one hundred, exactly

`throwRange` is `0.8` for Ryu and the dump's throw box reaches `80`. Across the
whole roster:

| | |
|---|---|
| `throwRange × 100` == throw box reach | **24/24, 100%** |
| `throwHurt × 100` == throwable box + 3 | 20/24, 83% |

The first is exact on every fighter, including the ones that do not call the
action `NGS` — Guile splits his into `NGS_6`/`NGS_4` and Zangief his into
`NGS_L`/`NGS_R`.

This matters beyond throws. **It is a second, independent confirmation of the
ruler.** ADR-0030 borrowed the stage width from an outside measurement on the
strength of walk speeds and dash distances agreeing with the dump; this says the
same unit system holds for a quantity FAT states in metres, at a clean factor of
100. The two checks share no columns.

The three-unit offset on `throwHurt` is a convention of FAT's rather than a
mechanic, and is recorded as a named constant on the same terms as ADR-0023's
eight-frame projectile contact.

### The catch does no damage, and the damage row is unreachable

A throw is two stages. `NGS` is the **catch**: eight frames of throw hitbox
(frames 5–12), pointing at a hit-data row that does **0 damage** and 10 stun. It
then branches — type 36, at frame 5 — into `NGA_6` or `NGA_4`, the 121-frame
animation that carries the opponent.

`NGA_6` has **no hit keys at all**. So neither the catch nor the follow-through
carries the throw's damage.

It is in the table, in rows referenced by no `AttackCollisionKey` anywhere. Ryu
has seven such orphan rows and two of them are his throws: rows 116 and 118,
both **1200 damage**, `DmgType` 13, matching FAT's published `1200(2040)` for
Shoulder Throw and Somersault Throw.

What could not be found is the *link*. For Ryu the two rows sit at the catch row
+1 and +3; applied across the roster that positional rule holds on only **6 of
15**. The rows are reliably orphans and reliably carry the right damage; nothing
found says which orphan belongs to which throw, so the runtime cannot pick one.
A thrown opponent therefore takes the catch — stun, knockdown and all — and no
damage.

## Decision

Resolve a throw-kind hit key against the defender's **throwable** boxes only,
horizontally, and only while they are grounded. Skip the guard check entirely,
so a throw cannot be blocked.

Add `src/verify/throws.ts`, a per-character report in the shape of `verifyArmor`,
since a throw is not in the move mapping and the per-move `CHECKS` loop has
nowhere to hang it.

## Consequences

- Ryu's LP+LK throws Ken at 105 units and whiffs at 110, cannot be blocked, and
  misses him in the air.
- `sf6 verify` reports the throw geometry: range 24/24, throwable 20/24.
- 193 tests pass. The sixteen move checks are unmoved.

## Not settled

- **Throws do no damage.** The rows exist and are correct; which one belongs to
  which throw is the open question. This is the same shape as ADR-0029's Ken
  Hadoken: the data is there and the link is not.
- **The follow-through is not played.** The catch's type-36 branch into `NGA_6`
  is read by nothing, so the thrower does not play the throw animation and the
  121 frames it occupies are not spent.
- **No throw tech.** `_no_esc` is extracted as `noEscape` and unread, and nothing
  found in the dump states a tech window or a tech action.
- **Throw invulnerability is unread.** `flags.throwInvuln` exists on actions and
  the runtime never consults it; an action with no throwable box at all would be
  throw-invulnerable by absence, the shape ADR-0020 found, and that is untested.
- **Command grabs are untouched.** Zangief's `SPA_*` grabs carry throw-kind keys
  and reach 634 units; they go through the same new path with none of the rules
  a command grab actually has.
