# sf6-engine

A **headless (CLI) Street Fighter 6 frame-data engine**. No GUI, no rendering — you ask it a question about an interaction and it answers from the real frame data.

> Can I do 2MK into Hadoken on block and stay safe? Is a blocked HP Shoryuken punishable, and by what? Is this two-move string a true blockstring or a frame trap?

Built on the community-standard **FAT** frame-data set (all 30 characters). See [`CONTEXT.md`](./CONTEXT.md) for the exact vocabulary the engine uses and [`docs/adr/`](./docs/adr) for the design decisions.

## Install

```bash
npm install
```

(If npm gates `esbuild`'s install script, run `npm approve-scripts esbuild && npm rebuild esbuild`.)

## Use

```bash
npm run sf6 -- <command> [args] [--on block|hit] [--meaty N]
# or directly:
npx tsx src/cli/index.ts <command> ...
```

### Commands

| Command | Question it answers |
|---|---|
| `adv <char> <move>` | Is this move plus or minus? |
| `seq <char> <m1> <m2> [...]` | **X into Y (into …): does it end plus or minus? True string or gap?** |
| `cancel <char> <x> <y>` | Is X xx Y a legal cancel, and what's the ending advantage? |
| `gap <char> <a> <b>` | Gap between two blocked moves — true blockstring or frame trap? |
| `punish <char> <blockedMove> [--by <char> [move]]` | Is it punishable, and by the fastest what? |
| `show <char> <move>` | Full frame data for a move. |
| `moves <char> [filter]` | List a character's moves. |
| `boxes <char> <move> [--at <units>] [--vs <char>] [--crouch]` | **Does it reach? Which frames connect at this spacing?** |
| `play <char> <move> [--at N] [--vs <char>] [--on hit] [--meaty N]` | **Play the move out frame by frame: does it connect here, and what happens?** |
| `verify [char ...]` | **Do the game's own numbers agree with the published frame data?** |
| `characters` | List the roster. |

Moves accept **notation** (`2mk`, `236lp`), **ids**, or **name fragments** (`hadoken`, `sweep`). Characters are fuzzy too (`chun`, `honda`).

### Examples

```bash
# The flagship: 2MK xx Hadoken from block — plus or minus?
$ npm run sf6 -- seq ryu 2mk 236lp --on block
Crouch MK -> LP Hadoken  (on block)
  Crouch MK xx LP Hadoken: CANCEL (no gap — recovery erased)
ending advantage: -5  ->  MINUS ❌
this is a TRUE blockstring

# Same on hit:
$ npm run sf6 -- seq ryu 2mk 236lp --on hit
ending advantage: +2  ->  PLUS ✅

# Can Ken punish a blocked HP Shoryuken?
$ npm run sf6 -- punish ryu 623hp --by ken
punishable: window 39f
fastest punish by ken: Stand LP (5LP, 4f) — PUNISH COUNTER

# Meaty timing flips a minus move plus:
$ npm run sf6 -- adv ryu 5hp --meaty 3
Stand HP on block (meaty 3 deep): +1  ->  PLUS ✅
```

### Spacing and boxes

Per-frame hitbox/hurtbox geometry is extracted from the game's own collision data (see [ADR-0004](./docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md)) for **all 24 characters MMDK dumps** — the Season 1 and 2 roster.

```bash
$ npm run sf6 -- boxes ryu 2mk --at 140
Ryu — Crouch MK (2MK)
  action       ATK_2MK_Y2 (#640)
  active       8-10
  vs           Ryu, standing (3 hurtboxes)
  point blank  66u (pushboxes touching)
  max reach    188.2u
  connects in  66-188.2u (122.2u of usable spacing)
  travels      46.2u forward at first contact, 46.2u at furthest
  damage       500 (counter 600)
  stun         23 on hit, 20 on block, 25 CH, 27 PC
  hitstop      9f attacker, 9f defender
  knockback    50u over 23f
  drive        +1000 you, +0 them
  properties   low
  at 140u      CONNECTS on frames 8-10
```

Distances are measured from where the attacker stood when the move began, so a move's reach includes its step-in — 2MK's box only covers 142 units, but Ryu walks 46 of them into it.

The stun, damage and knockback numbers are the game's own, from its hit-data table — which is also how we found that **blockstun runs 4 frames longer than on-block advantage implies** ([ADR-0006](./docs/adr/0006-hit-data.md)). Counter hit really is exactly +2 frames and punish counter +4, on every move checked.

Cancel windows come from the same dumps: which frames of a move a special can be cancelled in on, when the input starts buffering, and what the cancel opens into. They agree with FAT's published cancel column on 505 of 511 normals ([ADR-0008](./docs/adr/0008-cancel-windows.md)).

Each option carries its price, and the prices are the game's own — EX two bars of Drive, Drive Impact one, a Drive Rush cancel three, SA1/SA2/SA3 one/two/three bars of super, and a 4-frame input buffer on nearly everything ([ADR-0009](./docs/adr/0009-what-a-cancel-costs.md)).

Add a character:

```bash
node scripts/fetch-mmdk.mjs Ken        # downloads MMDK's dump (gitignored)
node scripts/extract-geometry.mjs Ken  # -> data/geometry/ken.json + web/ken.boxes.json (gitignored)
```

### The box viewer

```bash
npm run web        # then open http://localhost:8777/boxes.html
```

Pick a move, scrub the timeline, and see every box per frame with the opponent placed at an adjustable distance — it reports which frames connect there and the furthest distance that still lands. Moving actions are drawn along their real trajectory, with the travel path traced. Arrow keys step frames, space plays.

### The scenario player

Two fighters on a shared 60 fps clock. It never reads on-block or on-hit — it advances the action, finds contact by box overlap at your chosen spacing, and takes stun and knockback from the game's hit-data table. It does still read FAT's `active` and `recovery` to know when the attacker recovers, so what it proves is "the game's stun agrees with the published advantage, *given* the published active and recovery" rather than a fully independent derivation ([ADR-0010](./docs/adr/0010-the-grader.md)).

```bash
$ npm run sf6 -- play ryu 2mk --at 150
Ryu Crouch MK (2MK) vs Ryu at 150u  [ATK_2MK_Y2]
  f  8  hitbox out at 150u
  f  8  block at 150u — 0 damage, 20f stun, 9f hitstop
  f 24  defender (Ryu) can act
  f 30  attacker (Ryu) can act

BLOCKED on frame 8 — 0 damage
attacker free in 22f, defender in 16f  ->  -6  MINUS ❌
pushed to 205u (from 150u)
drive +1000 you, +2000 them
```

That −6 is derived, not looked up (with the caveat above) — and it's what the published frame data says. Across every mapped normal the sim reproduces on-block advantage on **13 of 13** of Akuma's moves and 8 of Ryu's 12, where the misses are exactly the moves whose two sources are already known to disagree ([ADR-0007](./docs/adr/0007-scenario-player.md)).

## How it works

Everything derives from a few identities documented in [`CONTEXT.md`](./CONTEXT.md):

- **Advantage** (`onBlock` / `onHit`) is the source of truth; blockstun/hitstun are derived when needed as `advantage + active + recovery`, plus 4 on block for the guard-release tail. Characters with geometry carry the game's real numbers instead.
- **Meaty** hitting `d` frames deep adds `d` to advantage.
- **Punish**: `Y` punishes `X` iff `Y.startup ≤ −X.onBlock` (and it's always a Punish Counter in SF6).
- **Gap** between blocked `A→B` is `B.startup − advantageAfter(A)`; `≤ 0` = true blockstring.
- **Cancel** (`A xx B`) erases `A`'s recovery, so the ending advantage is `B`'s own.

## Architecture

```
src/
  domain/types.ts        the vocabulary as types (Move, Character, Box…)
  data/
    fat-adapter.ts       FAT JSON  ->  domain model (parses messy real strings)
    index.ts             roster registry + fuzzy character/move lookup
    geometry.ts          per-frame boxes: reach, overlap, connect frames
  engine/
    frames.ts            pure frame math (advantage, meaty, stun)
    interactions.ts      punish, gap, cancel, sequence
    index.ts             public API (the deep module)
  verify/index.ts        the grader: dumped data vs published, imported by neither
  sim/index.ts           the scenario player: two fighters, shared clock
  cli/index.ts           the `sf6` command
scripts/
  fetch-mmdk.mjs         downloads MMDK's dumps of the game's collision data
  extract-geometry.mjs   dumps -> data/geometry/<char>.json (+ web copy)
  build-site.mjs         builds the normals/follow-ups page
web/
  index.html             normals: what you get off every hit state
  boxes.html             per-frame box viewer with spacing readouts
data/raw/SF6FrameData.json   vendored real frame data (30 characters)
data/geometry/<char>.json    per-frame boxes, origin motion, hit outcomes
tests/                   78 tests, incl. assertions against the real data
```

## Known limitations

- **Geometry covers the 24 characters MMDK dumps**, and those dumps are a late-2024 snapshot of the game — so pre-Season-3 balance. FAT's six newer characters (Alex, C.Viper, Elena, Ingrid, Mai, Sagat) have no geometry and fall back to its coarse `reach` scalar. See [ADR-0004](./docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md).
- **Motion is per action, not composed across actions.** A jump attack is its own action and doesn't inherit the arc of the jump it came from, so air normals show at ground level. See [ADR-0005](./docs/adr/0005-origin-motion-from-place-and-steer-keys.md).
- **Multi-hit / conditional frame values** (e.g. `"-13(-28)(-43)"`) are parsed to their first value for engine math; the full string is preserved on `move.raw`.
- **The dummy doesn't fight back.** The scenario player runs one move against a blocking or standing opponent; frame traps and counter hits stay with the frame-data engine (`sf6 gap`, `sf6 punish`). Cancel windows, costs and buffers are extracted now ([ADR-0008](./docs/adr/0008-cancel-windows.md), [ADR-0009](./docs/adr/0009-what-a-cancel-costs.md)) — what's missing is a policy for choosing among them, and a sim that spends the meter it can read.
- **Cancel-advantage** uses the first-order model (ending = the cancelled-into move's own advantage). Exact per-cancel numbers can be supplied via `move.comboAdvantage` overrides.

## Test

```bash
npm test          # 78 tests
npm run typecheck
```

### The grader

The project has two independent descriptions of every fighter — the game's own dumped tables and the community frame data — and every finding here landed because one could be checked against the other. `sf6 verify` makes that a standing measurement rather than a claim in a document.

```bash
$ npm run sf6 -- verify
the game's dumped data vs the published frame data

  hitstun    210/230 91.3%      the hit table's hitstun == FAT's published hitstun
  blockstun  239/256 93.4%      the hit table's blockstun == FAT's published blockstun + 4
  total      167/179 93.3%      the action's MarginFrame == FAT's published total
  cancelEnd  101/110 91.8%      the cancel window's last frame == FAT's published hit-confirm window
```

The percentages are over cleanly mapped single-hit moves; the residue is the pre-Season-3 patch skew. The most useful thing it does is let a constant be **swept** instead of asserted: the +4 guard release of [ADR-0006](./docs/adr/0006-hit-data.md) scores 93.4% at exactly +4 and under 3% at every other offset, which is a spike rather than a trend. See [ADR-0010](./docs/adr/0010-the-grader.md).
