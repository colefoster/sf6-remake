# Spec — the authored pose library

Status: ready-for-human

## Why

The figure is derived from the collision boxes. That was the right decision for
ADR-0049's question — *what is hittable* — and it is the wrong source for
*what the move looks like*, because the animation is not in it. Measured, all
today:

| | |
|---|---|
| attacks with **no outboard hurtbox before their first active frame** | **902 of 1,311 (69%)** |
| pose anchors per attack, p10 / p50 / p90 | **0 / 3 / 6** |
| longest evidence-free stretch, p50 / p90 | **9 / 26 frames** |
| attacks that move their hitbox while active | 540 of 1,311 (41%), median window 4 frames |
| `1060_DMG_HH_DN`, all 45 frames | the **exact standing hurt stack**, standing pushbox, no motion |
| reaction actions holding one static layout for their whole duration | **all 646** |

The game boxes the follow-through and never the anticipation. A limb appears
fully extended and disappears. There is no wind-up in the data because nothing
in the game needs one.

### The two goals are in conflict, and the cage is where it shows

ADR-0060 records that the resting arm is drawn at **0.25 of stature instead of
0.37**, because a real-length arm cannot fit inside Ryu's ±40 chest and the
honesty cage clamps an invented hand inside the fighter's own hurtboxes.

That is not a defect. It is *"show me what is hittable"* beating *"show me the
move"*, and it wins every time, because for a training room it is the correct
rule. One figure cannot serve both. This spec adds the second figure.

## The inversion

Today the pose is derived and the timing is ignored — `src/game/render.ts`
references `mainFrame`, `marginFrame` and the active windows **zero** times.
Flip it:

- **The pose is authored.** Hand-made keyframes, a handful per move.
- **The timing is the dump's, exactly.** A 4-frame startup plays in 4 frames
  because the game says 4. The frame data is this project's actual value and it
  stays untouched.

## Scope of the first cut

**One fighter, eleven moves.** Not a content pipeline — an afternoon.

`5LP · 5MP · 5HP · 2LK · 2MK · 2HK · 5HK · j.HK · 236LP · 623LP · 214LK`

At 3–6 keys each that is **~50 poses**. All eleven resolve `match: exact`
through `geo.moves` — the specials need a **strength-qualified** input (`236LP`,
not `236P`), which is why an earlier draft of this spec thought they were
unmapped. Resolved actions are in issue 01.

## The joint model

A keyframe is a **normalised `Pose`** — the same shape `render.ts` already
draws, so `drawFigure`, both audits and the box overlay all keep working.

- Origin at the fighter's axis on the floor. **+x is forward** (towards the
  opponent); playback mirrors by `facing`.
- Units are **fractions of idle stature**, so one library scales to any fighter
  through `Build`/`stature` rather than being re-authored per body.
- Seven points: `pelvis`, `chest`, `head`, `hands[2]`, `feet[2]`. Index **0 is
  the lead** limb, 1 the rear.
- Elbows and knees are **not authored**. They are re-solved at playback by the
  existing two-bone `jointOf`, so **a keyframe cannot stretch a limb** — which
  is the property that matters. It does *not* hold bone length constant: a deep
  fold is capped at 42% of the bone by design (ADR-0060), so a limb can come out
  short, never long. Measured over the shipped 2MK: arm 54.1–57.4 against a
  63.33 bone, leg 81.8–89.9 against 89.88. An optional `bend` hint per limb
  flips the solution where the default reads wrong.

14 authored numbers per keyframe, 4 optional.

## The binding format

A move file is `data/poses/<char>/<move>.json` — **authored source, committed**,
unlike `data/geometry/` which is generated and ignored.

```jsonc
{
  "character": "ryu",
  "move": "2MK",
  "action": "ATK_2MK_Y2",
  "keys": [
    { "at": "start",           "pose": { } },
    { "at": ["startup", 0.55], "pose": { } },
    { "at": "contact",         "pose": { } },
    { "at": "activeEnd",       "pose": { } },
    { "at": ["recovery", 0.4], "pose": { } },
    { "at": "neutral",         "pose": { } }
  ]
}
```

Anchors resolve against **that action's own frame data**, never absolute frames:

| anchor | resolves to |
|---|---|
| `start` | 1 |
| `["startup", t]` | `round(1 + t · (mainFrame − 1))` |
| `contact` | `mainFrame + 1` — the first active frame |
| `activeEnd` | the last active frame |
| `["recovery", t]` | `round(activeEnd + t · (marginFrame − activeEnd))` |
| `neutral` | `marginFrame` |

### Where the anchors do not resolve — measured, not anticipated

- **`marginFrame` is −1 on both airborne moves.** j.HK and shoryuken hand their
  recovery to a *landing action* through a branch with `_InheritFrameX false` —
  ADR-0056's restarting twin, two clocks. So `neutral` and `["recovery", t]`
  have no frame to name **in the parent action**, and the resolver reports that
  rather than inventing one. Authoring the landing is a second move file, not a
  fudge in the first.
- **Hadoken's caster has no `MainFrame` and no active window at all** — the
  fireball is its own action (ADR-0022). `contact` therefore comes from
  `shots[0].frame`, which agrees with the published startup.

**`contact` is exact and is never interpolated across.** The authored pose sits
*on* the frame the game says the move connects, so a strike reads on the right
frame and the hitstop (ADR-0057) lands on the pose that earned it.

Between keys: eased interpolation of the seven points, joints re-solved after.
Past `neutral` the figure returns to the idle pose over the action's remaining
frames.

Because anchors are relative, a move whose frame data differs — a fighter
variant, a balance patch, the `_tired` twin — replays correctly without the
poses being touched.

## Honesty

- In **move** mode the entire figure is invention. It is drawn in the player's
  tint with no body-coloured parts, and the mode is named on screen. No part of
  it may claim to be derived.
- **The boxes are still the real boxes.** Drawing the authored figure against
  the true hurtboxes is what keeps it honest, and doubles as the authoring aid:
  a pose that disagrees with its own hitbox is visible while you make it.
- **`hittable` mode is untouched.** Today's derived, caged figure remains the
  default and remains what `pose:audit` and `pose:motion` grade. The authored
  library is graded by eye, because that is what it is for.

## The editor

`web/pose.html`, built by `scripts/build-play.mjs` alongside the other pages —
it reuses the same bundle and the same renderer (ADR-0053, one renderer).

- Character and move pickers driven by the geometry index.
- Canvas: real boxes behind, draggable handles on the seven points, onion-skin
  of the neighbouring keys.
- A timeline banded by phase — startup / active / recovery / free — with
  keyframe pips at their **resolved** frames, so you author against the real
  clock and can see a key land on the contact frame.
- Play at 60fps, scrub, add key here, delete key, mirror pose, copy JSON.
- No server write: the page emits JSON to the clipboard and the file is saved by
  hand. `npm run play` is a static server and does not need to change.

## Open questions

- **Do normalised poses actually transfer between builds?** Heights transfer
  exactly (Ryu 166 → Zangief 178 is ×1.0723), but **absolute x does not**: the
  figure hangs on the pushbox axis, which is 0 on Ryu and 8 on Zangief.
  Relative to the axis it is exact, so the resolver works in axis-relative x.
  Whether the *shapes* read correctly on a 1.37× arm is still open, and issue 04
  answers it.
- **What happens on a cancel?** A move cancelled at frame 9 never reaches its
  recovery keys. Probably: cut to the new action's `start`, as ADR-0065 does for
  a new action. Needs deciding before the specials go in.
- **Do the two modes share the camera and the recoil?** The recoil (ADR-0058)
  and hitstop are properties of the match, not the figure, so they should apply
  to both.

## Not in scope

- Other fighters, and the other ~290 actions.
- Reactions, throws, supers.
- Replacing the derived figure. It stays.
- **Dumping real bone transforms via REFramework.** That is the only route to
  genuinely polished animation — MMDK carries none, proven against all 46 typed
  key lists in ADR-0059 — and it is a different project.
