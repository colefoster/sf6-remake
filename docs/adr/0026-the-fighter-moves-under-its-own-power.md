# ADR 0026 — The fighter moves under its own power, and the transitions are the first thing not in the dump

- Status: accepted
- Date: 2026-08-18
- Extends: [ADR-0005](./0005-origin-motion-from-place-and-steer-keys.md),
  [ADR-0007](./0007-scenario-player.md),
  [ADR-0025](./0025-what-to-press-and-what-a-hit-does-to-you.md)

## Context

`src/sim` plays *one action* against a passive dummy and reports a number. A
playable game needs a *fighter*: something that holds a position and a stance,
takes a direction each frame, and decides what to do about it.

ADR-0025 established that the data is not the blocker and put the motion inputs
on the triggers. This is the first module that consumes them.

## Findings

### Most of the state machine is in the dump, and the seams are not

Three of the four things a movement state machine needs are read outright:

- **Which actions exist.** `BAS_FORWARD_START/Loop/END`, `BAS_JUMP_{N,F,B}_{START,AIR,LAND}`,
  `BAS_STD_CRH`, `BAS_CRH_STD`, `BAS_DASH_F/B` — all present on all 24 fighters.
- **How long each lasts, and when it is over.** `frames` and `MarginFrame`.
  A movement action states `MarginFrame` −1 and is freely interruptible; a dash
  states 19 or 23 and holds.
- **The handover inside a family.** `BAS_FORWARD_START` carries a branch at
  frame 20 to `BAS_FORWARD_Loop`. That is the game's own number, not a guess.

What is **not** in the dump is the seam between stances: nothing says that
holding forward starts a walk. `MOVEMENT` in `src/game/index.ts` is that table,
and it is the first thing in this project asserted rather than measured. It is
kept in one literal so the assumption is visible instead of scattered.

### Branch types 0 and 47

Every ground state carries two branches: a type-0 sequential handoff and a
type-47 branch to its `_tired` twin. Type 47 is the **burnout swap** — the whole
`BAS_*_tired` family, including a visibly slower walk (846 units over 181 frames
against 531 over 114). Nothing here is in a position to take it; recording it is
the point.

Type 0 is followed **only inside a movement family**. Elsewhere a type-0 branch
is a follow-up the player has to ask for, and taking it unasked would play Ryu's
whole target combo off one button.

### An action's motion is stated from where it began, so a handover has to bank

`originAt` is relative to the action's own frame 1. Switching mid-walk without
banking what the old action had travelled makes the fighter teleport home at
every seam — and there is a seam roughly twice a second while walking.

Two boundary cases fall out of that, and both were wrong before they were
checked against the curve:

- The clock ticks one frame past the end before the handover runs, and reading
  the motion there finds nothing. A forward jump banked its entire 195-unit arc
  as zero.
- `BAS_JUMP_F_AIR` ends **23 units off the ground**: the arc stops short and
  `_LAND` is the touchdown. Banking that residue leaves the fighter a little
  higher after every jump, forever.

With both fixed, the loop reproduces the curves exactly: a forward jump peaks at
234.3 and covers 195.0, which are `travel.maxY` and `travel.x` to the decimal,
and a dash covers 125.2.

### A motion is a sequence of edges, not of frames

This is the load-bearing decision in the input reader. ADR-0025 found that the
table stores a `66` dash as wildcard-`6`-wildcard-`6`. Against a *per-frame*
history, a **held** forward satisfies that — every frame is a `6`, so all four
steps match and walking forward would dash.

Against a history of **direction changes**, it cannot: holding forward is one
entry, and the command needs two separated by something else. That single change
is the entire difference between a walk and a dash, and it makes the wildcard
steps mean what they plainly mean.

The step windows then check themselves. Ryu's dash states 8 frames per step, and
a double tap 30 frames apart does not come out — which is the command timer being
read rather than assumed.

## Decision

Add `src/game/index.ts`: a `Fighter` on a fixed 60 Hz clock with a position, a
facing, a stance and an action; `InputHistory`, an edge list that matches a
`Command` backwards from the newest edge; and `MOVEMENT`, the asserted stance
table.

Follow type-0 branches inside movement families and nowhere else. Bank the
origin at every handover, clamped to the action's own last frame. Ground the
fighter on entering a `_LAND`.

Fire neutral-group triggers whose motion the history satisfies — which at this
stage is the two dashes, since every other neutral option needs a button.

Add `sf6 walk <char> <script>`, where `6x60,5x5,9x5,5x60` is "walk forward for a
second, let go, jump forward, land".

## Consequences

- `sf6 walk ryu 6x3,5x3,6x3,5x50` prints `BAS_FORWARD_START` →
  `BAS_FORWARD_END` → `BAS_DASH_F`, ending at 139.3 units.
- 157 tests pass. Ten of them are the runtime, and none grade against FAT —
  there is no published column for how fast Ryu walks. They grade the loop
  against the dump: the walk has to cover the ground the curve states, the jump
  has to reach the height the arc states, the dash has to travel exactly
  `travel.x`, and 10,000 idle frames have to end where they started.
- Every fighter is run through a fixed sweep of all nine directions for 600
  frames and has to finish standing on the ground. That is the guard against a
  path through `MOVEMENT` reaching an action a character does not have.
- `sf6 verify` is untouched. Nothing in `src/game` is imported by the grader,
  the engine or the sim.

## Not settled

- **The stance transitions are asserted.** Holding forward starting a walk is
  the assumption; so is a walk playing its own `END` on release, and a crouch
  going through `BAS_STD_CRH` rather than snapping. Nothing grades them.
- **Burnout is visible and unreachable.** Type-47 branches and the whole
  `_tired` family are extracted and never taken, because there is no Drive gauge
  yet.
- **Charge is recognised as a wildcard.** `InputHistory` treats a charge-release
  step as satisfied by anything: how long the slot was actually held is not
  tracked, so a Sonic Boom would come out with no charge at all. Nothing
  currently fires one.
- **Facing never changes.** `BAS_TRN_STD` and `BAS_TRN_CRH` are extracted and
  unused; there is no opponent to turn toward.
- **Air control does not exist.** A jump is committed at takeoff, which is
  correct for SF6, but it also means the air stance has no options at all yet —
  no air normals, no air specials, no double jump.
- **`BAS_STD_IDLING_Loop`** is reached by a type-31 branch off the idle loop and
  is never taken here, because type 31's condition is undecoded. The fighter
  idles without fidgeting.
