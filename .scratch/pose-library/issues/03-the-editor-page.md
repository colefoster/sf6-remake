# 03 — The editor page

Status: ready-for-agent
Blocked by: 02

`web/pose.html`, built alongside the other pages, reusing the same bundle and
renderer (ADR-0053).

Real boxes behind · draggable handles on the seven points · onion-skin of the
neighbouring keys · a timeline banded startup / active / recovery / free with
pips at resolved frames · play, scrub, add key here, delete, mirror.

## It is a correction tool, not only a creation tool

The poses are **seeded as JSON by an agent and corrected by hand.** Anatomy is
writable — a jab is a straight lead arm — but whether the result looks right is
a judgement, and this project has repeatedly shown that the agent is the wrong
one to make it. So the division is: the agent writes all fifty, the human fixes
what is wrong.

That makes **loading a non-negotiable feature, not export alone**:

- **Load** `data/poses/<char>/<move>.json` for the selected move on open, and
  reload it on demand. Opening a move that already has a file must show that
  file, not an empty timeline.
- **Save back** to the same path. Clipboard export is the fallback if writing is
  not available from a static server, but a round trip that requires the human
  to paste into a file by hand will not survive fifty moves — solve it properly
  or say why you could not.
- Show plainly whether the pose on screen is the seed or has been edited, and
  make reverting a single pose to its seed one click.

## The bar

Correcting one seeded move must take **under a minute**, and authoring one from
nothing minutes rather than an hour. If it does not, the library never gets made
and the whole direction dies here. Say so plainly if the interaction is not
there yet rather than declaring it done.
