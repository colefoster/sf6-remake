# CONTEXT — SF6 Frame-Data Engine

The ubiquitous language of this project. Every type, function, and CLI verb uses these terms exactly. If code needs a concept not defined here, that's a signal: either the language is drifting (reconsider) or there's a real gap (add it here).

This engine reasons about Street Fighter 6 interactions **purely from frame data**. It does not simulate rendering, inputs, or physics. It answers questions of the form: *"if attacker does X (into Y) from scenario Z, what is the frame outcome?"*

## Frame-timeline primitives

- **Frame** — the atomic unit of time. SF6 runs at 60 fps, so 1 frame ≈ 16.67 ms. All durations are integer frames.
- **Startup** — frames from the move beginning until the **first active frame**. A move with startup `S` has its first active frame on frame `S` (1-indexed): frames `1 .. S-1` are pre-hit.
- **Active** — the number of frames during which the move's hitbox can make contact.
- **Recovery** — frames after the last active frame before the attacker is **actionable** again (can block/move/attack).
- **Total** — `startup + active + recovery`. The full duration if the move whiffs.
- **Actionable** — able to act. The frame-advantage sign is defined by who becomes actionable first.

## Advantage

- **On-block advantage (`onBlock`)** — net frames the **attacker** is ahead when the move is **blocked**, measured from the moment of contact resolution. `+` (plus) = attacker actionable first. `−` (minus) = defender actionable first.
- **On-hit advantage (`onHit`)** — the same, when the move **hits** (defender in hitstun instead of blockstun).
- **Plus / Minus** — shorthand for the sign of the ending advantage. "Ends plus" = attacker keeps their turn.
- **Blockstun / Hitstun** — frames the defender is locked in guard / hit reaction. We do **not** store these directly; we **derive** them from listed advantage (see `blockstunFrom` in `frames.ts`), which keeps the data minimal and the source-of-truth singular.

  Identity (contact on the first active frame): `onBlock = blockstun − ((active − 1) + recovery)`, therefore `blockstun = onBlock + (active − 1) + recovery`.

## Scenario modifiers

- **Meaty** — timing a move so it contacts on a **later active frame** rather than its first. Hitting `d` frames deep (on active frame `d+1`) adds `d` to both `onBlock` and `onHit`, because the attacker spends `d` fewer of its own frames after contact. `d ∈ 0 .. active−1`.
- **Point-blank / spacing** — spacing is expressed as a coarse `distance`; a move whiffs if `distance > reach`. Full per-frame hitbox/hurtbox geometry is modeled in the schema but not required for advantage math (see Data reality below).

## Interactions

- **Punish** — after a move is blocked at `−g` (so the defender is `+g`, `g = −onBlock`), a defender move `Y` **punishes** if `Y.startup ≤ g` (and it reaches). In SF6 every punish landed during an opponent's recovery is a **Punish Counter (PC)** — it deals bonus damage and extra hitstun.
- **Gap** — between two blocked moves `A` then `B` (B done as early as possible), `gap = B.startup − advantageAfter(A)`.
  - `gap ≤ 0` → **true blockstring**: uninterruptable.
  - `gap > 0` → **frame trap** of `gap` frames: a defender move with `startup ≤ gap` can contest it; a slower one gets counter-hit by `B`.
- **String / sequence** — an ordered list of moves the attacker performs. The **ending advantage** of a string equals the advantage of the **last move** in the scenario it connected (adjusted for meaty), because each earlier move's recovery is consumed by the next. The engine additionally reports every internal gap so you can see if the string is actually a true blockstring or has holes.
- **Cancel** — interrupting a move's recovery into another move (e.g. `2MK xx Hadoken`). First-order, the ending advantage is the cancelled-into move's own `onBlock`/`onHit`; exact per-cancel values can be supplied as `comboAdvantage` overrides in data when known.

## Move taxonomy

- **Normal** — a punch/kick with a directional prefix: `5` neutral, `2` down, `j` jump; strength `LP MP HP LK MK HK`. Notation like `2MK` = crouching medium kick.
- **Special** — motion input (e.g. `236P` = quarter-circle-forward punch = Hadoken).
- **Super / Super Art (SA)** — meter/level supers.
- **Throw**, **Drive Impact (DI)**, **Drive Rush (DR)** — SF6 Drive system moves; modeled as moves with their own frame data.

## Data reality (important assumption)

- **Frame data (startup/active/recovery/onBlock/onHit/damage/cancels) is real** and sourced from public frame-data references; see `docs/adr/0002-data-sourcing.md`.
- **Pixel-accurate hitbox/hurtbox geometry is NOT publicly available** in machine-readable form — it exists only as hitbox-viewer imagery. The schema (`Box`, `hitboxes`, `hurtboxes`) is therefore present and typed for future population, but spacing/whiff queries fall back to a coarse `reach` scalar. This is a deliberate, documented limitation, not an oversight.
