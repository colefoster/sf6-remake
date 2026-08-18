# ADR 0030 — The stage is borrowed, and the corner is derived

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0027](./0027-two-fighters-and-the-reaction-the-table-asks-for.md),
  [ADR-0029](./0029-the-match-throws-fireballs-and-two-of-them-meet.md)

## Context

ADR-0029 closed with "no corner": a fireball that reached the edge of nothing
kept going, a fighter could walk to infinity, and every combo question waiting
behind this one — corner carry, wall bounce, juggle position — had nowhere to
be asked. The stage bounds are the first quantity this project has needed that
is in **neither dump**. MMDK gives actions, boxes, motion and hit data; it says
nothing about the ground they happen on.

Every number in the runtime so far came from the dump and was graded against
FAT. This one cannot be. The question was whether it could be borrowed honestly
instead of invented.

## Findings

### The FGC has measured it, and the measurement is in our units

The community figure is **765 units from centre stage to a corner**, published
by Tsugurific Spabobin alongside the movement dataset that the SuperCombo wiki
and Ultimate Frame Data both carry.

A borrowed number is only usable if it is in the same unit as ours, and that is
checkable without trusting anybody. The same dataset states walk speeds and dash
distances, and the dump states them too:

| | published | `data/geometry/ryu.json` |
|---|---|---|
| forward walk | 4.70 | 4.70 (`BAS_FORWARD_Loop`) |
| back walk | 3.20 | 3.20 (`BAS_BACKWARD_Loop`) |
| forward dash | 125.208 | 125.21 (`BAS_DASH_F.motion.travel.x`) |
| back dash | 92.3 | 92.30 (`BAS_DASH_B`) |
| Ken forward dash | 132.321 | 132.23 (`BAS_DASH_F`) |

Four figures to three decimal places, from a table we never read, matching
values the extractor derived from origin-motion keys. **Same ruler.** The 765 is
therefore in game units as this repo means them, and `STAGE_HALF_WIDTH = 765` is
a borrowing rather than a guess.

It is still the only number in `src/game` with no dump behind it and no grader
over it, and it is marked as such at its definition.

### The corner is not the wall — it is what the wall refuses

Clamping a position to ±765 gets a fighter who stops. It does not get a corner.
Two rules do, and both are the same rule seen twice:

- **Pushbox separation.** Off a wall, an overlap is split evenly. Against one,
  the cornered fighter has no room to give, so the whole separation goes into
  the other. That is what walks an attacker out of their own pressure.
- **Knockback.** Whatever the wall refuses the victim is handed to the attacker,
  in the direction the victim could not travel. A hit that would have pushed a
  cornered defender back pushes the attacker away by exactly as much.

Neither needs a new number. Both fall out of asking how much room is behind each
body before its own wall, which is why the corner behaviour is *derived* from
the one borrowed figure rather than tuned on top of it.

The wall stops the **pushbox**, not the origin: Ryu walked into the left corner
ends at x −732, which is −765 plus his own 33-unit pushbox half-width. That
number was not put anywhere; it is the geometry answering.

### The stage has a centre, so the match acquired one

The two fighters used to start at 0 and `gap`. With walls, absolute position
means something, so they start at ∓`gap`/2 about a centre at 0. Every distance
*between* them is unchanged and no advantage or contact result moved — but a
projectile's `x` is now a world position rather than a travel, which is a real
change to what that field means and cost one test its assertion.

### And a fireball finally dies somewhere

Retiring a shot when its leading edge reaches a wall closes ADR-0029's last open
item. Ryu's HP Hadoken travels 586 units over 70 frames, so on a full stage it
expires on its own clock before it ever reaches a corner from centre; the wall
only claims it when it is thrown from far enough out. Both endings are now real.

### The round clock is frames, and one assumption

The timer is held in frames because that is the only unit this engine has, and
converted to counts for display at **60 frames per count** — the one thing here
that is assumed rather than sourced. Nothing was found that states SF6's tick
rate; at 60 Hz with a 99-second round it is the obvious reading, and it is
isolated in a single constant so a measurement can correct it without touching
anything else.

Hitstop stops the clock. Eleven frames of freeze are eleven frames off nobody,
which is why the tick sits below the freeze check and not above it.

## Decision

Add `STAGE_HALF_WIDTH = 765` and `COUNT = 60` to `src/game/match.ts`, both
overridable per match (`stageHalfWidth`, `seconds`, `seconds: null` for untimed).

Start the fighters either side of a centre at 0. Clamp each fighter's pushbox
inside the walls, make separation and knockback transfer what a wall refuses,
retire projectiles at the walls, and end a round on KO or on time — `result`
gives the winner and how, with a health tie a draw.

The viewer draws the walls, stops the camera at them, and shows the count.

## Consequences

- `sf6 fight ryu ken "4x400"` ends `positions -732 / 100, clock 91, Ryu in the
  corner`. The 33 units of daylight are his pushbox.
- ADR-0029's headline is untouched: `sf6 fight ryu ken "2x2,3x2,6+HPx3,5x120"
  --at 350` still connects on frame 36 for 600.
- 173 tests pass. `sf6 verify` is unmoved at 93.2 / 88.7 / 94.2 / 90.1 / 81.8% —
  `src/game` is still imported by nothing the grader reads.

## Not settled

- **765 has no grader.** It is one community measurement, corroborated only by
  the unit check above. Nothing in this repo can falsify it, and an in-game
  observation should still be taken.
- **Round-start distance is unknown.** Nothing published states it, so `distance`
  still defaults to an arbitrary 200 units — now split about the centre. This is
  the same shape of gap as the stage width and was not filled by the same search.
- **60 frames per count is assumed.** See above.
- **No wall bounce, no corner-specific reactions.** A hit that would splat a
  cornered opponent in SF6 currently just stops them. Whether the dump flags
  those reactions at all is unexamined.
- **The corner does not affect throws, juggles or Drive Rush**, none of which the
  match models yet.
