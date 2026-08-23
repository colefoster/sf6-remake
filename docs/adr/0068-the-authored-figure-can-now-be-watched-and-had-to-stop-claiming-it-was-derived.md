# ADR 0068 — The authored figure can now be watched, and had to stop claiming it was derived

- Status: accepted
- Date: 2026-08-23
- Extends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0053](./0053-one-renderer-two-cameras.md),
  [ADR-0060](./0060-the-leg-box-was-never-a-hip.md),
  [ADR-0067](./0067-the-pose-can-be-authored-if-the-clock-stays-the-dumps.md)

## Context

ADR-0067 built the authored pose library and eleven files followed it. They
resolve, they are tested, and its own *Not settled* section ends on **"nothing
draws this yet"**. The only way to look at one was a static PNG contact sheet,
which cannot answer the two questions the library exists to answer — does the
move read, and does it land on the right frame — because neither is visible in a
still.

ADR-0067 also left a leak it named precisely: `drawFigure` hard-codes `#e5e7eb`
for the spine, the shoulder line and the pelvis line, and that colour is the
renderer's word for *the dump put this here*. An authored figure drawn through it
carried body-coloured parts while promising none. The skull was a fourth,
unnamed.

This ADR is the two pages, the mode control on each, and closing the leak.

## Findings

### The leak was four strokes of twelve

`drawFigure` inks a limb by `Limb.derived` and everything else by a literal. The
four literals are the neck-to-hips line, the shoulder line, the pelvis line and
the head circle — three named in ADR-0067 and one not.

Counted as strokes, on the authored `2MK` at frame 8:

| figure | `#e5e7eb` | tint | warm |
|---|---|---|---|
| authored, as ADR-0067 drew it | **4** | 8 | — |
| authored, with `invented` | **0** | 12 | — |
| derived, unchanged | 4 | 8 | 2 |

A third of the authored figure — and the third a viewer's eye goes to first, the
spine and the skull — was in the colour that means *derived*.

Counted as pixels off the box viewer's own 1200×620 canvas, within ±12 of
`#e5e7eb`: `hittable` **5,315**, `move` **0**. On the match page, framing P1
alone, `move` mode leaves **105** — and the same 105 with the figures switched
off entirely, so all of them are HUD chrome and **none is the figure**.

### Playback was running at a third of the game's rate

`boxes.html` played on `setInterval(…, 1000 / 20)`. The whole premise of the
library is that the timing is the dump's exactly, and at 20fps Ryu's 7-frame
`2MK` startup took 350ms. Sampled at 100ms over a real playback the strip now
advances **6 action frames per 100ms**, which is 60.

Driving it needed the strip to stop being rebuilt per frame: it creates up to
ninety elements, and doing that sixty times a second is the difference between a
move that plays and one that stutters. It is rebuilt on a change of *action* and
only the `now` marker moves per frame.

### All eleven play, and three of them stop short of neutral

Every one of the eleven binds with no problems and animates across its whole
action. The keys resolve where their anchors name:

| move | action | frames | keys | resolved at | overreach |
|---|---|---|---|---|---|
| 5LP | `ATK_5LP` | 39 | 6 | 1, 2, 4, 6, 9, 13 | 0.938 |
| 5MP | `ATK_5MP` | 53 | 6 | 1, 3, 6, 9, 13, 20 | 0.936 |
| 5HP | `ATK_5HP` | 79 | 6 | 1, 5, 10, 14, 21, 32 | 0.935 |
| 5HK | `ATK_5HK` | 86 | 6 | 1, 6, 12, 15, 23, 35 | 0.935 |
| 2LK | `ATK_2LK` | 83 | 6 | 1, 3, 5, 6, 10, 16 | 0.814 |
| 2MK | `ATK_2MK_Y2` | 58 | 6 | 1, 5, 8, 10, 18, 29 | 0.928 |
| 2HK | `ATK_2HK` | 146 | 6 | 1, 5, 9, 11, 20, 34 | 0.911 |
| j.HK | `ATK_8HK` | 81 | **4** | 1, 5, 10, 17 | 0.942 |
| 236LP | `SPA_HADO` | 112 | **5** | 1, 8, 16, 28, 47 | 0.935 |
| 623LP | `SPA_SYORYU_START` | 35 | **4** | 1, 3, 5, 14 | 0.914 |
| 214LK | `SPA_TATSUMAKI_END` | 105 | 6 | 1, 7, 12, 14, 27, 46 | 0.935 |

The three short files are ADR-0067's measured gaps, not authoring that ran out:
`ATK_8HK` and `SPA_SYORYU_START` carry `MarginFrame -1` and have no frame for
`neutral` or `["recovery", t]` to name, and `SPA_HADO`'s caster has no active
window so it carries no `activeEnd`.

### Watching them makes the held tail obvious, which reading the file did not

ADR-0067 records that past the last key the pose is **held**, not returned to
idle. Hashing the canvas over every frame of each action, `2MK` produces **29
distinct images across 58 frames** and `2LK` **15 across 83**: the second half of
a long action is one frozen figure while the boxes behind it keep moving. That is
the documented behaviour working as written, and it reads as a bug until you
know. It is the first thing a viewer notices and it is the reason this is worth
recording rather than only fixing later.

### A page cannot find a pose file by its move name

`src/data/load-poses.ts` reads a directory, which a browser cannot do, and it
keys by the file's `move` label — `2MK`, `236LP`. At playback a fighter is in an
*action* and has no idea which input produced it. Both pages therefore need the
library keyed by `PoseFile.action`, which is the field the file already carries
and already checks against the geometry.

### The fallback is the common path by two orders of magnitude

Ryu has **309 actions and 11 authored poses**, so **298** — every walk, block,
reaction, throw, super and the other 42 attacks — fall back to the derived
figure. A `move` mode that drew nothing on those would be a control nobody could
leave switched on.

## Decision

**Two named modes on both pages, `hittable` and `move`, defaulting to
`hittable`.** Someone who never touches the control sees the derived, caged,
graded figure exactly as before. The box viewer names the live mode in a line
under the canvas in the mode's own colour and says in a sentence what the figure
is; the match page names it beside the control and reports how many moves each
side has authored.

**`drawFigure` takes a sixth argument, `invented`, defaulting to `false`.** When
set, the spine, the shoulder line, the pelvis line and the head circle take the
player tint instead of `#e5e7eb`, so the whole figure is one colour and not one
part of it claims a box placed it. Nothing else about the function changes and
the derived path never passes it.

**The boxes draw from the real data in both modes.** They are what keeps an
authored figure honest — a pose disagreeing with its own hitbox is visible while
you look at it — and they are the authoring aid the spec asked for.

**`move` falls back to `hittable` silently on the canvas and loudly in words.**
The figure swaps with no seam; the mode line says which action has no file and
how many do. The eleven are marked `◆` in the box viewer's action picker, which
is the only way to find them among 309.

**The anchor structure is on screen, not just its result.** Under the strip, the
action's frames are banded `startup` / `active` / `recovery` / `free` by
`phasesOf`, from that action's own `MainFrame`, active windows and `MarginFrame`;
each resolved key is a tick on the strip whose tooltip names the anchor that
asked for it; and every key is listed as `f8 contact`, with anything that did not
resolve listed in red beside them.

**`phasesOf` is total where the anchors are not.** A caster with no active window
gets **one** `active` frame, at the `ShotKey`'s spawn — `SPA_HADO` f16, which is
what `contact` resolves to, and hiding it would hide the anchor. An action with
no `MarginFrame` gets **no `free` band** and its recovery runs to the last frame,
rather than a boundary being invented for it.

**Playback is `requestAnimationFrame` at a selectable rate, default 60.** A slow
draw drops a frame instead of queueing one, and a backgrounded tab is capped at
four action frames per paint so a move plays rather than jumps on return.

**The library reaches the browser as `web/poses.json`, written by
`scripts/build-play.mjs`.** Both pages already load that script's `web/play.js`,
so both get the library from one place; it is generated and gitignored beside
`web/*.boxes.json`, while `data/poses/` stays committed authored source.

**The derived path is untouched.** `poseOf`, `attitudeOf`, the cage, the settle
and the audits are not read from here and not changed. The only edit to
`src/game/render.ts` is the `invented` argument and the four literals it
replaces.

## Consequences

- `npm run pose:audit` **1,233** and `npm run pose:motion` **577**, unchanged to
  the row: `axis-pop` 497, `reach-overlong` 328, `spine-squashed` 114,
  `limb-overlong` 103, `head-detached` 71, `spine-inverted` 60,
  `foot-above-hips` 60; `stance-snap` 208, `limb-jerk` 171, `stand-snap` 155,
  `fade-snap` 38, `limb-teleport` 5. They grade the derived figure and the change
  here is ink.
- **322 tests, up from 311.** The eleven pin the honesty rule against a recording
  `Ctx` — an authored figure strokes exactly one colour on all of frames 1, 5, 8,
  10, 18, 29, 40 and 58, the derived one still strokes `#e5e7eb` — the phase
  bands including both edge cases, and the action-keyed index including the
  298-action fallback and a duplicate claim.
- `tsc --noEmit` clean. `web/play.js` **101.7 KB**; `web/poses.json` 11 moves
  across 1 character.
- All eleven were watched playing in a browser at 60fps before this was written.
  A strip of `2MK` sampled during playback is at
  `.scratch/pose-library/2MK-move-mode.png` and the page at
  `.scratch/pose-library/boxes-move-mode.png`.
- The mode control does not persist. Reloading the page returns to `hittable`,
  which is the safe direction for a default whose whole job is to be the
  trustworthy one.

## Not settled

- **Past the last key the figure freezes**, and now that it can be watched this
  is the loudest thing about the library. ADR-0067's reason stands — there is no
  authored idle to return to, and borrowing the derived one would put a derived
  limb in a figure that promises none — but a fighter frozen for 29 of 58 frames
  is not a move anyone will accept for long.
- **A cancelled move is still undefined.** The spec's open question, and the
  match page now makes it reachable: cancel `2MK` into `236LP` on frame 9 and the
  second file starts at its own `start` because the action changed, which is
  ADR-0065's rule applied by accident rather than by decision.
- **A blocked move still has no pose.** `ATK_2HK_G` and `ATK_5HK_G` carry
  `MainFrame -1`, so a file bound to one would resolve two anchors of six. In
  `move` mode a blocked `2HK` therefore falls back to the derived figure mid-move
  — the fallback working correctly, and visible as a colour change on contact.
- **P2 has nothing authored**, so a two-fighter match in `move` mode draws one
  invented figure and one derived one side by side. That is honest and it is also
  the clearest possible view of what the two modes disagree about, but it was not
  designed, it fell out.
- **Nothing writes a pose file.** The editor is issue 03 and is not built; these
  pages read the library and cannot change it. The eleven remain what an agent
  drew from numbers, which is the job issue 04 reserves for a human.
- **The `invented` flag is a caller's promise, not a property of the pose.**
  `authoredPoseOf` already returns `derived: false` on every limb and an empty
  `Pose.limbs`, so the renderer could infer it. It was not inferred, because a
  derived pose that happened to produce no derived limbs would then silently
  change colour.
