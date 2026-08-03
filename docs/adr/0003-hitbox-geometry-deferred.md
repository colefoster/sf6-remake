# ADR 0003 — Hitbox/hurtbox geometry is modeled but not populated

- Status: accepted
- Date: 2026-08-03

## Context

The original goal mentioned using "hitbox and hurtbox data from the real game."
Spacing questions (does this reach? whiff punish? crossup?) genuinely need
per-frame box geometry.

## Decision

Model geometry in the schema (`Box`, `Geometry`, `Move.geometry`) but ship with
it **unpopulated**, because pixel-accurate box coordinates for SF6 are not
available anywhere in machine-readable form.

## Findings (why)

- The only source of true SF6 box geometry is
  **[WistfulHopes/SF6Mods](https://github.com/WistfulHopes/SF6Mods)**, a mod that
  renders hitboxes/hurtboxes/pushboxes live from game memory at runtime.
- It does **not** export per-frame coordinates to a file. Ultimate Frame Data's
  hitbox GIFs are screen-captures of that mod, not data.
- So geometry exists only as live-rendered visuals. Obtaining coordinates would
  mean extending that mod to dump them per move per frame — a separate project.

## Consequences

- Frame/advantage/punish/gap/cancel queries are fully supported (they don't need
  geometry).
- Spacing/whiff queries fall back to a coarse `reach` scalar (FAT's `range`
  field), which is enough to flag obvious whiffs but not exact hurtbox overlap.
- If someone later dumps real box coordinates, they drop straight into
  `Move.geometry` with no schema change, and spacing queries can be built on top.
