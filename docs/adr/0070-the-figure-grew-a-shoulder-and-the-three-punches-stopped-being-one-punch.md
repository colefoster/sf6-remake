# ADR 0070 — The figure grew a shoulder, and the three punches stopped being one punch

- Status: accepted
- Date: 2026-08-23
- Extends: [ADR-0060](./0060-the-leg-box-was-never-a-hip.md),
  [ADR-0067](./0067-the-pose-can-be-authored-if-the-clock-stays-the-dumps.md),
  [ADR-0069](./0069-the-arm-is-long-enough-the-shoulder-is-in-the-wrong-place.md)

## Context

ADR-0069 measured a hole and deliberately did not fill it. The authored figure
welds each shoulder to `chest.x ± 0.133` and has no degree of freedom for the
shoulder girdle, so on the fixture's cross the punching shoulder sat **0.162 of
a stature behind where the body actually had it — 0.44 of an arm.** The rear
hand reached 0.909 of our arm from the real shoulder and read **1.345** from
ours, and the whole cost of fitting a retargeted pose landed on that one point:
`hand.rear` 0.164, `hand.lead` 0.000, both feet 0.000. ADR-0065's agent had
found the same wall independently — *"the rear hand cannot reach past
`chest.x + 0.237`; there is no field for a torso twist."*

The cost was not only in the retarget. It was in the eleven shipped files.
**5LP, 5MP and 5HP were all thrown with the lead hand and all landed within
0.037 of a stature of each other** — 0.495, 0.510, 0.532 — because a rear hand
could not be authored at all. Without girdle rotation a jab and a cross are the
same move drawn twice, and Ryu's three standing punches were.

This ADR adds the one number, uses it, and states what it cannot do.

## Findings

### The parameterisation is an angle, and its zero is already an extreme

`AuthoredPose.twist` is **degrees of shoulder-girdle azimuth**, absent meaning 0.
The shoulder line's forward half-separation is

```
shoulderHalfAt(twist) = 0.133 · cos(twist)
```

and nothing else in the figure reads it. The reason it is a cosine and not an
offset is that biacromial breadth is a **bone**: a twist cannot lengthen the
shoulder line, only turn it, and a side view sees the turn as a cosine. The
reason it is stored as an angle rather than as the resulting offset is that the
angle belongs to the body and the breadth belongs to us — a source skeleton 12%
broader across the back would hand back a different offset for the same
rotation, and the retarget has to read one and apply the other.

**The sign convention falls out of the zero, and the zero is not neutral.** At
`twist = 0` the shoulder line lies along the fight axis with the lead shoulder
fully forward, which is a *more* bladed torso than any real guard. There is no
rotation that puts the lead shoulder further forward than its own half-breadth,
so negative twist is not a pose, it is an error; `clampTwist` folds it to 0.
Positive twist therefore means one thing only — **the girdle has turned towards
the opponent: the rear shoulder comes forward, the lead shoulder goes back, by
equal and opposite amounts about `chest`.** Past 90° the cosine goes negative and
the rear shoulder finishes in *front* of the lead one, which is what a thrown
cross looks like.

The four fixtures corroborate the zero from outside: their standing frames
derive to **37°**, which is the bladed-but-not-sideways shoulder line of a real
guard and which our format has no way to draw.

### The clamp is 120°, and it is the torso's number rather than the projection's

| | azimuth | `shoulderHalfAt` |
|---|---|---|
| the figure's welded line | 0° | 0.133 |
| a real orthodox guard | ~40° | 0.102 |
| shoulders square to the camera | 90° | 0.000 |
| **`TWIST_MAX`** | **120°** | **−0.067** |
| the geometric ceiling — the line reversed end for end | 180° | −0.133 |

The projection permits 180°. The body does not: a guard carries the shoulder
line about 40° off the target line and a cross passes square by roughly 30°
before the far shoulder is pulled back by an arm that has to stay in the guard.
**40° before square plus 30° past it is 70° of usable rotation, and its far end
lands at 120° on this scale.** That is the clamp, it is one-sided at 0, and it
is enforced in `clampTwist` rather than trusted to the author.

Measured against it, the fixtures never ask for more than 112°, and the deepest
hand-authored key is 115°.

### The whole 0.44 of an arm comes back

The fixture's straight punch at its extension peak, projected onto the figure:

| rear shoulder at contact | x |
|---|---|
| where SMPL-X has it | **+0.112** |
| shoulder-line midpoint (`chest`) | +0.084 |
| where ADR-0069's figure put it, `chest.x − 0.133` | **−0.049** |
| where the derived twist puts it, 106.1° | **+0.120** |

0.162 of stature of misplacement becomes **0.008**. The rear arm's reach on that
frame:

| | rear hand | lead hand | rear foot | lead foot |
|---|---|---|---|---|
| twist 0 (ADR-0069) | **1.345** | 0.363 | 0.918 | 0.977 |
| twist 106.1, derived | **0.887** | 0.582 | 0.918 | 0.977 |

### The retarget's cost table, before and after

`retarget.ts` now derives the twist from the source skeleton — `atan2` of the
shoulder line's lateral component against its forward one, clamped — instead of
dropping it. Worst case over all 92 fixture frames:

| point | ADR-0069 | with the twist derived | Ryu units (166) |
|---|---|---|---|
| `hand.rear` | **0.164** | **0.000** | 0.0 |
| `foot.rear` | 0.085 | 0.085 | 14.2 |
| `pelvis` / `chest` / `head` | 0.042 | 0.042 | 6.9 |
| `foot.lead` | 0.026 | 0.026 | 4.4 |
| `hand.lead` | 0.000 | 0.000 | 0.0 |

**The fit no longer touches a hand at all.** Everything left is a leg, and the
frames needing the fit fell from 85 of 92 to 81 of 92.

| clip | frames | peak | naive p50 | naive max, ADR-0069 | naive max, now | fitted max |
|---|---|---|---|---|---|---|
| `straight-punch` | 21 | 8 | 0.970 | **1.345** | **0.977** | 0.940 |
| `roundhouse-kick` | 24 | 9 | 0.990 | 1.098 | 1.098 | 0.940 |
| `low-sweep` | 26 | 10 | 0.970 | 1.175 | 1.046 | 0.940 |
| `lanky-punch` | 21 | 12 | 1.009 | **1.386** | **1.016** | 0.940 |

The straight punch is now inside our bones as it stands and needs no fit. The
roundhouse is untouched, because the twist moves a shoulder and a roundhouse's
overreach is a hip's. `.scratch/pose-library/twist/retarget.png` is the
hand-authored / projected-at-0 / projected-with-twist / fitted comparison drawn
through `drawFigure` itself.

### The pelvis was measured and does not get one

The hips do rotate through a punch, and the figure is as wrong about them as it
was about the shoulders. Over all 92 fixture frames the real hip line's forward
half-separation runs **min −0.034, median 0.025, max 0.034**, against the 0.072
the figure welds — it is never as bladed as we draw it and it does counter-rotate
past square. Worst disagreement **0.106 of a stature**, on the roundhouse's ninth
frame.

It still does not get a twist, for two measured reasons.

**It would break the gate on eight of the eleven.** A shoulder is the root of a
limb whose tip is *free*, so misplacing it costs reach the author wanted. A hip
is the root of a limb whose tip is *on the floor*, so moving it towards square
only lengthens the span to a foot that is already placed. **The shoulder twist
buys reach; a hip twist can only spend it.** Applying the fixtures' widest hip
half — 0.034, and every frame of every fixture wants one at least this square —
to the shipped files, changing nothing else:

| move | leg reach welded | at 0.034 | gate |
|---|---|---|---|
| jHK | 0.943 | **1.003** | fails |
| 2MK | 0.929 | **0.994** | fails |
| 2HK | 0.912 | **0.977** | fails |
| 5HK | 0.936 | **0.962** | fails |
| 5LP | 0.940 | **0.953** | fails |
| 5MP | 0.938 | **0.953** | fails |
| 236LP | 0.936 | **0.950** | fails |
| 5HP | 0.936 | **0.950** | fails |
| 214LK | 0.936 | 0.949 | holds |
| 623LP | 0.915 | 0.927 | holds |
| 2LK | 0.815 | 0.874 | holds |

Eight of the eleven go to 0.95 or past it and one goes past 1. Recovering them
means re-authoring every foot in the library, which is exactly the wholesale
re-author this change was scoped to avoid.

**And it buys the retarget less than it costs.** A hip twist would take the
roundhouse's naive peak from 1.098 to 1.021 and the sweep's from 1.046 to 0.969
— real, but the fit already reduces both to 0.940 for 0.085 of a stature on one
foot, and that is the only point in the table it would improve.

The number is on the record so the next agent does not have to measure it again.

### Where the twist belongs in the eleven, and where it does not

Twist is one-sided, so it pays a **rear**-side strike and charges a lead-side one
the same amount. That decides every file on its own:

| move | contact twist | why |
|---|---|---|
| **5MP** | **100°** | re-authored as a rear-hand straight to the body — its hitbox is `y 0.578–0.759`, a solar-plexus box, below the jab's |
| **5HP** | **115°** | re-authored as a rear-hand cross — the longest hitbox on the roster's three punches, front edge 0.663 against the other two at 0.608 |
| 5LP | 0° | a lead jab. The lead shoulder is *already* as far forward as the format can put it; any twist would pull it back |
| 236LP | 0° | the Hadoken squares the shoulders, and 90° is exactly the twist for it — but the thrust's **lead** hand is already at 0.917 of its bone and squaring the girdle takes it to 1.275. One rigid shoulder line cannot bring the rear hand forward without taking the lead hand back |
| 623LP | 0° | the Shoryuken rises on the lead hand, at 0.850 of bone |
| 2LK, 2MK, 5HK, 2HK, jHK, 214LK | 0° | kicks. The shoulders **counter**-rotate through a kick — they open away from the strike — and 0 is already fully open |

Nine files are byte-identical. Two changed, and in those two only `twist` and the
two hands moved: pelvis, chest, head and both feet carry the numbers ADR-0067's
re-seed settled.

### The three punches at their contact frames

| move | before | after |
|---|---|---|
| 5LP | lead hand to 0.495, arm 0.929, twist 0 | *unchanged* |
| 5MP | lead hand to 0.510, arm 0.939, twist 0 | **rear** hand to 0.380, arm 0.920, twist 100° |
| 5HP | lead hand to 0.532, arm 0.932, twist 0 | **rear** hand to 0.455, arm 0.932, twist 115° |

`overreach` per file, on Ryu's build and on an even one, and over every eased
frame and not only the keys:

| move | before (Ryu / even) | after (Ryu / even) | worst eased frame |
|---|---|---|---|
| 5MP | 0.936 / 0.939 | **0.936 / 0.938** | 0.938 |
| 5HP | 0.935 / 0.936 | **0.935 / 0.936** | 0.936 |
| 5LP | 0.938 / 0.940 | 0.938 / 0.940 | 0.940 |
| 2HK | 0.911 / 0.912 | unchanged | 0.912 |
| 2LK | 0.814 / 0.815 | unchanged | 0.815 |
| 2MK | 0.928 / 0.929 | unchanged | 0.929 |
| 5HK | 0.935 / 0.936 | unchanged | 0.936 |
| 214LK | 0.935 / 0.936 | unchanged | 0.936 |
| 236LP | 0.935 / 0.936 | unchanged | 0.936 |
| 623LP | 0.914 / 0.930 | unchanged | 0.930 |
| jHK | 0.942 / 0.943 | unchanged | 0.943 |

The file numbers barely move, and that is the honest report: on both re-authored
punches the worst limb is now a **leg**, not the striking arm. What moved is
the arm the move is about. `.scratch/pose-library/twist/punches.png` is the six
figures side by side.

## Decision

**`AuthoredPose` grows one optional field, `twist`, in degrees, defaulting to 0,
clamped to `[0, 120]`, and it does exactly one thing: it rotates the shoulder
line about `chest` so `shoulderHalfAt(twist) = 0.133 · cos(twist)`.**

- `authoredPoseOf` hangs both arms from the turned line. `overreach` measures
  both arms against it. `sampleAuthored` blends it as the quantity it is, and
  emits it only where a key states one, so a library with no twist in it samples
  to the object it always did.
- `retarget.ts` **derives** it from the source skeleton's own shoulder azimuth
  and carries it through the projection, the fit and the emitted file. It no
  longer mirrors `SHOULDER_HALF`: there is one place that number lives now.
- **The derived figure is not touched.** `poseOf`, `attitudeOf` and the derived
  shoulder placement know nothing about twist, however tempting the symmetry —
  the derived figure's shoulders are answerable to the hurtboxes and this field
  is answerable to an author. Hashing every derived limb root, joint and tip
  across the roster is bit-identical across this change.
- **The pelvis line does not get the same field**, for the reasons measured
  above.
- Two files are re-authored, nine are byte-identical, and nothing else in
  `data/poses/` moves.

`pose:audit` **1,233** and `pose:motion` **577** are unchanged, `npx tsc
--noEmit` is clean, and the suite is **345** — 340 minus none plus five, with
five existing `retarget.test.ts` assertions retuned because they pinned the hole
this ADR fills.

## Consequences

- **A rear-hand strike is authorable.** The reachable envelope for the rear hand
  went from `chest.x + 0.237` to `chest.x + 0.437`, which is the difference
  between a shrug and a cross.
- **The three standing punches are three moves.** A short high lead jab, a
  square-shouldered rear body straight, and a fully-rotated rear cross, and the
  contact sheet reads as three different silhouettes rather than one drawn
  thrice.
- **The retarget's headline cost is gone.** A rear-side strike used to lose up to
  0.164 of a stature to the fit; it now loses nothing. What remains is a leg's
  and it is 0.085.
- **A rear hand still reaches less far than a lead one**, by up to `0.133 ×
  (1 + cos 120°) = 0.067` of a stature at the clamp. That is a property of the
  format's zero being fully bladed, not of the body, and it is why 5HP's hand
  came in from 0.532 to 0.455 when it changed hands.
- **One number cannot square a two-handed thrust.** The girdle is rigid, so the
  rear hand only comes forward by taking the lead hand back. The Hadoken stays at
  0 and its rear hand stays 0.275 of a stature behind its lead one.
- The field is additive and defaulted, so every file, page and test that predates
  it is unaffected — including the box viewer, which reads `overreach` and got a
  smaller number for free on the two moves that changed.

## Not settled

- **Whether the format's zero should be 40° instead of 0°.** Every fixture's
  standing frame derives to 37°, and a real guard is bladed but not sideways. Our
  neutral draws the shoulder line flat along the fight axis, which is why a lead
  hand out-reaches a rear one here and does not on a body. Moving the zero would
  re-scale every existing file's implied stance and change `SHOULDER_HALF`'s
  meaning, so it is not done here — but it is the reason the rear hand still
  comes up 0.067 short.
- **Whether a second number should split the shoulders.** A protracting shoulder
  and a retracting one are not equal and opposite in a real punch; the format
  makes them so. A per-hand shoulder offset would fix the Hadoken and cost the
  format its one-number simplicity.
- **The pelvis.** Declined on measurement, not on principle. If the eleven are
  ever re-authored foot by foot, the hip line's own azimuth is already derivable
  from the same skeleton by the same `atan2`, and the fixtures say it would take
  the roundhouse's naive peak from 1.098 to 1.021.
- **The two re-authored punches are still a guess about SF6.** 5MP and 5HP were
  assigned to the rear hand from the hitbox geometry — 5MP's box is lower, 5HP's
  is longer and slower — and from what the moves look like in the game, which is
  not something this repo can check. The dump carries no animation (ADR-0049) and
  never will.
- **`TWIST_MAX` is an anatomical estimate, not a measurement of this game.** 40°
  before square and 30° past it are the numbers athletes are reported at; nothing
  here measured a Street Fighter. The fixtures stay inside it (max 112°) and one
  authored key sits 5° short of it, so it binds nothing today and would bind
  first on a spinning strike.
