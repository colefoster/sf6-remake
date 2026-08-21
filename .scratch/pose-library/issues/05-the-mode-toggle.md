# 05 — The mode toggle in play.html

Status: ready-for-agent
Blocked by: 02

`hittable` (default, today's derived figure) vs `move` (authored). Named on
screen — the viewer must always know which question is being answered.

In `move` mode the whole figure is the player's tint, no body-coloured parts,
and the real boxes still draw. Fall back to `hittable` for any action with no
authored pose, which is most of them.
