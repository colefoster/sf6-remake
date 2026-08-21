# ADR 0066 — The knockdown was a standing man, and the fall is not in the dump

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0046](./0046-the-shared-rect-tables-and-the-box-a-downed-fighter-has.md),
  [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0057](./0057-the-hit-has-to-be-visible.md),
  [ADR-0058](./0058-the-limbs-were-furniture.md),
  [ADR-0061](./0061-the-floor-time-was-spent-at-the-wrong-end-of-the-get-up.md),
  [ADR-0063](./0063-the-jump-was-a-standing-figure-on-an-elevator.md),
  [ADR-0065](./0065-the-arms-were-following-a-switch-and-the-legs-were-following-the-boxes.md)

## Context

Reported: *"when I sweep, I don't see the enemy figure get knocked down."*

The state machine is not the fault. ADR-0061 fixed it the same day and
`tests/match.test.ts` pins it: Ryu's 2HK into Ken plays `1060_DMG_HH_DN`, spends
the row's `DownTime` of 15 held on frame 1 of `BAS_DN_STD_AO`, runs that
action's 30 frames of recovery and hands control back on frame 31. Every frame of
the floor has the boxes the dump gives it.

The **figure** never changed. Driving that match and posing the defender every
frame, before this ADR:

```
f 1  BAS_STD_Loop      down=false  | neck=138 hips=88 head=(60,149) feet=(86,0)(34,0)
f 8  1060_DMG_HH_DN    down=false  | neck=138 hips=85 head=(60,149) feet=(88,0)(32,0)
f38  BAS_DN_STD_AO     down=true   | neck=138 hips=85 head=(60,149) feet=(88,0)(32,0)
f68  BAS_DN_STD_AO     down=true   | neck=138 hips=85 head=(60,149) feet=(88,0)(32,0)
```

Thirty frames on the floor with the skull at 149. This is exactly what ADR-0061's
*Not settled* predicted: *"with no hurtbox for the whole floor time, `poseOf`
holds the last pose — a fighter standing up while lying down."*

## Findings

The brief for this work made three claims. **Two hold and one does not**, and the
one that does not is the one the whole design was going to hang on.

### 1. The `_DN` reaction is static, and it is the standing body — holds

Every fighter carries four `*_DN` reactions: `1050_DMG_HM_DN`,
`1060_DMG_HH_DN` (standing) and `1070_DMG_CM_DN`, `1080_DMG_CH_DN` (crouching).
96 actions, 4,322 frames.

| | count |
|---|---|
| `*_DN` actions on the roster | 96 |
| frames in them | 4,322 |
| that hold one pushbox and one hurtbox layout for their whole duration | **94 / 96** |
| that carry a `motion` arc | **0** |
| `DMG_*` actions of any kind carrying a `motion` arc | 5 of 771, all Ed's |

The two exceptions are Juri's `1050`/`1060`, which are 46 frames long with boxes
authored for 45; frame 46 has none. There is no frame anywhere in a knockdown
reaction where the geometry differs from the frame before it.

And the layout is the *standing* one, near enough to say so:

| reaction | fighters | difference from the fighter's own idle stack |
|---|---|---|
| `1070_DMG_CM_DN`, `1080_DMG_CH_DN` | 24 | **none** — byte-identical to `BAS_CRH_Loop` |
| `1050_DMG_HM_DN`, `1060_DMG_HH_DN` | 4 | **none** — byte-identical to `BAS_STD_Loop` |
| " | 18 | head box `132..166` → `138..166`, 6 units |
| " | 2 | that, and body `54..146` → `54..138` |

The pushbox is the fighter's own standing rect on `HM`/`HH` and the crouching one
on `CM`/`CH`. (The brief quoted the standing head box as `138..166`; it is
`132..166`. The point it was making survives the correction.)

**So there is nothing in a knockdown reaction to derive a fall from.** This is
the same finding ADR-0057 and ADR-0058 made about the recoil, on the same 646
actions.

### 2. `BAS_DN_STD_AO` frames 1–15 are *not* the only downed frames — does not hold

The brief said the downed pushbox appears in one window on one action. Sweeping
every push rect of every non-projectile action on the roster against the rule
below finds **2,452 frames over 24 action names**:

| action | frames | fighters | window |
|---|---|---|---|
| `BAS_DN_AO_Loop` | 400 | 4 | 1–100 of 100 |
| `BAS_DN_STD_AO` | 375 | 24 | 1–15 of 42 |
| `BAS_DN_STD_UT` | 360 | 24 | 1–15 of 42 |
| `BAS_TECH_FN_AO` / `FN_UT` / `BR_AO` / `BR_UT` | 216 each | 24 | 1–9 |
| `BAS_DN_UT_Loop` | 170 | 2 | 1–85 of 85 |
| `1200_BAS_DN_STUN_UT` | 60 | 1 (Ed) | **160–219** of 219 |
| `1220_DMG_BND_H_AO`, `DMG_BND_L_*`, `1150_DMG_KUZURE_STD`, `1160_DMG_KUZURE_AO`, `1210_DMG_Slide_Ground`, `1250_DMG_Slam_STD`, `3180_DMG_GORO_NOHIT_UT`, `3210_GRD_CRUSH_ZUSA` | 1–37 each | 1 (Ed) | various |

Three of those windows **do not start at frame 1** — Ed's stun stands for 159
frames and then falls over — and building the rule on the brief's premise put
those fighters on the floor from the first frame of the action. The new
`prone-above-box` audit category caught it: 65 frames, all Ed's. `Grounded.from`
exists because of it.

The four quick-rises are the other correction. They are get-ups too, and they
were going to be missed.

### 3. The floor time is held on frame 1 of the get-up — holds

`Fighter.advance`'s knockdown branch enters `BAS_DN_STD_AO`, sets `pinned` to
the `DownTime` and `stun` to `pinned + MarginFrame`. It is uniform across the
roster to the frame:

| | all 24 fighters |
|---|---|
| `BAS_DN_STD_AO` length | 42 |
| `MarginFrame` | 30 |
| downed pushbox | frames 1–15 |
| standing pushbox | frames 16–42 |
| **hurtbox** | frames 31–42 |

So the visible knockdown is: the reaction, then `DownTime` frames held on get-up
frame 1, then frames 1–15 on the downed box, then 15 frames with a standing
pushbox and no hurtbox at all, then control back.

### What the downed box actually says

`BoxNo 6`, ADR-0046's shared rect. Four variants across the roster:

| rect | fighters | above the floor | below it |
|---|---|---|---|
| `-35,-117,70,130` | 20 | **13** | 117 |
| `-35,-119,80,134` | Blanka, E.Honda | **15** | 119 |
| `-40,-119,80,134` | Marisa | **15** | 119 |
| `-35,-119,86,134` | Zangief | **15** | 119 |

Against a standing box that leaves 130 above the floor. That 13 is the **only**
derived statement about a downed fighter's shape in the whole dump.

It is not a statement about width. The downed rect is 70 wide where Ryu's
standing rect is 66 — four units — while a fighter lying down is a stature long.
The width is not read.

Two terms are needed to isolate it, and the split is wide:

| | downed rects | everything else |
|---|---|---|
| above the floor | 13–15 | ≥ 16 |
| below the floor | 117–119 | ≤ 76 |

A rule on the above-floor term alone catches A.K.I.'s `SPA_Kyosyutotu`, which
leaves 16 units above the floor but hangs only 40–64 below it, and Dee Jay's
`ATK_4HK`, a 4×14 rect that hangs nothing below the floor at all. The
below-floor term alone is very nearly enough — the deepest non-downed rect on the
roster is Lily's `SAA_THUNDERBIRD` at 76 — but that box is 358 tall and reaches
282 *above* the floor, which is a wall and not a body. Both terms, as fractions
of the fighter's own idle stack (0.15 above, 0.5 below), put the threshold 19
units clear of the nearest thing it must exclude and 34 clear of the nearest
thing it must catch.

## Decision

**Three phases, and only one of them is derived.**

### The fall — not drawn, and this is the finding, not a shortcut

The brief asked for a topple across the `*_DN` reaction: invention with real
timing, the way ADR-0058 invented the recoil.

**It cannot be done honestly, and the reason is the reaction's own hurtboxes.**
They are live on every one of its 45 frames, and they are the standing stack: on
Ken, head `138..166`, body `54..138`, leg `0..54`, with the standing pushbox
under them. A figure toppled through that draws a skull at 40 while the only box
that can be hit in the head sits at 138 — which is precisely the error ADR-0063
found in the airborne figure and fixed by *moving the head back inside the box*.
Doing it deliberately here would be reintroducing it.

The recoil is the precedent and it is also the boundary. ADR-0058's lean rotates
the spine about the hips by at most 0.36 rad and keeps every joint inside the
fighter's own hurtboxes; it is drawn on top of `poseOf` at render time and moves
nothing derived. A fall is not a lean. It is the whole body leaving the boxes.

So the reaction is still drawn standing, with ADR-0058's recoil on top of it,
and the figure goes down on the frame the game's own pushbox goes down. **The cut
is the dump's.** It is not soft and it is not meant to be: ADR-0065 already
established that a new action is a cut and the game cuts too.

### The floor — derived bound, invented arrangement

`prone` is 1 while the downed pushbox is live. The figure is the upright figure
given a quarter turn about its own hips, flattened towards the floor plane and
clamped into the slab the box allows:

```
(dx, dy) → ( axis − facing·dy ,  clamp(top/2 + facing·dx·0.35, 0, top) )
```

- **Derived**: `top`, the box's above-floor extent, and the clamp to it. Nothing
  is drawn outside the volume the game gave.
- **Invented**: the quarter turn, the 0.35 flattening, the trailing knee bent to
  0.82, and the direction. The head goes to the end away from the opponent
  because the roster's only get-up is `BAS_DN_STD_AO` and `AO` is face up — the
  fighter went over backwards.

Turning the pose rather than composing a new one is what keeps the fighter's own
build in it: a long-legged figure lies long-legged, and the `build.leg` and
`build.stature` of ADR-0059 and ADR-0060 carry through unchanged.

**The skull is the one thing that leaves the box**, stated plainly. It is a
circle of the fighter's own head radius — 17 on Ryu against a 13-unit slab — so a
head whose *centre* obeys the bound still draws above it. A pushbox is not a
hurtbox, and on these frames the fighter has no hurtbox at all: nothing in the
game can reach any part of them, drawn high or drawn low. Squashing the skull to
fit would be shrinking a head to satisfy a collision volume.

### The rise — invented shape, the dump's clock

The pushbox steps back to the standing rect on frame 16 in a single frame, which
no body does, and the fighter is not actionable until `MarginFrame + 1`. So
`prone` ramps linearly from 1 at frame 15 to 0 at frame 30 — **fifteen frames on
every fighter**, both ends read off the action. Linear because nothing in the
dump says it is anything else, and a curve would be a second invention stacked on
the first.

### `Pose.upright`, so the hold does not compound

`BAS_DN_STD_AO` has no hurtbox before frame 31, so all thirty frames before it
are held over from the last frame that had one (ADR-0050). Held over from the
*drawn* pose the body folds flat again — `spine` reads 0 and `held` reads 6 —
and the figure sank another 130 units every frame. `Pose.upright` carries the
neck and hips from before the lay-down and the hold reads that. Same rule as
ADR-0063's: **the invention is not allowed to feed itself.**

### `pose:audit` grades a prone fighter by prone predicates

Every predicate in `pose-audit.ts` encodes standing. `spine-inverted` fires when
the neck is not above the hips; `foot-above-hips` when a planted foot is above
the pelvis; `head-detached` when the skull is not one radius over the neck. **A
prone fighter breaks all three by being prone.** Graded as standing, drawing the
knockdown correctly takes the audit from 1,233 to 7,336:

| category | before | as standing | growth |
|---|---|---|---|
| `head-detached` | 71 | 1,927 | +1,856 |
| `foot-above-hips` | 60 | 1,771 | +1,711 |
| `spine-inverted` | 60 | 1,674 | +1,614 |
| `spine-squashed` | 114 | 1,036 | +922 |
| | **1,233** | **7,336** | **+6,103** over 150 actions |

Of the two options the brief allowed, this takes the first: **exempt genuinely
downed frames by a stated rule and publish the count.** The rule is *a frame
whose live pushbox is the downed rect is graded by the prone predicates instead
of the standing ones, and a frame on the way back up is graded by neither*, and
the counts are printed under the table on every run:

```
-- on the floor: 1614 frames over 146 actions graded prone instead of standing,
   2620 more on the way up graded by neither.
```

Teaching the existing predicates a body-relative "up" was the other option and
was rejected: it changes what `spine-stretched` and `spine-squashed` measure on
every one of the 456,993 frames walked, which moves the baseline the grader is
being read against in the same commit that changes the figure.

The prone predicates are not weaker. `prone-above-box` bounds every joint by the
pushbox, `prone-underfloor` by the floor, `prone-folded` requires the body to be
laid out to 0.6 of its own height, and **`prone-standing` is this ADR's own
regression** — a figure that draws a standing man through the knockdown fails it
on every frame. All four are at **0**.

## Consequences

- **`pose:motion` is unchanged: 577, every category to the frame.** `stance-snap`
  208, `limb-jerk` 171, `stand-snap` 155, `fade-snap` 38, `limb-teleport` 5. The
  rise moves the neck about 9 units a frame against a bound of 45, and the ramp
  is linear so the second difference is 0. The cut into prone is an action
  boundary and `pose:motion` does not compare across one.

- **`pose:audit` is unchanged: 1,233, every category to the frame**, plus four
  new prone categories at 0, plus the exemption line.

- **Not one derived point moved, anywhere on the roster.** Every derived limb
  root, joint and tip over the same walk the audits make — **51,462 frames carry
  one** — is byte-identical before and after
  (`sha256 f58245bb28db656e812dc075f452dd7461d4e3bb7b4758531c5f5ebc3b8cf16e` over
  the dump in `.scratch/knockdown/derived.ts`). It is not a coincidence and it is
  not luck: **no frame carrying the downed pushbox carries an extended-limb
  hurtbox** — they carry no hurtbox at all — so the guard in `laid` that refuses
  to move a `derived` limb never has to fire. A test asserts it over the 2,452
  downed frames so it stays true.

  The brief named a hash of 68,743 points. That number could not be reproduced
  under any definition tried here — it is prime, so it is not triples of
  root/joint/tip — so the check above is a different one with the same intent,
  and it is stated so it can be re-run.

- **`Pose` gains `prone` and `upright`.** `prone` is read by `web/play.html` too,
  which now skips ADR-0058's recoil on a downed figure: `recoiled` pivots the
  spine about the hips, and a prone figure pivoted that way lifts its head out of
  the box. A light knockdown can put a fighter down while the recoil is still
  running.

- **`grounded` and `proneAt` are exported** so `pose-audit.ts` reads the same
  rule the figure does rather than reproducing it. `pose-audit` also adds the
  action's own `origin.y` to the slab, because `BAS_TECH_FN_UT` rolls and lifts
  20 units and `poseOf` places the figure in world space.

- **Eight tests added**, seven in `tests/geometry.test.ts` and the end-to-end one
  in `tests/match.test.ts` — Ryu sweeps Ken and the defender's head is measured
  on the floor for 30 frames and back at its exact starting height afterwards.
  **292 pass**, up from 284.

- `web/play.js` rebuilt (`node scripts/build-play.mjs`).

## Not settled

- **The fall is a cut and it will read as one.** Standing on one frame, flat on
  the next. That is what the boxes say and this ADR declines to invent otherwise,
  but it is a visual result nobody has looked at yet and it may not be good
  enough. The honest lever that remains is the *attitude*: `attitudeOf` gives
  every `DMG_` action one set of hand offsets, and a `_DN` reaction could have
  its own — arms flung further back and up than an ordinary flinch. That moves
  only invented arm tips and no derived point, and it was left out of this
  change to keep the diff confined to frames where the boxes actually changed.

- **The floor time is `DownTime` frames of a completely static figure.** `pinned`
  holds get-up frame 1, so 15 frames on Ryu's sweep draw the identical pose.
  Nothing in the dump varies across them — the pushbox is one entry for frames
  1–15 — so any breathing there would be invention keyed to nothing.

- **`BAS_DN_STD_UT` is never entered.** The state machine names `_AO` outright
  (ADR-0061), so the face-*down* get-up exists in the dump, is drawn correctly by
  `poseOf`, and no match reaches it. If a bound or a wall-splat ever routes
  there, the figure will still be laid out face up, because `AO`/`UT` is a name
  and nothing in the geometry distinguishes them: **both carry the identical
  `BoxNo 6`.**

- **`BAS_DN_AO_Loop` and `BAS_DN_UT_Loop` have no `MarginFrame`** (−1) and are
  100 and 85 frames of unbroken downed pushbox on six fighters. They draw prone
  throughout and never rise, which is right for a loop, but nothing in this
  project enters them either.

- **The trailing-knee bend and the 0.35 flattening are two more invented
  constants** in a figure that already has a dozen. They exist because a pure
  quarter turn maps both resting feet — which sit at the same height upright — to
  the same point, and the legs come out as one line. There is no reading of the
  dump behind either number.

- **Ed's eight one-fighter downed actions are drawn prone and never played.**
  `1220_DMG_BND_H_AO`, `1150_DMG_KUZURE_STD` and the rest are his Psycho-Mine
  bounds; they are covered by the rule for free, and the `from` frame exists
  because of them, but nothing verifies they look right.
