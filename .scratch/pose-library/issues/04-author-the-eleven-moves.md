# 04 — Author the eleven moves

Status: ready-for-agent
Blocked by: 03

~50 poses, in two passes.

## Pass 1 — the agent seeds all of them

Write every pose as JSON from anatomy and from the move's own frame data. A jab
is a straight lead arm on `contact`; a sweep is a low extended rear leg; a
shoryuken rises. Fifty poses in one pass is cheap and none of it needs taste —
it needs a body plan and the phase anchors.

Render a contact sheet of the seeds so the next pass is looking at pictures
rather than reading numbers.

**Do not declare them good.** The agent's job here is coverage, not judgement.

## Pass 2 — the human corrects

Load each seed in the editor, drag what is wrong, save. Seconds per pose, not
minutes.

## The question this pass answers

Do normalised poses transfer between builds, or does Blanka need overrides? His
arms are 1.37x the roster median and Zangief stands 14% wider. Author for Ryu,
then load the same file on those two and look.

## Comments

### Pass 1 — the ten remaining moves are seeded

`2MK` shipped with ADR-0067. The other ten are now in `data/poses/ryu/`, all of
them `problems: none` against their own action, all under full extension:

| move | action | resolved frames | `overreach` |
|---|---|---|---|
| 5LP | `ATK_5LP` | 1, 2, 4, 6, 9, 13 | 0.883 |
| 5MP | `ATK_5MP` | 1, 3, 6, 9, 13, 20 | 0.885 |
| 5HP | `ATK_5HP` | 1, 5, 10, 14, 21, 32 | 0.885 |
| 2LK | `ATK_2LK` | 1, 3, 5, 6, 10, 16 | 0.811 |
| 2MK | `ATK_2MK_Y2` | 1, 5, 8, 10, 18, 29 | 0.947 *(shipped)* |
| 2HK | `ATK_2HK` | 1, 5, 9, 11, 19, 34 | 0.927 |
| 5HK | `ATK_5HK` | 1, 6, 12, 15, 23, 35 | 0.940 |
| j.HK | `ATK_8HK` | 1, 5, 10, 17 | 0.947 |
| 236LP | `SPA_HADO` | 1, 8, 16, 27, 47 | 0.866 |
| 623LP | `SPA_SYORYU_START` | 1, 3, 5, 14 | 0.866 |
| 214LK | `SPA_TATSUMAKI_END` | 1, 7, 12, 14, 25, 46 | 0.935 |

`overreach` is measured on Ryu's own `Build`; on the even build the numbers are
0.02–0.03 higher and still under 1.

Every `contact` lands on the frame the clock names — 4, 6, 10, 5, 8, 9, 12, 10,
16, 5, 12 — and each is `MainFrame + 1`, or for the hadoken `shots[0].frame`.

**The two airborne moves stop at `activeEnd`, four keys each.** `neutral` and
`["recovery", t]` do not resolve on `ATK_8HK` or `SPA_SYORYU_START`, so nothing
was authored past the last active frame and no anchor was invented to cover the
landing. The landing actions are separate files and were not written.

**Hadoken cannot carry both `contact` and `activeEnd`.** On a caster
`clockOf` takes both from the shot, so they are the same frame (16) and a file
holding both fails `resolveKeys`'s strictly-increasing check. The file uses
`start`, `["startup", 0.5]`, `contact`, `["recovery", 0.35]`, `neutral` — five
keys, not six. That is a real constraint of the format on every projectile in
the game, not a choice about this move.

### What the format made awkward

- **The shoulders are rigid.** They sit at `chest.x ± 0.133` with no rotation,
  so a two-handed thrust forward — the hadoken — cannot put both palms in the
  same place: the rear shoulder is 0.266 of stature behind the lead one and the
  arm is 0.37, so the rear hand's reachable maximum is `chest.x + 0.237`. The
  seed staggers the palms (0.50 and 0.24) rather than overreaching. A torso
  *twist* would fix it and there is no field for one.
- **A chambered limb is a stub.** A knee drawn up before a roundhouse puts the
  foot ~0.2 of stature from the hip, well inside `jointOf`'s 42% fold cap, so
  the shin and thigh together draw noticeably shorter than the bone. Honest, but
  it means a coiled key reads weaker than the extension either side of it.
- **`y = 0` in an airborne action is ambiguous.** `authoredPoseOf` puts the
  authored `y` on `originAt(action, frame).y` and never on the fighter's own
  height, so on j.HK and the shoryuken "the floor" is the action's origin rather
  than the stage. The seeds keep both feet above 0 on those two, which is the
  reading that survives either interpretation.

### Not to be taken as good

Coverage, not judgement — the seeds are an agent's guess at anatomy and the
sheets exist so pass 2 is looking at pictures. The three least trustworthy:
**5HK** and **214LK** (both lean the spine away from a rear-leg swing, and with
no torso rotation the shoulder line reads flat rather than turned), and **2HK**
(the sweep drops the pelvis to 0.20 and the head ends up very close to the
floor).

Sheets: `.scratch/pose-library/seeds/` — one PNG per move, keys at their
resolved frames, plus `_contact-summary.png` with all eleven contact poses side
by side. The scratch tooling that wrote them is in
`.scratch/pose-library/tools/` (`seed.mjs` emits the JSON, `check.ts` prints the
table above, `sheet.html` composes the sheets against the real bundle).

`npm run pose:audit` 1,233 and `npm run pose:motion` 577, unchanged. `npm test`
308 green, `tsc --noEmit` clean. The only source edit is a re-export of
`pose-library` from `src/game/browser.ts`, so a page can reach the authored
figure; nothing in the derived path was touched.
