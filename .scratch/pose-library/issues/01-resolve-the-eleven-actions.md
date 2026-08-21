# 01 — Resolve the eleven moves to their action names

Status: ready-for-agent

Eight of the eleven map by input through `geo.moves`; the three specials do not.

```
5LP  ATK_5LP      f39   startup 1-3    active 4-6    recovery 7-13
5MP  ATK_5MP      f53   startup 1-5    active 6-9    recovery 10-20
5HP  ATK_5HP      f79   startup 1-9    active 10-14  recovery 15-32
2LK  ATK_2LK      f83   startup 1-4    active 5-6    recovery 7-16
2MK  ATK_2MK_Y2   f58   startup 1-7    active 8-10   recovery 11-29
2HK  ATK_2HK     f146   startup 1-8    active 9-11   recovery 12-34
5HK  ATK_5HK      f86   startup 1-11   active 12-15  recovery 16-35
jHK  ATK_8HK      f81   startup 1-9    active 10-17  recovery — (margin -1, airborne)
236P 623P 214K    — not resolved
```

Find the action ids for hadoken, shoryuken and tatsumaki, and check each for the
traps ADR-0055/0056 record: a move that hands over to a twin, a twin that does
not share the clock, and a wind-up spliced by `spliceContinuations`.

**Deliverable:** the table above, completed, as a comment on this issue. No code.
