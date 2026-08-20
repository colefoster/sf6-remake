# Spec — the training room

Status: `ready-for-agent` (both questions answered; 02 and 03 shipped in ADR-0049)
Date: 2026-08-20

A browser training room you can actually play: two stick figures driven by the
real engine, a dummy that does something, and the frame data on screen where a
player can read it.

## Why now

The runtime has been idle since ADR-0041 while eleven commits went into the
decode. That was the right order — the engine is only worth playing if its
numbers are right, and they now are (95.2 / 90.4 / 95.2 / 90.3 / 83.0 against
FAT, on a dump of the live game) — but the playable thing is further along than
it looks and has been waiting on nothing.

`web/play.html` already runs the real `Match` at 60fps with two-player keyboard
input, motion inputs resolved through the game's own triggers, health / Drive /
super, corners, hitstop, pause, frame step, reset and a hit log. **Hadokens
already work from the keyboard.** What is missing is not an engine.

## What is missing

1. **Bodies.** The page draws boxes. Nobody can read a fight as rectangles.
2. **An opponent.** P2 is a second keyboard. There is no dummy and no AI.
3. **The frame data, on screen.** The engine knows the advantage, the punish
   window, the combo scaling and the input history. The page shows an action
   name and a frame number.

## The three pain points this reshapes

- **No view layer.** `web/index.html`, `web/boxes.html` (36 KB) and
  `web/play.html` (15 KB) are hand-written pages with inline JS. All three fetch
  `<char>.boxes.json` and each computes its own scale, camera and box drawing.
  This is the duplication ADR-0028 removed from the *logic* layer re-forming in
  the *rendering* layer, and it is the concrete reason a stick figure has not
  happened: it would have to be written twice.
- **No opponent seam.** `Match.advance(p1, p2)` takes two input frames, which is
  exactly the right shape — but `match.ts` is already 930 lines carrying gauges,
  combos, throws, armor, projectiles, knockdowns and corners. A dummy controller
  and an AI must not land inside it.
- **The payload is not a game's payload.** `web/` is 45 MB; Kimberly's geometry
  alone is 1.38 MB and 205 of Ryu's 309 actions are hurtbox-only states nothing
  draws. Fine on localhost. Not shippable.

## The spike, and what it found

A throwaway script derived a pose per frame from the union of the active hurt
keys (head / body / leg) plus the active strike hitboxes, and rendered
filmstrips of Ryu's 5HP, 2MK, DP and jumping HK.

**It reads.** A recognisable person stands, leans into a punch with the arm
ending exactly on the hitbox, crouches for 2MK with the kick going low. No bone
data was needed, and MMDK dumps none: SF6's hurtboxes track the animation
closely enough that the pose comes free, and the *attacking limb is the hitbox*.

Three findings that change the design:

- **The head must be a fixed size.** Sizing the skull to the head hurtbox makes
  it balloon during a lean — the box grows to cover the extended body. Take the
  radius from the idle pose and hang it off the top edge of the box.
- **A missing hurtbox is not a missing body part.** ADR-0020 established that
  full invulnerability *is* the absence of a hurtbox, so on the invulnerable
  frames of a DP the figure loses its head and torso and collapses to a vertical
  line. The renderer needs to hold the last known pose for a part whose box has
  gone — and then **style it** (dimmed, dashed) rather than delete it, which
  turns the bug into the training room's best feature: **you can see
  invulnerability.**
- **Animation is coarse, and that is honest.** Attack actions carry 3–7 distinct
  hurtbox poses (Ryu's 5HP has 5 over 79 frames). The figure moves in steps. For
  a tool whose subject is frames, stepping on the frames the game itself changes
  on is the correct behaviour, not a defect to smooth over.

Spike script: `scratchpad/pose.py` (throwaway, not committed). Filmstrips were
`/tmp/spike-*.png`.

## Shape

Three seams, in dependency order.

### 1. A render module behind the existing bundle seam

`src/game/render.ts`, exported through `src/game/browser.ts` like everything
else, owning: game-unit → screen transform, camera, the box drawing both pages
already do twice, and `poseFrom(action, frame)` → joints. `play.html` and
`boxes.html` both call it. Nothing about rendering lives in a page again.

The pose is derived, never authored:

- head: fixed radius from the idle head box, hung off the top of the current one
- spine: centre-top of the body box down to the top of the leg box
- legs: hips to two points inset on the leg box's base
- limb: root (shoulder for a high hitbox, hips for a low one) to the hitbox's
  far edge — the hand or the foot *is* the hitbox
- a part whose box has vanished keeps its last pose and is drawn dimmed

### 2. An opponent seam beside the match, not inside it

`src/game/dummy.ts`: an opponent is a function `(match, side) => InputFrame`.
That is all `Match.advance` needs, so nothing in `match.ts` changes.

Ship the training-mode staples first — stand, crouch, block all, block after
first hit, mash 5LP, throw-tech, punish-after-block, DI on wake-up — because
each is a handful of lines against that signature and they are what practice
actually needs.

The interesting version comes second: a rule-based fighter that reads the
engine's own knowledge. It can know it is −7 and therefore punishable, know its
reach from `reach()` and `minDistance`, know what its gauge affords from the
triggers. An informed AI is a thing this project can build and a normal game
cannot.

### 3. The panel says what the engine knows

Frame advantage on block and on hit, punish window, combo hits / damage / scaling
as it happens, the input history as a notation strip, and the part-level armor
and invulnerability styling from seam 1. Almost all of it is already in `match`
state; this is presentation, not engine.

## Deliberately not in scope

- Sprites, sound, hit sparks, camera shake.
- Netplay.
- The 45 MB payload — only worth solving if this deploys (see Open questions).
- Engine gaps the ADRs already name and this will make visible: Drive Parry,
  back rise, grey-health regen, a fireball having no hurtbox, the downed pushbox
  that resolves but is unread. Each is its own piece of work; the training room
  is what will make the case for which one matters.

## Decisions

1. **Local only, not public.** The 45 MB payload is not a problem to solve —
   issue 05 is closed `wontfix`. Revisit only if this ever deploys.
2. **An unresponsive dummy.** Not the scripted-behaviour suite and not the
   reactive AI: P2 holds neutral and takes what it is given. Issue 03 is that,
   and it is done — the seam is `hold(5)` and nothing in `match.ts` moved. The
   scripted behaviours and the AI stay unbuilt until watching the figures says
   which are worth having.

## Issues

- `01-render-module.md` — done: the seam (ADR-0049) and both pages through it (ADR-0053)
- `02-stick-figure.md` — `poseFrom`, with the three spike findings baked in
- `03-dummy-seam.md` — done: the opponent function (ADR-0049) and five behaviours (ADR-0052)
- `04-training-panel.md` — done in ADR-0052: advantage, punish window, stun/floor and combo scaling
- `05-payload.md` — `wontfix`: local only
- `06-the-figure-is-jank.md` — done in ADR-0050: the pose hangs on the pushbox
  axis, and a hurtbox centred away from the footprint is a limb, not the body
- `07-drive-the-page-and-audit-the-figure.md` — done in ADR-0051: `window.play`
  drives the page from a script, and `npm run pose:audit` scores every pose on
  the roster. Four more derivation rules came out of it
