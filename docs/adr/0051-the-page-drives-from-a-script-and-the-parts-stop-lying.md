# ADR 0051 — The page drives from a script, and four boxes stop lying about the body

- Status: accepted
- Date: 2026-08-20
- Amends: [ADR-0049](./0049-the-figure-is-derived-from-the-boxes.md),
  [ADR-0050](./0050-the-pushbox-is-the-axis-and-a-far-box-is-a-limb.md)

## Context

ADR-0050 put the figure on the pushbox axis and fixed the five moves anyone had
looked at. Nobody had looked at the other 7,000: reaching a named action on a
named frame meant six key events and a guess at how many steps land inside the
active window, and a move that cannot be input from neutral — most of a
309-action roster — could not be looked at at all.

## Findings

### The page needed a control surface before the figure could be audited

`window.play` drives the page from a script. Two halves, because two things were
needed: `press` / `step` advance the real `Match` deterministically by ticking it
directly instead of waiting on `requestAnimationFrame`, and **`scrub` bypasses
the match entirely** and puts a fighter on any action and frame, replaying the
pose chain from frame 1 from the idle pose so a held-over part is held exactly as
it would be in play. With `frame(side, span, solo)` for a fixed camera and
`pose(side)` for the joints as numbers, a script can shoot a contact sheet of any
move on any fighter, and a second script can score all 385,607 frames for poses
that are wrong on their face.

That audit is `npm run pose:audit`. It has no ground truth — there is no skeleton
in the dump — so it counts the negatives: hips above the neck, a head off the
shoulders, an arm longer than the body, an axis that jumps while the fighter
stands still.

### Four things the boxes were saying that the figure believed

- **A box tagged to every part says nothing about which part it is.** Akuma's air
  fireball hangs one 80x120 box off head, body *and* leg at once. Believed, it
  put the hips level with the neck and stood him on 145-unit stilts. Where a part
  has a box of its own that box is the part; the shared one is a fallback only.
- **A part whose every box is out on a limb has no body left in it.** ADR-0050
  filtered each part to the boxes over the footprint and fell back to the whole
  union when that left nothing. Dee Jay's sweep tags both leg boxes to the
  sweeping leg, so the fallback fired and drew his legs as a tent above his head.
  Held over is right; falling back never is.
- **The parts are not always in the order a body is.** Blanka's 5MK is a flip: the
  head key sits on the floor and the leg key at 166. Twelve actions on the roster
  do it and every one is a somersault. The parts are ordered along the spine, so
  their own order says which end is the head — and an upside-down fighter draws
  upside down instead of squashed with his skull in his chest.
- **A limb is a body part, and a body part is hittable.** A.K.I.'s EX snake is a
  524-wide hitbox on an action with no hurtbox at all, and "the attacking limb
  *is* the hitbox" drew it as a 563-unit arm out of a man who was not there. A
  hitbox further out than the fighter's own hurtboxes reach is not a limb. It is
  still drawn as a hitbox. Dhalsim's arm carries hurtboxes the whole way and is
  still an arm.

Two smaller ones: the skull is now clamped to sit **on** the neck rather than
hung off a head box that is often much taller than a head (Ryu's crouch carries
two boxes over 50 units, which left a bare neck as long as the skull) or, on
A.K.I.'s command grab, *below* the torso. And the pushbox's centre is held
through a frame that has none, like every other part, rather than snapping to the
fighter's own x.

## Decision

`window.play` in `web/play.html`, `scripts/pose-audit.ts` behind
`npm run pose:audit`, and the five rules above in `poseOf`.

## Consequences

Audit counts, before this ADR and after:

| flagged | before | after |
|---|---|---|
| head off the shoulders | 8,946 | 71 |
| hips above the neck | 1,602 | 494 |
| legs stretched | 1,490 | 434 |
| torso collapsed | 728 | 120 |
| limb longer than the body | 710 | 231 |
| axis jump from a missing pushbox | 41 | 0 |

- Five tests added on the four rules and the held footprint.
- **The residuals are the dump, not the derivation.** The 494 inverted spines are
  nine somersault actions; the 434 stretched legs are Akuma's air fireball and
  Dhalsim's float; 497 of the axis pops are the pushbox itself moving inside an
  action, which is the fighter's footprint really shifting.
- `web/play.js` is 57 KB.

## Not settled

- **The contact-sheet harness is not in the repo.** It drives the page through
  Playwright, which is not a dependency, so it lives in a scratchpad. The numeric
  audit — the part that catches regressions — needs nothing and is committed.
- **A kick is still told from a punch by the action's name.** Every special falls
  back to height, so Akuma's tatsumaki draws its kick as an arm.
- **Arms at rest are still invented** (ADR-0049), and the extended-limb hurtboxes
  the footprint filter now isolates are still thrown away rather than drawn on
  the startup and recovery frames where no hitbox is live.
