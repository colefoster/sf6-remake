# ADR 0035 — The throwable box was the head box

- Status: accepted
- Date: 2026-08-18
- Corrects: [ADR-0034](./0034-a-throw-is-a-range-check-and-its-damage-is-somewhere-else.md)

## Context

ADR-0034 made two claims about throws, hours old at the time of writing this.
Both were wrong, and both were wrong for the same reason: an extraction bug that
had been in `scripts/extract-geometry.mjs` since ADR-0004 and that nothing read
until throws were modelled.

## Findings

### `ThrowList` never resolved against the hurtbox table

`DamageCollisionKey` carries `HeadList`, `BodyList`, `LegList` and `ThrowList`
side by side, and the extractor resolved all four against `rects[8]`, the
hurtbox table. Three of those are right. The fourth is not, and the dump says so
plainly:

- the hurt table's ids are **100 and up**;
- `ThrowList`'s values are **1, 2, 3, 10, 34** — the *pushbox* namespace;
- the key names its own table anyway: `_RectHurtId: 31`, `_RectHurtThrowId: 30`.

Read against `rects[8]`, `ThrowList: 1` silently returned `rects[8][001]` — the
**head box**, at y 132 to 166. Read against `rects[7]`, the pushbox base table,
it returns x −33…33, **y 0 to 130**.

Two things follow immediately.

**ADR-0034's central claim collapses.** It observed that the throw hitbox spans
y 0–130 while the throwable box sits at y 132–166, concluded the two were "built
never to intersect", and inferred that a throw must therefore be a horizontal
range check. The gap was an artifact. Correctly resolved, the throwable box
spans exactly the same y range as the throw hitbox, and a throw is an ordinary
box overlap like everything else. The range check has been reverted.

**The three-unit fudge disappears.** ADR-0034 introduced
`THROW_HURT_OFFSET = 3` to make FAT's `throwHurt` agree with the extracted box
on 20 of 24 fighters, and dressed it as "a convention of FAT's". It was the head
box being 30 wide where the throwable box is 33. With the right table and **no
offset**, agreement is **23 of 24** — only Zangief disagrees, 43 against a
published 49.

The base table alone is the reading, not the override-then-base pair the pushbox
itself uses: base-only scores 23/24, override-first 19/24.

### The throw damage link is a `LockKey`

ADR-0034 found the damage rows — Ryu's 116 and 118, 1200 each — established that
no `AttackCollisionKey` anywhere references them, failed to find a rule linking
throw to row (a positional guess held on 6 of 15), and concluded a thrown
opponent would take no damage.

The link is a key type the extractor never read. `NGA_6`'s `LockKey` carries an
entry flagged `_IsAttackDataHash02`, named `"Hit No"`, whose **`Param02` is the
`AttackDataListIndex`**:

| action | lock frame | row | damage |
|---|---|---|---|
| `NGA_6` (forward) | 55 | 116 | 1200 |
| `NGA_4` (back) | 55 | 118 | 1200 |
| `NGA_6(1)` (punish counter) | 55 | 117 | 2040 |

That is why those rows read as orphans: they are addressed by a mechanism
nothing in this project had looked at. The `(1)` variants being punish-counter
throws is confirmed by FAT's own note — 1200 × 1.7 = 2040, hard knockdown, one
bar of Drive off the defender.

### So a throw is two actions and a lock

`NGS` catches for 0 damage and 10 stun, then takes a **type-36 branch**
(`CATCH`) into `NGA_6` or `NGA_4`. The defender is put into the paired action,
which is the thrower's id **plus one** (`NGA_6` 720 → `NGD_6` 721) — the dump's
own naming convention. The damage arrives when the thrower reaches the lock
frame. Played out: Ryu throws on frame 1, both enter the animation on frame 4,
1200 lands on frame 58, Ken is on the floor by 77 and up at 112.

## Decision

Resolve `ThrowList` against `rects[7]`. Revert the horizontal range check to an
ordinary box overlap. Set `THROW_HURT_OFFSET` to zero.

Extract `LockKey` entries flagged `_IsAttackDataHash02` as `action.locks`, and
resolve them each frame in the match. Take the catch branch on a connecting
throw, choosing the `(1)` variant on a punish counter, and put the defender into
the paired action.

## Consequences

- Ryu's throw does its published 1200, off a row no hitbox names.
- `throwable` goes from 20/24 with a fudge factor to **23/24 with none**.
- 194 tests pass. The sixteen move checks are unmoved.

## Not settled

- **Zangief's throwable box.** 43 against a published 49, the only miss.
- **The bug's blast radius is unmeasured.** `ThrowList` had been resolving to
  head boxes since ADR-0004 for every action on every fighter. Nothing read the
  field until now, so nothing was wrong downstream — but no check confirms that.
- **Throw tech is still not modelled**, though the dump has more than ADR-0034
  credited: `NGE` and `NGF` are dedicated 43-frame escape actions on all 24
  fighters, fully invulnerable, and nothing in the character dump routes into
  them. `NGD_6`/`NGD_4` each carry one unbuffered `TriggerKey` on **frames 1–5**,
  which is the only tech-window candidate in the data.
- **`_no_esc` is not throw escape.** ADR-0031 guessed it might be; it sits on
  Super Art cinematic connect rows and no throw row carries it.
- **The thrower is invulnerable during the animation and the runtime ignores it.**
  Every `NGA_*`/`NGD_*` is `_IsMutekiAll`.
- **Air throws and command grabs** go through the same path with none of their
  own rules.
