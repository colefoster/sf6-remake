# CONTEXT — SF6 Frame-Data Engine

The ubiquitous language of this project. Every type, function, and CLI verb uses these terms exactly. If code needs a concept not defined here, that's a signal: either the language is drifting (reconsider) or there's a real gap (add it here).

This engine reasons about Street Fighter 6 interactions **purely from frame data**. It does not simulate rendering, inputs, or physics. It answers questions of the form: *"if attacker does X (into Y) from scenario Z, what is the frame outcome?"*

## Frame-timeline primitives

- **Frame** — the atomic unit of time. SF6 runs at 60 fps, so 1 frame ≈ 16.67 ms. All durations are integer frames.
- **Startup** — frames from the move beginning until the **first active frame**. A move with startup `S` has its first active frame on frame `S` (1-indexed): frames `1 .. S-1` are pre-hit.
- **Active** — the number of frames during which the move's hitbox can make contact.
- **Recovery** — frames after the last active frame before the attacker is **actionable** again (can block/move/attack).
- **Total** — `startup + active + recovery - 1`. The full duration if the move whiffs. The `- 1` is because startup already counts the first active frame: a 4-startup, 3-active, 7-recovery normal occupies frames 1-13, not 1-14. This is what FAT publishes as `total` and what the game stores as an action's `MarginFrame`.
- **Actionable** — able to act. The frame-advantage sign is defined by who becomes actionable first.

## Advantage

- **On-block advantage (`onBlock`)** — net frames the **attacker** is ahead when the move is **blocked**, measured from the moment of contact resolution. `+` (plus) = attacker actionable first. `−` (minus) = defender actionable first.
- **On-hit advantage (`onHit`)** — the same, when the move **hits** (defender in hitstun instead of blockstun).
- **Plus / Minus** — shorthand for the sign of the ending advantage. "Ends plus" = attacker keeps their turn.
- **Blockstun / Hitstun** — frames the defender is locked in guard / hit reaction. Where a character has extracted geometry these are **real** (the game's hit-data table); elsewhere they are **derived** from listed advantage by `stunFrom` in `frames.ts`.

  Identity (contact on the first active frame): `stun = advantage + active + recovery`, plus **4 more when blocking** — see **Guard release**.
- **Guard release** — the last 4 frames of blockstun, which the defender can already act out of. It is why blockstun exceeds what on-block advantage implies while hitstun matches it exactly. Verified against the game's hit-data table; see `docs/adr/0006-hit-data.md`.

## Scenario modifiers

- **Meaty** — timing a move so it contacts on a **later active frame** rather than its first. Hitting `d` frames deep (on active frame `d+1`) adds `d` to both `onBlock` and `onHit`, because the attacker spends `d` fewer of its own frames after contact. `d ∈ 0 .. active−1`.
- **Point-blank / spacing** — spacing is a **distance** in game units between the two characters' origins. A move connects at a distance when one of its hitboxes overlaps one of the defender's hurtboxes there (see Geometry below). Where geometry is missing, spacing falls back to the coarse `reach` scalar: a whiff if `distance > reach`.

## Interactions

- **Punish** — after a move is blocked at `−g` (so the defender is `+g`, `g = −onBlock`), a defender move `Y` **punishes** if `Y.startup ≤ g` (and it reaches). In SF6 every punish landed during an opponent's recovery is a **Punish Counter (PC)** — it deals bonus damage and extra hitstun.
- **Gap** — between two blocked moves `A` then `B` (B done as early as possible), `gap = B.startup − advantageAfter(A)`.
  - `gap ≤ 0` → **true blockstring**: uninterruptable.
  - `gap > 0` → **frame trap** of `gap` frames: a defender move with `startup ≤ gap` can contest it; a slower one gets counter-hit by `B`.
- **String / sequence** — an ordered list of moves the attacker performs. The **ending advantage** of a string equals the advantage of the **last move** in the scenario it connected (adjusted for meaty), because each earlier move's recovery is consumed by the next. The engine additionally reports every internal gap so you can see if the string is actually a true blockstring or has holes.
- **Cancel** — interrupting a move's recovery into another move (e.g. `2MK xx Hadoken`). First-order, the ending advantage is the cancelled-into move's own `onBlock`/`onHit`; exact per-cancel values can be supplied as `comboAdvantage` overrides in data when known.

## Geometry

- **Box** — an axis-aligned rectangle in **game units**: `x = 0` is the character origin, `y = 0` the ground, `+x` forward. A fighter is roughly 166 units tall.
- **Hitbox** — a box that, while active, can make contact. **Hurtbox** — a box that can be hit, split into `head` / `body` / `leg` and a separate throwable box. **Proximity box** — triggers the defender's guard animation without hitting.
- **Attack kind** — how an incoming attack presents itself to a hurtbox: `strike`, `projectile`, or `airborne-strike` (a strike from an opponent off the ground). A hurtbox answers to some and not others, and the two mechanisms are separate: `TypeFlag` is what the box responds to at all, `Immune` is what it shrugs off on top. See `docs/adr/0014-per-frame-invulnerability.md`.
- **Invulnerability** — a *box* declining a kind of attack is not the *fighter* being invincible. A strike-invincible limb extension sits beside an ordinary body box that can still be hit; `invulnerableWindows` reports only frames where every live box declines.
- **Action** — the game's own unit of animation + collision (`ATK_2MK_Y2`, `SPA_SYORYU_START`). A **move** in this engine's sense maps onto an action; the mapping carries a **match quality** (`exact`, `close`, `frame-unique`, `weak`).
- **Reach** — the furthest distance at which a move's hitboxes still overlap the defender's hurtboxes. Distinct from FAT's coarse `range` scalar, which `Move.reach` holds as a fallback.
- **Pushbox** — the box that stops two characters occupying the same space. One per frame, by stance: standing, crouching, airborne, plus per-move overrides (a Shoryuken's pushbox rises with it).
- **Point blank** — the closest two characters' origins can be: the distance at which their pushboxes touch (66 units for two standing fighters). Spacing below this is unreachable in game, not merely unlikely.
- **Connect** — a hitbox overlapping a hurtbox at a given distance, on a given frame.
- **Usable spacing** — the band from point blank out to a move's reach. This is the honest answer to "how much room does this button cover".
- **Origin motion** — the per-frame path the character origin travels during an action (a dash's 125 units, a jump's arc, 2MK's 46-unit step-in). Boxes hang off the origin, so spacing is measured from where the attacker stood **when the move began**. See `docs/adr/0005-origin-motion-from-place-and-steer-keys.md`.

## Simulation

- **Scenario** — one attacking move played out against a dummy at a chosen distance and stance, frame by frame. The **scenario player** (`src/sim`) resolves contact from box overlap and outcome from the hit-data table, never from listed advantage — so its answer can be checked against the published number rather than assuming it.
- **Contact frame** — the frame a hitbox first overlaps a hurtbox. **Depth** is how far into the active window that happened; depth 0 is the first active frame, and depth `d` is a meaty `d` frames deep.
- **Actionable-first** — the sim's version of advantage: `defenderActionable − attackerActionable`, both counted from the contact frame.

## Move taxonomy

- **Normal** — a punch/kick with a directional prefix: `5` neutral, `2` down, `j` jump; strength `LP MP HP LK MK HK`. Notation like `2MK` = crouching medium kick.
- **Special** — motion input (e.g. `236P` = quarter-circle-forward punch = Hadoken).
- **Super / Super Art (SA)** — meter/level supers.
- **Throw**, **Drive Impact (DI)**, **Drive Rush (DR)** — SF6 Drive system moves; modeled as moves with their own frame data.

## Data reality (important assumption)

- **Frame data (startup/active/recovery/onBlock/onHit/damage/cancels) is real** and sourced from public frame-data references; see `docs/adr/0002-data-sourcing.md`.
- **Hitbox/hurtbox geometry is real** for the characters extracted so far, taken from MMDK's dumps of the game's own collision data; see `docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md`. It is keyed by **action**, and moves reach it through the mapping described above.
- **Origin motion IS modeled** per action, so reach includes a move's step-in. What is not composed is motion across actions: a jump attack is its own action and does not inherit the arc of the jump it was performed from.
