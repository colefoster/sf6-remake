# ADR 0069 — The arm is long enough; it is the shoulder that is in the wrong place

- Status: accepted
- Date: 2026-08-23
- Extends: [ADR-0059](./0059-there-are-no-bones-and-the-ground-is-the-clock.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md),
  [ADR-0067](./0067-the-pose-can-be-authored-if-the-clock-stays-the-dumps.md)

## Context

ADR-0059 established that MMDK carries no animation, and ADR-0067 answered that
by hand-authoring the pose and keeping the dump's clock. Hand-authoring is the
bottleneck: eleven moves exist and Ryu alone has ~300 actions.

NVIDIA's **Kimodo** is a text-to-motion diffusion model that emits per-frame
skeletal motion — SMPL-X, 22 joints, local XYZW rotations plus a root
translation, 30fps. If that output can be turned into pose files, the bottleneck
goes away. Running it needs a gated model download and a GPU, and neither is
available here, so this ADR is only the half that carries the risk: **the
retarget.**

The risk is precise. Our figure is not a free skeleton. `pose-library.ts` fixes
the arm at **0.37** of stature and the leg at **0.5406**, hangs the shoulders at
`chest.x ± 0.133` and the hips at `pelvis.x ± 0.072`, and `overreach` reports 1
when a key asks for a limb longer than its own bone. Every shipped file is under
0.95 and the gate is not negotiable. Two days ago a set of poses was "fixed" by
remapping `y` alone; `overreach` came out **1.02–1.36 on all eleven**, because
rescaling one axis lengthens every diagonal. A 3D pose copied in fails the same
way. The question this spike answers is whether it can be *fitted* instead —
inside 0.95, without turning a roundhouse into a shrug.

There is no Kimodo here, so the input side is fixtures: four hand-built 30fps
clips in exactly the shape a motion model emits — a rest skeleton at
anthropometric proportions, a root translation per frame, 22 local quaternions
per frame — written by
`.scratch/pose-library/retarget/make-fixtures.mjs`, committed under
`tests/fixtures/`. They are honest humanoids and nothing more: `retarget.test.ts`
checks every bone holds its rest length across all 92 frames.

## Findings

### The joint mapping is not the obvious one, and two of the seven move

Two of our points are not anatomical joints. They are the *roots our limbs hang
from*, and mapping them to the SMPL-X joints of the same name puts every limb
out of reach before anything else happens.

| ours | SMPL-X | why not the same-named joint |
|---|---|---|
| `pelvis` | midpoint of `left_hip`/`right_hip` (1, 2) | our legs root at `pelvis.y ± 0.072`, so this point **is** the hip line. SMPL-X's `pelvis` (0) is the body root, 0.035 of stature above it — enough to make a **standing** figure read 1.03 overreached |
| `chest` | midpoint of `left_shoulder`/`right_shoulder` (16, 17) | our shoulders sit at `chest.y`, so this point is the shoulder line's centre. `neck` (12) is 0.03 higher and shortens every arm |
| `head` | `head` (15) | base of skull; 0.885 of stature, against the 0.876 the shipped files use |
| `hands` | `left_wrist`/`right_wrist` (20, 21) | our arm is shoulder-to-wrist by definition |
| `feet` | `left_ankle`/`right_ankle` (7, 8), dropped by the rest-pose ankle rise | our leg is hip-to-**sole**. `left_foot` (10) is a toe, forward of the sole |

The plane is the fighter's own **forward × up**; the lateral axis is discarded.
It is fixed on frame 0 rather than tracked per frame, so a spinning kick still
spins. Forward is read off the hips unless the clip states it, because a bladed
stance is exactly the case where the hips are not the fight's forward — all four
fixtures state it.

Bulk travel is **subtracted**: a fighter's forward motion is the action's own
origin track and the pushbox axis the figure already hangs on. The punch clip
lunges 0.058 of stature; carried in the pose it would be counted twice. The
shipped files agree — no pelvis `x` in the eleven leaves ±0.02.

### The naive projection fails on 92 of 92 fixture frames, and the shoulder is why

| clip | frames | stature | peak | naive p50 | naive max | fitted max |
|---|---|---|---|---|---|---|
| `straight-punch` | 21 | 1.723 m | 8 | 0.970 | **1.345** | 0.940 |
| `roundhouse-kick` | 24 | 1.723 m | 9 | 0.990 | **1.098** | 0.940 |
| `low-sweep` | 26 | 1.723 m | 10 | 0.970 | **1.175** | 0.940 |
| `lanky-punch` (12% longer limbs) | 21 | 1.838 m | 8 | 1.009 | **1.386** | 0.940 |

85 of 92 frames need the fit at all; the worst naive frame is 1.386.

The cause is not limb length. Measured off the fixtures' own rest pose, the
model body is **shorter** in both bones than ours:

| | fixture | our figure |
|---|---|---|
| shoulder to wrist | 0.337 | **0.37** |
| hip to sole | 0.537 | **0.5406** |

At the punch's contact frame the rear arm reaches **0.909** of our arm *measured
from where the shoulder actually is* — comfortably inside the gate. It reads
**1.345** measured from where our model puts it:

| rear shoulder at contact | x | y |
|---|---|---|
| where SMPL-X has it | **+0.112** | 0.807 |
| shoulder-line midpoint (`chest`) | +0.084 | 0.807 |
| where our figure puts it, `chest.x − 0.133` | **−0.049** | 0.807 |

**0.162 of stature of misplacement — 0.44 of an arm.** A real body rotates its
shoulder girdle into a cross, so the punching shoulder ends up *ahead* of the
midline; our seven points have no degree of freedom for that, and weld the rear
shoulder 0.133 behind the chest whatever the torso is doing. Every unit of the
overreach on the punch is that, and none of it is Kimodo's, the projection's, or
the model body's.

### The fit is two steps and the gate is a theorem, not a tuning

1. **Sink the pelvis** until every *grounded* foot can reach the floor. A body
   whose legs are short for its stance bends its knees; it does not shorten its
   stance. The torso translates rigidly, so its lean and crouch survive, and the
   feet do not move at all.
2. **Clip every limb tip radially** to `REACH = 0.94` of its bone, about its own
   root. Direction from the shoulder or hip is preserved exactly; only distance
   changes.

Step 2 measures the same four spans against the same four roots that `overreach`
does, so after it no span can exceed `0.94 · bone` — for an input of any shape,
including a body with limbs 12% longer than ours. The order matters one way
only: sinking moves the shoulders and changes what an arm can reach, while
clipping a hand cannot change what a leg needs.

`REACH` is 0.94 rather than 0.95 because rounding the file to three decimals
costs up to 0.002, and sitting on the gate would leave floating point to decide.
Measured on the emitted files: **0.941–0.942**.

### What the fit costs, worst case over all 92 frames

| point | fractions of stature | Ryu units (166) |
|---|---|---|
| `hand.rear` | **0.164** | 27.3 |
| `foot.rear` | 0.085 | 14.2 |
| `pelvis` / `chest` / `head` | 0.042 | 6.9 |
| `foot.lead` | 0.026 | 4.4 |
| `hand.lead` | **0.000** | 0.0 |

The cost is concentrated on exactly one point: the striking limb of a *rear*-side
attack. The lead hand never moves; the torso moves only by the sink, and moves
as one piece. On the punch's contact frame the fitted hand reaches x = 0.356
where the hand-authored `5MP` puts its hand at 0.510 — the retargeted cross is a
recognisable straight punch that lands **0.154 of stature shorter** than a human
author would draw it. The contact sheet at
`.scratch/pose-library/retarget/sheet.png` is the three side by side.

A `low-sweep` frame shows the same effect on the other limb: the scything rear
leg is pulled in 0.058, the supporting arm 0.087, and the pose still reads as a
sweep.

### The clip's 30fps never reaches the file

`retargetClip` finds the **extension peak** — the frame whose naive projection
is furthest past its bones — and binds it to `contact`, which resolves to
`MainFrame + 1`. The other anchors resolve against the action's own frame data
as ADR-0067 already specifies, and each is drawn from the clip through a
two-piece linear warp pinned at three points: first frame to first frame, peak to
`contact`, last to last. The same 21-frame clip driving `ATK_5LP` and `ATK_5HP`
produces two different frame lists and neither is 21 long.

Anchors an action does not carry are named, not guessed: `ATK_8HK` has
`MarginFrame -1`, so `recovery 0.4` and `neutral` are dropped and reported, and
the four-key file that comes out still binds with no problems.

| clip → action | keys | resolve problems | file `overreach` | hand-authored equivalent |
|---|---|---|---|---|
| `straight-punch` → `ATK_5MP` | 6 | none | 0.941 | 0.939 |
| `roundhouse-kick` → `ATK_5HK` | 6 | none | 0.941 | 0.936 |
| `low-sweep` → `ATK_2HK` | 6 | none | 0.941 | 0.912 |
| `roundhouse-kick` → `ATK_8HK` | 4 | none | 0.941 | — |

### A punch thrown at the camera

The degenerate case of a side-on plane is a strike along the discarded axis. The
projection **keeps the limb's 3D length** by rescaling the in-plane vector rather
than letting the lateral part be dropped, and when there is no in-plane direction
left to trust — under 15% of the limb's length — points it straight forward. A
hook then reads as a strike at its true extension instead of a shrug, and the fit
decides how much of it our arm can have. The lateral share is reported per limb
so the cost is never silent; on the fixture rotated to throw its cross at the
camera it is 0.75.

This is a choice and it is reversible: `foldLateral: false` gives the honest flat
projection.

## Decision

**Add `src/game/retarget.ts`, pure and browser-safe, alongside
`pose-library.ts`. Nothing existing changes.** It exposes forward kinematics for
a 22-joint SMPL-X clip, the plane, the naive projection, the two-step fit, the
measurements (`reachOf`, `overreachOf`, `displacement`), and
`retargetClip(clip, action)` which emits a `PoseFile`.

The bone constants are **mirrored** rather than exported from
`pose-library.ts`, and the mirror is pinned: a pose built to sit at exactly
`REACH` on all four limbs must read as `REACH` through the library's own
`overreach`, so a bone changed in one place and not the other fails the test.

`poseOf`, the derived figure, both audits, `pose-library.ts`'s constants and the
eleven shipped pose files are untouched. `pose:audit` **1,233** and
`pose:motion` **577** are unchanged, `npx tsc --noEmit` is clean, and the suite
is **340** — the 322 that were green plus 18 new.

**Nothing is auto-authored into `data/poses/`.** The retarget produces files; a
human still decides one is good enough to ship.

## Consequences

- A 22-joint humanoid pose **can** be fitted to the seven-point figure inside
  the gate, deterministically, in a single pass, with no search and no tuning
  constants beyond `REACH`.
- The cost is a real and quotable number and it is not evenly spread: a rear-side
  strike loses up to 0.164 of stature of reach and everything else loses under
  0.05. Lead-side strikes cost nothing.
- The retargeted poses read as what they are — the contact sheet shows a punch
  that is a punch — but a rear cross comes out visibly shorter than a human would
  draw. **A retarget is a first draft, not a shipped pose.**
- The finding transfers off Kimodo entirely: it is a property of the seven-point
  format, so REFramework-dumped bone transforms (ADR-0059's "different project")
  would hit the identical wall.
- The fixtures are committed and the generator is in `.scratch/`, so the input
  side can be re-shaped without a GPU when the real thing arrives.

## Not settled

- **Whether real Kimodo output is worth the download.** The retarget is proven
  against fixtures the author of the retarget also wrote, which is the weakest
  part of this. The fixtures are geometrically honest and deliberately include a
  body our bones cannot hold, but they are not a diffusion model's idea of a
  roundhouse. Nothing here is evidence about *motion quality* — only about
  whether the geometry can be made to fit, and it can.
- **Whether the figure should grow a shoulder.** One extra authored number — a
  forward offset for the shoulder line, or a per-hand shoulder x — would recover
  the entire 0.44-of-an-arm deficit and let a rear cross reach as far as a human
  author draws it. That is a change to `AuthoredPose` and to `overreach`, so it
  is deliberately not made here; it is the obvious next question and this ADR is
  the measurement that motivates it.
- **The lead/rear rule.** Lead is the foot further forward on frame 0, and it
  names both the lead hand and the lead foot. A clip that switches stance
  mid-motion is mislabelled from the switch onward, and nothing detects it.
- **Extension peak as the contact frame.** It is the right frame for a strike and
  it is not obviously right for a projectile caster, whose `contact` is the shot
  frame and whose most-extended pose may be the follow-through.
- **The 0.885 stature estimate.** SMPL-X has no crown joint, so sole-to-crown is
  inferred from the head joint. A clip that states its own stature does not use
  it, and Kimodo's output may or may not.
