# 02 — Holding the stance

Status: `done` — ADR-0054

`Fighter.parrying`, the `_START` → `_Loop` chain walked by name the way the jump
and the walk are, the per-frame gauge tick in `regenerate`, and the release into
`DPA_STD_END`. The buttons come from the trigger next door — the parry's own
states none on all 24.

`actionable()` is false while parrying: the parry actions state `MarginFrame` −1,
which everywhere else means "leave whenever", and reading it that way made a
parried 2MK come out at −31 for a defender who could not act.
