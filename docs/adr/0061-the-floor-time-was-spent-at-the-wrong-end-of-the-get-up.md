# ADR 0061 — The floor time was spent at the wrong end of the get-up

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0033](./0033-dmgtype-is-the-knockdown-and-the-floor-time-is-not-recoverable.md),
  [ADR-0041](./0041-getting-up-getting-out-and-the-damage-that-was-not-read.md),
  [ADR-0046](./0046-the-shared-rect-tables-and-the-box-a-downed-fighter-has.md)

## Context

ADR-0033 wired the knockdown chain by name and closed with two things it could
not do: reproduce FAT's `KD +N`, and give a downed fighter a pushbox. ADR-0046
found the pushbox — shared list 5, `BoxNo` 6 — and closed with *"nothing consumes
it… the runtime still treats a knockdown as a timer."*

It is no longer only a timer: `separate()` reads whatever `pushboxesAt` returns,
so the downed box now decides how close the attacker may stand. That made it
worth asking what a floored fighter actually carries, frame by frame, rather
than trusting that the total came out right. The total *was* right. Everything
inside it was not.

## Findings

### `BAS_DN_STD_AO` is the get-up, not the lie-down

The action is identical on all 24 fighters. Read off the extracted keys:

| | frames | `MarginFrame` | hurt key | push keys |
|---|---|---|---|---|
| `BAS_DN_STD_AO` / `_UT` | 42 | 30 | **31 – 42** | 1–15, 16–42 |
| `BAS_TECH_FN_AO` / `_UT` | 50 | 30 | 31 – 50 | 1–9, 10–50 |
| `BAS_TECH_BR_AO` / `_UT` | 44 | 30 | 31 – 44 | 1–9, 10–44 |
| `DMG_HH_DN` and family | 45 | 22 | 1 – 45 | 1 – 45 |

The three columns agree with each other and say one thing. The first push key is
the shared `BoxNo` 6 — ±35, `y −117..13`; the second is the fighter's own
standing box (±33 on Ryu). There is **no hurtbox until frame 31**, and 31 is
`MarginFrame + 1`, the frame the fighter becomes actionable. So frames 1–15 are
lying down, 16–30 are rising, and the fighter becomes hittable on exactly the
frame they become free. The action holds no still portion for lying *longer*: its
length is fixed, and `DownTime` is not in it.

(Lily carries a second hurt key on the same action starting at frame **30**
rather than 31, on 19 of her rows. It is the dump's, one frame early, and it is
the only fighter that does it.)

### The `DownTime` was being added after that, not before it

The runtime entered the down action and set `stun = DownTime + 30`, letting the
frame counter run continuously. So the get-up played *first* and the floor time
was spent standing at the end of it. Three consequences, all measured by driving
`Fighter` through `react` for every distinct `(fighter, DownTime)` pair a
knockdown row states — 364 of them:

| | before | after |
|---|---|---|
| frames down with **no hurtbox and no pushbox at all** | **3,659** | 0 |
| worst single knockdown | 97 (Luke, `DownTime` 109) | 0 |
| frames down, still stunned, carrying a **standing hurtbox** | **3,306** | 19 |
| knockdowns that never entered `BAS_DN_STD_AO` at all | 17 | 0 |
| defender-busy frames after the reaction, min / max | 20 / 159 | 50 / 159 |

The 19 that remain are Lily's one-frame-early key, above. The maximum is
unmoved, which is the point: **the length of a knockdown does not change here.**

The box-less frames are the overrun. The last frame the action authors is 42 and
the clock reached `DownTime + 31`, so every row stating a `DownTime` over 11 ran
off the end — **1,714 of the roster's 5,570 knockdown rows, 30.8%**, median
`DownTime` 10, maximum 109. Past frame 42 nothing covers, so `hurtboxesAt` and
`pushboxesAt` both return empty: no hurtbox, no pushbox, no figure, and
`worldPush` returning `undefined` means `separate()` and `wall()` give up
entirely for those frames. The same overrun is available one step earlier —
`HitStun` exceeds the `DMG_*_DN` action's 45 frames on **365 rows**.

The standing-hurtbox frames are the reversal. In a match: Ryu sweeps Ken
(`DownTime` 15), then sweeps again 50 frames later. Before, the second sweep
**connected on frame 60** — against a Ken who was `down`, still stunned, and 15
frames from being able to do anything. After, it whiffs, and the first press
that connects is at +78, three frames after Ken is up.

### `DownTime` 0 skipped the floor entirely, and those are the hard ones

The chain was gated on `DownTime > 0`. `DownTime == 0` is half of
`hardKnockdown` (ADR-0033) — so the knockdowns that cannot be quick-risen were
the ones that produced no down state at all: reaction ends, straight to idle, no
get-up, no downed pushbox, actionable on the spot.

**192 rows** state it, of which 186 are not the 0-damage/10-stun catch row a
throw uses. **205 hit keys point at one, over 24 distinct actions** — mostly
Super and Critical Art finishers (`SAA_*`, `CAA_*`), and one ordinary special,
Cammy's `SPA_SPIRALARROW_END`.

The reaction itself is a better gate than the number, and it is the dump's:
`reactionFor` names a `_DN` action only when the row knocks down, and
`DMG_CH_DN`, `DMG_CM_DN`, `DMG_HH_DN`, `DMG_HM_DN` are the **only four actions on
the entire roster** whose name ends `_DN`.

### What the downed pushbox's vertical placement is still not

ADR-0046 recorded `y −117..13` as read rather than explained, and it stays that
way. One reading was tested and fails: if the box were sunk below the stage so
that two fighters stop pushing each other while one is down — which is what SF6
lets you do — it would sit entirely under the ground plane. It does not; it pokes
**13 units above** it, and would still overlap a standing box's `0..130`. Of the
roster's 12,142 push keys only 45 lie wholly below ground and every one of them
belongs to a projectile. Nothing here reads a pushbox's `y`, and this ADR does
not start.

## Decision

`Fighter` gains `pinned`: frames the animation stands still for before its own
clock moves on. The floor time is spent there — held on frame 1 of
`BAS_DN_STD_AO`, lying, with no hurtbox and the shared downed pushbox — and the
30-frame get-up runs after it, reaching `MarginFrame + 1` on the frame the
fighter is free. A quick rise pins nothing, which is still exactly the
`DownTime` saved.

While stunned, the frame counter **stops at the action's last authored frame**
instead of running past it. That is the reading `flightOrigin` already takes for
a projectile that outlives its own action: the animation is the authored part,
and past it the last frame holds.

The chain continues onto the floor when the reaction **is** a `_DN` one, not when
`DownTime > 0`.

## Consequences

- A downed fighter has the boxes the dump gives them on every frame of the floor
  and the wake-up, and no others. Ryu's 2HK leaves Ken on the shared downed
  pushbox for **30 frames** (`DownTime` 15 pinned, then frames 1–15 of the
  get-up) where it was 15 regardless of the `DownTime`.
- A fighter on the floor can no longer be hit, and `actionable()` is false for
  every frame of it. `__NoHitWhileDown` — ADR-0033's unread flag — is now what
  the empty hurtbox already meant, without a flag being read.
- 17 fighters' hardest knockdowns gain a 30-frame get-up they did not have.
- **Nothing graded moves.** `sf6 verify` is unchanged — `knockdown 511/554
  92.2%`, `hardKnockdown 203/213 95.3%`, and the original five at 95.1 / 90.4 /
  93.7 / 90.3 / 87.5%. Neither `src/sim` nor `src/verify` imports `src/game` at
  all, and the total length of a knockdown is the same number it was.
- `npm run pose:audit` is unchanged in every category: axis-pop 497, reach-overlong
  340, spine-squashed 114, limb-overlong 103, head-detached 71, spine-inverted 60,
  foot-above-hips 60, legs-stretched 0.
- One test added, pinning that no frame of a knockdown is box-less, that no frame
  of it is vulnerable or actionable, and that the downed pushbox lasts as long as
  the floor does. **267 pass.**
- `src/game/render.ts` is untouched, so no rebuild of `web/play.js` is needed.

## Not settled

- **`KD +N` is still not reconstructible**, for ADR-0041's reason — the missing
  term is an airborne arc with no stated gravity. This ADR moves frames around
  inside a total it does not change, so it neither helps nor hurts that.
- **The downed pushbox's `y` is still unexplained**, and still unread. Any answer
  needs `separate()` to test the vertical, which would change how every airborne
  fighter pushes as well; that is a separate decision and this is not it.
- **The `BAS_TECH_*` quick-rises are still never entered.** They are the better
  animation for a quick rise — the downed pushbox releases on frame 9 instead of
  15 — but which is which cannot be read off the names: `FN` travels **−119.88**
  over 50 frames and `BR` travels **−120.00** over 44, so both roll the same way
  and the pair is not forward/back in the fighter's own space.
- **The floor time is invulnerable and the quick rise is one frame wide.**
  `holdingDown` is tested on the single frame the reaction ends, and the
  quick-rise input is still asserted (ADR-0041) and still only down.
- **`flags.fullInvuln` is set on all six down and tech actions and unread.** The
  absent hurtbox does the same work over frames 1–30; what the flag would add is
  an answer for frames 31–42, where the dump gives a hurtbox *and* claims full
  invulnerability. Nothing in the chain reaches those frames now.
- **The figure is not part of this.** With no hurtbox for the whole floor time
  there is nothing for `poseOf` to derive a body from, so it holds the last pose
  it had — a fighter standing up while lying down. That is ADR-0059's hold-over
  rule working as written, and it is the next thing to look at.
