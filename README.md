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
  engine/
    frames.ts            pure frame math (advantage, meaty, stun)
    interactions.ts      punish, gap, cancel, sequence
    index.ts             public API (the deep module)
  cli/index.ts           the `sf6` command
data/raw/SF6FrameData.json   vendored real frame data (30 characters)
tests/                   40 tests, incl. assertions against the real data
```

## Known limitations

- **Hitbox/hurtbox geometry is not modeled with real data.** Pixel-accurate box coordinates are not published anywhere in machine-readable form (only live hitbox-viewer mods). The schema (`Box`, `geometry`) is ready for them; spacing/whiff falls back to a coarse `reach` scalar. See ADR-0003.
- **Multi-hit / conditional frame values** (e.g. `"-13(-28)(-43)"`) are parsed to their first value for engine math; the full string is preserved on `move.raw`.
- **Cancel-advantage** uses the first-order model (ending = the cancelled-into move's own advantage). Exact per-cancel numbers can be supplied via `move.comboAdvantage` overrides.

## Test

```bash
npm test          # 40 tests
npm run typecheck
```
