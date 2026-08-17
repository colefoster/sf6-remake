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

Per-frame hitbox/hurtbox geometry is extracted from the game's own collision data (see [ADR-0004](./docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md)) for the characters built so far — currently **Ryu and Akuma**.

```bash
$ npm run sf6 -- boxes ryu 2mk --at 140
Ryu — Crouch MK (2MK)
  action       ATK_2MK_Y2 (#640)
  active       8-10
  vs           Ryu, standing (3 hurtboxes)
  max reach    142u
  properties   low
  at 140u      CONNECTS on frames 8-10
```

Add a character:

```bash
node scripts/fetch-mmdk.mjs Ken        # downloads MMDK's dump (gitignored)
node scripts/extract-geometry.mjs Ken  # -> data/geometry/ken.json + web/ken.boxes.json
```

### The box viewer

```bash
npm run web        # then open http://localhost:8777/boxes.html
```

Pick a move, scrub the timeline, and see every box per frame with the opponent placed at an adjustable distance — it reports which frames connect there and the furthest distance that still lands. Arrow keys step frames, space plays.

## How it works

Everything derives from a few identities documented in [`CONTEXT.md`](./CONTEXT.md):

- **Advantage** (`onBlock` / `onHit`) is the source of truth; blockstun/hitstun are derived when needed.
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
  cli/index.ts           the `sf6` command
scripts/
  fetch-mmdk.mjs         downloads MMDK's dumps of the game's collision data
  extract-geometry.mjs   dumps -> data/geometry/<char>.json (+ web copy)
  build-site.mjs         builds the normals/follow-ups page
web/
  index.html             normals: what you get off every hit state
  boxes.html             per-frame box viewer with spacing readouts
data/raw/SF6FrameData.json   vendored real frame data (30 characters)
data/geometry/<char>.json    extracted per-frame box geometry
tests/                   51 tests, incl. assertions against the real data
```

## Known limitations

- **Geometry covers Ryu and Akuma so far**, and the dumps it comes from are a late-2024 snapshot of the game — so pre-Season-3 balance. Characters without geometry fall back to FAT's coarse `reach` scalar. See [ADR-0004](./docs/adr/0004-hitbox-geometry-from-mmdk-dumps.md).
- **Pushboxes are not modeled**, so "connects" is hitbox-vs-hurtbox overlap only: it ignores the minimum distance two characters can actually stand at. Nor is per-frame character movement, so a jumping attack's boxes are the right shape at the wrong world position.
- **Multi-hit / conditional frame values** (e.g. `"-13(-28)(-43)"`) are parsed to their first value for engine math; the full string is preserved on `move.raw`.
- **Cancel-advantage** uses the first-order model (ending = the cancelled-into move's own advantage). Exact per-cancel numbers can be supplied via `move.comboAdvantage` overrides.

## Test

```bash
npm test          # 51 tests
npm run typecheck
```
