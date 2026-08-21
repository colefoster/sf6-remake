# ADR 0067 — The pose can be authored, provided the clock stays the dump's

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0053](./0053-one-renderer-two-cameras.md),
  [ADR-0055](./0055-a-blocked-move-hands-over-to-its-twin.md),
  [ADR-0056](./0056-the-twin-does-not-always-share-the-clock.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md)

## Context

ADRs 0049 through 0065 derive the figure from the collision boxes and grade it
with `pose:audit` and `pose:motion`. That is the right source for *what is
hittable* and it is measurably the wrong one for *what the move looks like*:
902 of 1,311 attacks carry no outboard hurtbox at all before their first active
frame, so there is no wind-up in the dump to read. ADR-0060 closed on the
sharpest version of the conflict — the resting arm is drawn at **0.25 of stature
instead of 0.37**, because the honesty cage keeps an invented hand inside the
fighter's own ±40 chest and a real arm will not fit.

`.scratch/pose-library/spec.md` proposes the inversion: hand-author the pose,
take the timing from the dump exactly, and let the two figures coexist. This ADR
is the format, the resolver and one hand-written move — Ryu's `2MK` — built
against the real frame data. Everything the derived path does is untouched.

## Findings

### The specials resolve; the issue's premise was the input string

Issue 01 records the three specials as "not resolved by input in `geo.moves`".
They are, under a strength-qualified input. `236P`, `623P` and `214K` are not
keys in the table and `236LP`, `623LP` and `214LK` are — all three `match:
exact`. `SPA_HADO` #900, `SPA_SYORYU_START` #930, `SPA_TATSUMAKI_END` #1000. The
full eleven-row table is the comment on issue 01.

### Two of the eleven have no `MarginFrame`, and it cannot be recovered

The spec's anchor table gives `neutral` = `marginFrame` and
`["recovery", t]` = `round(activeEnd + t · (marginFrame − activeEnd))`. On
`ATK_8HK` and `SPA_SYORYU_START` `MarginFrame` is `-1`. Recovery belongs to the
landing action — `BAS_JUMP_N_LAND(1)` #657 margin 3, `SPA_SYORYU_END` #938
margin 12 — reached by a `lands` handover whose branch carries
`_InheritFrameX false`. That is ADR-0056's **restarting** twin: two clocks, and
the second one starts counting from its own frame 1. There is no frame in the
airborne action for `neutral` to name.

So the anchor table is not total. `clockOf` returns `null` for what an action
does not carry, and `resolveKeys` reports `neutral does not resolve on ATK_8HK`
rather than guessing a frame. Half a file still binds: `start`, the startup
anchors, `contact` and `activeEnd` all resolve on both moves.

### A fireball's caster has no `MainFrame` and no active frame either

`SPA_HADO` is `MainFrame -1` with `activeWindows` empty. The move's 16 frames of
startup are the frame its `ShotKey` spawns `SPA_HADO PROJ` #909 on, and the 70
active frames belong to that projectile's own action (ADR-0022). `contact =
mainFrame + 1` would be 0.

`clockOf` takes both `contact` and `activeEnd` from `shots[0].frame` on a caster
— 16, 14, 12, 12 across LP/MP/HP/OD, which is exactly what `move.startup`
reports. `MarginFrame` 47 is real, so the recovery half of a hadoken file binds
normally.

### Of the eleven, three carry a twin and none of them splices

`spliceContinuations` only rewrites an action whose name ends `_H` and which
branches into its own base. Ryu has two, `ATK_2HP_H` and `ATK_4HP_H`, and
neither move is on the list; no action in the eleven carries a `continues`.

Three carry a `BranchKey`, and all three branch **at or one frame past their own
last active frame**, so the base action's clock is whole for every anchor:

| | branch | twin | type | inherits | twin `MarginFrame` |
|---|---|---|---|---|---|
| 5MP | f12 | `ATK_5MP(1)` #606 | SWING | **yes** | 22, base's clock |
| 2HK | f9 | `ATK_2HK_G` #645 | GUARD | no | 29, own clock |
| 5HK | f12 | `ATK_5HK_G` #618 | GUARD | no | 22, own clock |

Both GUARD twins carry `MainFrame -1` and no hit key, so a file bound to one
resolves `start` and `neutral` and nothing else. What a blocked move draws is
not answered here.

### `jointOf` does not keep a bone length constant, and the spec says it does

The spec's claim is that re-solving elbows and knees with the existing two-bone
`jointOf` means "bone length stays constant and a keyframe cannot stretch a
limb". The first half is false and the reason is in `jointOf` itself: a deep
fold is capped at 42% of the bone, deliberately, so a guard's elbow does not
stick out further than the fighter's own torso (ADR-0060). A capped fold draws
two segments that no longer sum to the bone.

Measured over all 29 frames of the authored `2MK`, on Ryu:

| chain | bone | drawn | |
|---|---|---|---|
| arm | 63.33 | **54.1 – 57.4** | 85 – 91% |
| leg | 89.88 | **81.8 – 89.9** | 91 – 100% |

The direction is the safe one — a limb is drawn **short, never long** — and it
is the same distortion the derived figure already carries, so the two modes at
least agree with each other. The second half of the claim holds only while a key
reaches no further than the chain is long; past that `jointOf` draws the chain
straight and the limb really is stretched. That is measured rather than
prevented: `overreach()` reports the worst limb in a file as a multiple of its
own bone, and the shipped `2MK` is **0.947**.

### Normalising by stature transfers the heights and not the horizontal

The spec's open question is whether a normalised pose transfers between builds.
For the heights it does exactly: Ryu's stack is 166 and Zangief's 178, and every
authored `y` comes out in that 1.0723 ratio with the file untouched.

Horizontally it does not, because the figure hangs on the **axis** — the
pushbox's centre, ADR-0050 — and an axis is a place on the stage, not a multiple
of a stature. At the contact frame of each fighter's own `2MK` the axis is 0 on
Ryu and 8 on Zangief. Relative to the axis the transfer is exact; absolutely it
is offset by the difference. This is right rather than a defect — it is what
keeps the drawn figure standing where the real boxes are — but it means "scales
by stature" is a statement about the pose and not about the position.

## Decision

**A move is a file of keyframes at `data/poses/<char>/<move>.json`, authored
source and committed.** `.gitignore` swallows `data/geometry/` and `data/raw/`;
it does not swallow `data/poses/`, and there is no script that writes one.

**Seven normalised points per key** — `pelvis`, `chest`, `head`, `hands[2]`,
`feet[2]` — in fractions of idle stature, origin at the axis on the floor, `+x`
forward, **index 0 the lead limb**. `Pose` orders each pair trailing-first, so
the resolver swaps them on the way out. Elbows and knees are not authored;
`bend` is an optional `±1` per limb that flips the fold direction.

**Anchors resolve against that action's own frame data**, through `clockOf`,
with `null` where the action does not carry the field. `contact` is
`mainFrame + 1` and is neither rounded nor eased: on `ATK_2MK_Y2` it lands on 8,
which `activeWindows` independently reports as the first active frame, and the
hitstop (ADR-0057) plays over the pose the author put there. The other five
anchors are taste; this one is correctness, and it is pinned by a test.

**Interpolation is smoothstep on the seven points, and the joints are solved
after it**, never blended. A `bend` hint is a discrete choice and is taken from
the nearer key rather than lerped, because blending `+1` towards `-1` sends an
elbow through the straight line half way between two keys.

**Every limb an authored file produces reports `derived: false`, and
`Pose.limbs` is always empty.** In this mode the figure is invention in full:
not one of the fourteen numbers per key was read off a box, the shoulder and
pelvis widths are frozen fractions of stature rather than the body hurtbox's own
width, and the warm hitbox limb — which is derived by construction — is not
drawn at all. A test walks all 58 frames of the action and asserts it.

**The arm is 0.37 of stature here, not 0.25.** ADR-0060's short arm is a
compromise with the honesty cage, and there is no cage in this mode because
there is nothing to keep honest: the hand is not claiming a hurtbox put it
there. The leg is `0.53 × 1.02`, matching the derived figure.

**The fade is the one thing carried over from the boxes.** A part with no
hurtbox this frame is invulnerable (ADR-0020) and is drawn dimmed, by the same
`over()` rule `poseOf` ends on. It says nothing about where a limb is.

**The derived path is untouched.** The only edit to `src/game/render.ts` is the
word `export` in front of `jointOf`. `poseOf`, `attitudeOf`, the settle and the
cage are not read from here and not changed.

## Consequences

- `npm run pose:audit` **1,233** and `npm run pose:motion` **577**, both
  unchanged to the row: `axis-pop` 497, `reach-overlong` 328, `spine-squashed`
  114, `limb-overlong` 103, `head-detached` 71, `spine-inverted` 60,
  `foot-above-hips` 60, `legs-stretched` 0; `stance-snap` 208, `limb-jerk` 171,
  `stand-snap` 155, `fade-snap` 38, `limb-teleport` 5, `plant-slide` 0. They
  grade the derived figure and they do not see this one.
- Two modules, both new: `src/game/pose-library.ts` (pure, so it runs in the
  browser) and `src/data/load-poses.ts` (Node's half), split on the same seam as
  `geometry.ts` and `load-geometry.ts`.
- One file: `data/poses/ryu/2MK.json`, six keys, resolving to frames
  **1, 5, 8, 10, 18, 29** against startup 1-7, active 8-10, recovery 11-29.
- 16 tests added. **300 pass**, `tsc --noEmit` clean, `web/play.js` rebuilt.
- The shipped pose **does not look good and is not meant to**. It is one
  crouching poke drawn by an agent from numbers, which is exactly the job
  issue 04 reserves for a human.

### What in the authored figure is invented, plainly

All of it. Every point in every key; the shoulder half-width 0.133 and the
pelvis half-width 0.072; the arm bone 0.37 and the leg bone 0.5406; where an
elbow or a knee folds and which way; the smoothstep between keys; the 0.3-radius
drop from the chest point to the shoulder line. Nothing in this path is derived
and nothing in it is drawn in the body colour by its own account.

Derived, and the only things that are: the **frames** — `MainFrame`, the active
windows, `MarginFrame`, a `ShotKey`'s spawn frame — the **axis**, the action's
own `originAt` height, and which parts have a live hurtbox.

## Not settled

- **The spine and the two torso lines are still inked `#e5e7eb`.** `drawFigure`
  hard-codes the body colour for the neck-to-hips line, the shoulder line and
  the pelvis line, so an authored figure drawn today has three body-coloured
  parts and the spec says it should have none. Fixing it means a mode flag on
  `drawFigure`, which is issue 05's, and another agent is in `render.ts`.
- **Past `neutral` the last key is held, not returned to idle.** The spec asks
  for a return to the idle pose over the action's remaining frames. There is no
  authored idle to return *to* until every fighter has one, and reaching into
  `poseOf` for the derived idle would put a derived limb into a figure that
  promises none. Held, and stated.
- **A cancelled move is undefined.** A move cancelled on frame 9 never reaches
  its recovery keys. The spec's own open question, unanswered here.
- **A blocked move has no pose.** Both GUARD twins on the list carry
  `MainFrame -1`, so `contact` and `activeEnd` do not resolve on them and a file
  bound to a twin binds two keys of six.
- **`jointOf`'s 42% cap is shared with the derived figure**, so relaxing it for
  authored poses — where the cage that motivated it does not apply — would move
  every derived elbow and knee on the roster. It was not relaxed.
- **Nothing draws this yet.** The resolver returns a `Pose`; no page selects it.
  The editor is issue 03 and the mode toggle is issue 05.
- **Whether a normalised library survives Blanka and Dhalsim is still open.**
  One move on two fighters is not evidence. Blanka's arms are 1.37× the roster
  median and the transfer test here only covers a 7% difference in stature.
