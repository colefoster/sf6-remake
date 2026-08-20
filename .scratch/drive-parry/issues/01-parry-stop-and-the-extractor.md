# 01 — parryStop, and the gauge events beside it

Status: `done` — ADR-0054

The extractor emits `parryStop` from `ParryStopOwner`/`ParryStopTarget`, and
`gauge` from the actions' `_IsCHARA_GAUGE_ADD` events. The second was the bigger
find: one rule, three mechanics — the parry drains 50 a frame, a forward walk
regenerates 20, a throw tech refunds half a bar.
