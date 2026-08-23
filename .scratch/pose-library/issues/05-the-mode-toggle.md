# 05 — The mode toggle in play.html

Status: ready-for-human
Blocked by: 02

`hittable` (default, today's derived figure) vs `move` (authored). Named on
screen — the viewer must always know which question is being answered.

In `move` mode the whole figure is the player's tint, no body-coloured parts,
and the real boxes still draw. Fall back to `hittable` for any action with no
authored pose, which is most of them.

## Comments

**2026-08-23 — built, both pages. See [ADR-0068](../../../docs/adr/0068-the-authored-figure-can-now-be-watched-and-had-to-stop-claiming-it-was-derived.md).**

The issue asked for the toggle in `play.html`. It got it, and it got the larger
half in `boxes.html` too, because that is where a pose is actually reviewed: the
page already picks a character, picks an action and scrubs frames.

- **`hittable` / `move`, default `hittable`**, on both pages, named on screen.
  The box viewer carries a mode line under the canvas in the mode's own colour;
  the match page names it beside the control and says how many moves each side
  has authored.
- **All eleven play.** Every file binds with no problems and animates end to end;
  the eleven are marked `◆` in the action picker so they are findable among 309.
- **The body-colour leak is closed.** `drawFigure` takes a sixth argument,
  `invented`; with it the spine, the shoulder line, the pelvis line and the skull
  take the player tint. That was **4 body-coloured strokes of 12** on the
  authored figure, and **0** now — pinned by a test.
- **The fallback is the common path**: 298 of Ryu's 309 actions have no file and
  draw the derived figure, seamlessly on the canvas and stated in the mode line.
- **Playback is 60fps**, `requestAnimationFrame`, with 30/20/10 available. It was
  a fixed 20.
- **The anchor structure is on screen**: phase bands (`startup` / `active` /
  `recovery` / `free`) under the strip, a tick on the strip at each resolved key
  naming its anchor, and the key list as `f8 contact`.
- The boxes still draw from the real data in both modes.
- `pose:audit` 1,233 and `pose:motion` 577 unchanged; **322 tests**, up from 311;
  `tsc --noEmit` clean.
- Evidence: `.scratch/pose-library/2MK-move-mode.png` (a strip of `2MK` sampled
  during 60fps playback) and `.scratch/pose-library/boxes-move-mode.png`.

**Worth knowing before issue 03/04:** watching a move makes ADR-0067's *held
tail* the loudest thing about the library — `2MK` is 29 distinct images across 58
frames, so the fighter freezes for the whole `free` phase while its boxes keep
moving. It reads as a bug until you know it is written down.

Status: ready-for-human.
