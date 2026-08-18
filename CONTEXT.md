# Context — the SF6 frame-data engine vocabulary

The ubiquitous language of this project. Every type, function, and command-line interface (CLI) verb uses these terms exactly. If code needs a concept not defined here, then that's a signal: either the language is drifting (reconsider) or there's a real gap (add the concept here).

This engine reasons about Street Fighter 6 (SF6) interactions **purely from frame data**. It does not simulate rendering, inputs, or physics. It answers questions of the form: *"if attacker does X (into Y) from scenario Z, what is the frame outcome?"*

## Frame-timeline primitives

- **Frame** — the atomic unit of time. SF6 runs at 60 frames per second (fps), so 1 frame ≈ 16.67 ms. All durations are integer frames.
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
- **Point-blank / spacing** — spacing is a **distance** in game units between the two characters' origins. A move connects at a distance when one of its hitboxes overlaps one of the defender's hurtboxes there (see the Geometry section). Where geometry is missing, spacing falls back to the coarse `reach` scalar: a whiff if `distance > reach`.

## Interactions

- **Punish** — after a move is blocked at `−g` (so the defender is `+g`, `g = −onBlock`), a defender move `Y` **punishes** if `Y.startup ≤ g` and `Y` reaches. In SF6 every punish landed during an opponent's recovery is a **Punish Counter (PC)** — a punish counter deals bonus damage and extra hitstun.
- **Gap** — between two blocked moves `A` then `B` (B done as early as possible), `gap = B.startup − advantageAfter(A)`.
  - `gap ≤ 0` → **true blockstring**: uninterruptable.
  - `gap > 0` → **frame trap** of `gap` frames: a defender move with `startup ≤ gap` can contest it; a slower one gets counter-hit by `B`.
- **String / sequence** — an ordered list of moves the attacker performs. The **ending advantage** of a string equals the advantage of the **last move** in the scenario it connected (adjusted for meaty), because each earlier move's recovery is consumed by the next. The engine also reports every internal gap, so you can see whether the string is a true blockstring or has holes.
- **Cancel** — interrupting a move's recovery into another move (for example, `2MK xx Hadoken`). First-order, the ending advantage is the `onBlock` or `onHit` of the canceled-into move. You can supply exact per-cancel values as `comboAdvantage` overrides in data when you know them.

## Geometry

- **Box** — an axis-aligned rectangle in **game units**: `x = 0` is the character origin, `y = 0` the ground, `+x` forward. A fighter is roughly 166 units tall.
- **Hitbox** — a box that, while active, can make contact. **Hurtbox** — a box that can be hit, split into `head` / `body` / `leg` and a separate throwable box. **Proximity box** — triggers the defender's guard animation without hitting.
- **Attack kind** — how an incoming attack presents itself to a hurtbox: `strike`, `projectile`, or `airborne-strike` (a strike from an opponent off the ground). A hurtbox answers to some kinds and not others, and the two mechanisms are separate: `TypeFlag` is what the box responds to at all, and `Immune` is what the box ignores on top of that. See `docs/adr/0014-per-frame-invulnerability.md`.
- **Freeze** — the cinematic pause a Super Art or Drive move opens with, in frames, from the action's `WorldKey` timer. The action's own timeline includes it and the published frame data does not, so the two differ by `freeze - 1` — the minus one is the frame they share. `inFatFrames` is the conversion. See `docs/adr/0019-the-super-freeze-is-in-the-dump.md`.
- **Armor** — a hurtbox that absorbs a hit instead of taking it, for a stretch of frames. Applied **per hurtbox**, which is why body-only armor loses to a low attack: the leg box never had armor on it. See `docs/adr/0016-armor-is-per-hurtbox.md`.
- **Invulnerability** — a *box* declining a kind of attack is not the *fighter* being invincible. A strike-invincible limb extension sits beside an ordinary body box that can still be hit; `invulnerableWindows` reports only frames where every live box declines.
- **Full invulnerability** — frames on which the action carries **no hurtbox at all**. There is no flag for it, and it's what FAT means by "fully invincible on frames A-B": a Super Art's cinematic, an EX reversal's start-up, and one target combo all work this way. `fullyInvulnerableWindows` reports them, in the action's own frames. See `docs/adr/0020-full-invulnerability-is-the-absence-of-a-hurtbox.md`.
- **Action** — the game's own unit of animation + collision (`ATK_2MK_Y2`, `SPA_SYORYU_START`). A **move** in this engine's sense maps onto an action; the mapping carries a **match quality** (`exact`, `close`, `frame-unique`, `weak`).
- **Trigger** — one way into an action: what it costs, how long the input buffers, and the game's own classification of the move (`_IsLv2` for a Super Art's level, `_IsSpecial_3` + `_IsHeavy` for a special's family and strength). The triggers are how supers and specials reach their actions at all — their action names are Japanese move names that match no notation. See `docs/adr/0021-specials-map-through-the-triggers.md`.
- **Spawn / projectile** — a fireball is its own action, thrown by the move rather than part of it. The parent's `ShotKey` says which action, on which frame, and at what offset from the origin; that frame is the move's **startup**, which is why a projectile special has no hitbox of its own. `spawnsFrom` reads them. See `docs/adr/0022-a-fireballs-startup-is-the-frame-it-spawns-on.md`.
- **Move family** — the three or four strengths of one special (`236LP/MP/HP/PP`), which the dump numbers `Special_<n>` and FAT writes as one motion with different buttons. Specials are mapped a family at a time, because three startups agreeing at once is a fingerprint one startup is not.
- **Reach** — the furthest distance at which a move's hitboxes still overlap the defender's hurtboxes. Distinct from FAT's coarse `range` scalar, which `Move.reach` holds as a fallback.
- **Pushbox** — the box that stops two characters occupying the same space. One per frame, by stance: standing, crouching, airborne, plus per-move overrides (a Shoryuken's pushbox rises with it).
- **Point blank** — the closest two characters' origins can be: the distance at which their pushboxes touch (66 units for two standing fighters). Spacing closer than point blank is unreachable in game, not merely unlikely.
- **Connect** — a hitbox overlapping a hurtbox at a given distance, on a given frame.
- **Usable spacing** — the band from point blank out to a move's reach. This is the honest answer to "how much room does this button cover".
- **Origin motion** — the per-frame path the character origin travels during an action (a dash's 125 units, a jump's arc, 2MK's 46-unit step-in). Boxes hang off the origin, so spacing is measured from where the attacker stood **when the move began**. See `docs/adr/0005-origin-motion-from-place-and-steer-keys.md`.

## Simulation

- **Scenario** — one attacking move played out against a training dummy at a chosen distance and stance, frame by frame. The **scenario player** (`src/sim`) resolves contact from box overlap and outcome from the hit-data table, never from listed advantage — so you can check its answer against the published number rather than assuming the two agree.
- **Contact frame** — the frame a hitbox first overlaps a hurtbox. **Depth** is how far into the active window that happened; depth 0 is the first active frame, and depth `d` is a meaty `d` frames deep.
- **Actionable-first** — the sim's version of advantage: `defenderActionable − attackerActionable`, both counted from the contact frame.
- **Projectile actor** — a fireball the sim plays as a second body: spawned by the parent's `ShotKey`, on its own clock, travelling on its own motion, carrying its own hit data. Its advantage is therefore a **curve, not a number** — every frame it spends in the air is a frame of the thrower's recovery already spent. FAT publishes one number, and that number is the advantage **8 frames after the shot appears** (`PROJECTILE_CONTACT` in `src/verify`) — but only for a shot that travels; a stationary one is measured on contact like anything else. That is a convention of FAT's, not a mechanic, which is why it lives in the grader. A travelling *attacker* has no such offset: it carries its own recovery with it, so its first active frame is the first frame it can connect on. See `docs/adr/0023-the-sim-throws-a-fireball.md`.

## Move taxonomy

- **Normal** — a punch/kick with a directional prefix: `5` neutral, `2` down, `j` jump; strength `LP MP HP LK MK HK`. Notation like `2MK` = crouching medium kick.
- **Special** — motion input (for example, `236P` = quarter-circle-forward punch = Hadoken).
- **Super / Super Art (SA)** — meter and level supers.
- **Throw**, **Drive Impact (DI)**, **Drive Rush (DR)** — SF6 Drive system moves; modeled as moves with their own frame data.

## Data reality

The engine rests on the following assumptions about its sources:

- **Frame data (startup, active, recovery, onBlock, onHit, damage, and cancels) is real** and sourced from public frame-data references; see `docs/adr/0002-data-sourcing.md`.
- **Hitbox and hurtbox geometry is real** for the characters extracted so far, taken from the Modding Dev Kit (MMDK) dumps of the game's own collision data; see `docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md`. Geometry is keyed by **action**, and moves reach it through the mapping described in the Geometry section.
- **Origin motion is modeled** per action, so reach includes a move's step-in. What is not composed is motion across actions: a jump attack is its own action and does not inherit the arc of the jump it was performed from.
