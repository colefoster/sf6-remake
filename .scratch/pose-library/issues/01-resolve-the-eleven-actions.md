# 01 — Resolve the eleven moves to their action names

Status: ready-for-human

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

## Comments

**The three specials do resolve through `geo.moves`** — under a
strength-qualified input, not the bare one. `236P`, `623P` and `214K` are not
keys in the table; `236LP`, `623LP` and `214LK` are, all `match: exact`. The
light versions are taken below; the M/H/OD siblings are the adjacent ids and
carry their own clocks.

```
5LP   ATK_5LP            #600  f39   main  3  active  4-6    margin 13
5MP   ATK_5MP            #605  f53   main  5  active  6-9    margin 20
5HP   ATK_5HP            #608  f79   main  9  active 10-14   margin 32
2LK   ATK_2LK            #635  f83   main  4  active  5-6    margin 16
2MK   ATK_2MK_Y2         #640  f58   main  7  active  8-10   margin 29
2HK   ATK_2HK            #643  f146  main  8  active  9-11   margin 34
5HK   ATK_5HK            #617  f86   main 11  active 12-15   margin 35
jHK   ATK_8HK            #656  f81   main  9  active 10-17   margin -1   airborne
236LP SPA_HADO           #900  f112  main -1  active —       margin 47   shot f16
623LP SPA_SYORYU_START   #930  f35   main  4  active  5-14   margin -1   airborne
214LK SPA_TATSUMAKI_END  #1000 f105  main 11  active 12-14   margin 46
```

### The traps, checked

**`spliceContinuations` touches none of the eleven.** It only rewrites an action
whose name ends `_H` and which branches into its own base. Ryu has two —
`ATK_2HP_H` and `ATK_4HP_H` — and neither move is on the list. Nothing in the
eleven carries a `continues`.

**Three carry a twin, and none of them is the twin ADR-0055 warns about
mid-move.** All three branch at or one frame past their last active frame, so
the base action's own clock is intact for every anchor:

| | branch | twin | type | inherits | twin margin |
|---|---|---|---|---|---|
| 5MP | f12 | `ATK_5MP(1)` #606 | SWING | **yes** | 22 (base 20) |
| 2HK | f9 | `ATK_2HK_G` #645 | GUARD | no | 29, own clock |
| 5HK | f12 | `ATK_5HK_G` #618 | GUARD | no | 22, own clock |

The two GUARD twins are **restarting** (ADR-0056): `_InheritFrameX` false,
`ActionFrame` 0. They also carry `MainFrame -1` and no hit key of their own, so
a pose file bound to one of them would resolve `start` and `neutral` and nothing
else. Blocked playback needs its own decision; it is not issue 02's.

**Two of the eleven have no `MarginFrame` at all, and this is the spec
correction.** `ATK_8HK` and `SPA_SYORYU_START` are both `-1` because recovery
belongs to the landing action — `BAS_JUMP_N_LAND(1)` #657 margin 3, and
`SPA_SYORYU_END` #938 margin 12 — reached by a `lands` handover that is
explicitly **not** inheriting. Two clocks. The spec's `neutral` and
`["recovery", t]` anchors have no frame to name in the parent action and cannot
be made to; the resolver reports them rather than inventing one.

**Hadoken has no `MainFrame` and no active window of its own.** `SPA_HADO` is a
caster: its `ShotKey` spawns `SPA_HADO PROJ` #909 on frame 16, and the fireball
owns all 70 active frames (ADR-0022). `contact` is taken from the shot frame,
which is also what `move.startup` reports; `activeEnd` is the same frame,
because the caster is never active. `margin` 47 is real, so the recovery half of
the file binds normally.

**Tatsumaki is clean.** Despite the name, there is no `SPA_TATSUMAKI_START` — the
`_END` suffix is the game's and #1000 is the whole grounded move, one clock, no
branch, no splice. The air version is a different family (`SPA_TATSUMAKI_AIR_END`
#1011, margin −1, lands into #1016) and is not on the list.
