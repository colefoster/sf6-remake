#!/usr/bin/env -S npx tsx
/**
 * sf6 — a headless Street Fighter 6 frame-data engine.
 *
 * Ask whether X into Y from scenario Z ends plus or minus, is punishable, or
 * leaves a gap. No GUI: everything is a question in, an answer out.
 */

import {
  adv,
  cancel,
  gap,
  punish,
  sequence,
  type FastestPunish,
  type PunishResult,
} from "../engine/index.js";
import { findCharacter, listCharacters, requireCharacter } from "../data/index.js";
import type { Guard } from "../engine/frames.js";

/** Format a frame number the way frame data reads: +6, -3, 0. */
function f(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function verdict(sign: string): string {
  return sign === "plus" ? "PLUS ✅" : sign === "minus" ? "MINUS ❌" : "NEUTRAL ➖";
}

interface Args {
  positional: string[];
  guard: Guard;
  meaty: number;
  by?: string;
}

function parse(argv: string[]): Args {
  const positional: string[] = [];
  let guard: Guard = "block";
  let meaty = 0;
  let by: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--on" || a === "-o") {
      const v = argv[++i];
      guard = v === "hit" ? "hit" : "block";
    } else if (a === "--meaty" || a === "-m") {
      meaty = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    } else if (a === "--by" || a === "-b") {
      by = argv[++i];
    } else if (a.startsWith("--on=")) {
      guard = a.slice(5) === "hit" ? "hit" : "block";
    } else if (a.startsWith("--meaty=")) {
      meaty = Number.parseInt(a.slice(8), 10) || 0;
    } else if (a.startsWith("--by=")) {
      by = a.slice(5);
    } else {
      positional.push(a);
    }
  }
  const args: Args = { positional, guard, meaty };
  if (by !== undefined) args.by = by;
  return args;
}

const HELP = `sf6 — Street Fighter 6 frame-data engine

USAGE
  sf6 <command> [args] [--on block|hit] [--meaty N]

COMMANDS
  characters                       List the roster.
  moves <char> [filter]            List a character's moves (optional filter).
  show <char> <move>               Full frame data for one move.
  adv <char> <move>                Advantage of a move.  --on hit  --meaty N
  seq <char> <m1> <m2> [...]       X into Y (into ...): ending advantage + gaps.
  cancel <char> <x> <y>            Cancel X into Y: legal? ending advantage?
  gap <char> <a> <b>               Gap between two blocked moves.
  punish <char> <blockedMove>      Fastest punish. --by <defenderChar> [move]

SCENARIO FLAGS
  --on block | hit   (default block)   --meaty N   (frames deep, default 0)

EXAMPLES
  sf6 adv ryu 2mk
  sf6 seq ryu 2mk 236lp --on block          # is 2MK xx Hadoken plus or minus?
  sf6 seq ryu 5mp 5mp --on block            # tight-string gap check
  sf6 cancel ryu 2mk 236hp --on hit
  sf6 punish ryu 623hp --by ken             # can Ken punish a blocked HP DP?
  sf6 gap ryu 5mp 2mk

Moves accept notation (2mk, 236lp), ids, or name fragments (hadoken, sweep).`;

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function main(): void {
  const [, , command, ...rest] = process.argv;
  const args = parse(rest);
  const p = args.positional;

  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return;

      case "characters":
        console.log(listCharacters().join("\n"));
        return;

      case "moves": {
        const c = requireCharacter(p[0] ?? fail("moves <char> [filter]"));
        const filter = p[1]?.toLowerCase();
        const rows = c.moves
          .filter((m) => !filter || m.name.toLowerCase().includes(filter) || m.input.toLowerCase().includes(filter))
          .map((m) => `  ${m.input.padEnd(14)} ${m.name}`);
        console.log(`${c.name} (${rows.length} moves)`);
        console.log(rows.join("\n"));
        return;
      }

      case "show": {
        const c = requireCharacter(p[0] ?? fail("show <char> <move>"));
        const m = c.moves.find((x) => x.id === p[1]) ?? requireCharacterMove(c, p[1]);
        console.log(`${c.name} — ${m.name} (${m.input})`);
        const line = (k: string, v: unknown) =>
          v === undefined ? undefined : `  ${k.padEnd(12)} ${v}`;
        console.log(
          [
            line("category", m.category),
            line("startup", m.startup),
            line("active", m.raw?.active ?? m.active),
            line("recovery", m.raw?.recovery ?? m.recovery),
            line("on block", m.onBlock !== undefined ? f(m.onBlock) : undefined),
            line("on hit", m.onHit !== undefined ? f(m.onHit) : m.raw?.onHit),
            m.hitReaction ? line("hit ->", m.hitReaction) : undefined,
            line("damage", m.damage ?? m.raw?.damage),
            m.cancelTags ? line("cancels", m.cancelTags.join(", ")) : undefined,
            m.reach !== undefined ? line("range", m.reach) : undefined,
            m.properties ? line("props", m.properties.join(", ")) : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      case "adv": {
        const r = adv(p[0] ?? fail("adv <char> <move>"), p[1] ?? fail("adv <char> <move>"), {
          guard: args.guard,
          meaty: args.meaty,
        });
        if (!r) return void console.log("No advantage data for that move in that state.");
        const meaty = r.meaty ? ` (meaty ${r.meaty} deep)` : "";
        console.log(`${r.move} on ${r.guard}${meaty}: ${f(r.advantage)}  ->  ${verdict(r.sign)}`);
        if (r.reaction) console.log(`  reaction: ${r.reaction}`);
        return;
      }

      case "seq": {
        const char = p[0] ?? fail("seq <char> <m1> <m2> [...]");
        const moves = p.slice(1);
        if (moves.length < 1) fail("seq needs at least one move");
        const r = sequence(char, moves, { guard: args.guard, meaty: args.meaty });
        console.log(`${r.moves.join(" -> ")}  (on ${r.guard})`);
        for (const s of r.steps) {
          if (s.connection === "cancel") {
            console.log(`  ${s.from} xx ${s.to}: CANCEL (no gap — recovery erased)`);
          } else if (!s.gap.applicable) {
            console.log(`  ${s.from} -> ${s.to}: link, gap n/a (no block data on ${s.from})`);
          } else {
            const tag = s.gap.trueBlockstring
              ? "link, TRUE (uninterruptable)"
              : `link, ${s.gap.gap}f gap — interruptible by ≤${s.gap.interruptibleBy}f moves`;
            console.log(`  ${s.from} -> ${s.to}: ${tag}`);
          }
        }
        if (r.endingAdvantage === undefined) {
          console.log(`ending: no advantage data on ${r.moves.at(-1)}`);
        } else {
          const meaty = args.meaty ? ` (meaty ${args.meaty})` : "";
          console.log(`ending advantage${meaty}: ${f(r.endingAdvantage)}  ->  ${verdict(r.endingSign!)}`);
          if (r.endingReaction) console.log(`ending reaction: ${r.endingReaction}`);
        }
        if (args.guard === "block") {
          console.log(r.trueBlockstring ? "this is a TRUE blockstring" : "this string has a gap");
        }
        return;
      }

      case "cancel": {
        const r = cancel(
          p[0] ?? fail("cancel <char> <x> <y>"),
          p[1] ?? fail("cancel <char> <x> <y>"),
          p[2] ?? fail("cancel <char> <x> <y>"),
          { guard: args.guard, meaty: args.meaty },
        );
        console.log(
          r.cancelable
            ? `cancel legal (has "${r.requiredTag}" cancel)`
            : `cancel NOT legal (needs "${r.requiredTag}" cancel)`,
        );
        if (r.endingAdvantage !== undefined) {
          console.log(`ending advantage on ${args.guard}: ${f(r.endingAdvantage)}  ->  ${verdict(r.endingSign!)}`);
        }
        if (r.endingReaction) console.log(`ending reaction: ${r.endingReaction}`);
        if (r.note) console.log(`note: ${r.note}`);
        return;
      }

      case "gap": {
        const r = gap(p[0] ?? fail("gap <char> <a> <b>"), p[1] ?? fail("gap"), p[2] ?? fail("gap"));
        if (!r.applicable) return void console.log("No on-block data for the first move.");
        console.log(
          r.trueBlockstring
            ? `gap ${r.gap}f -> TRUE blockstring (uninterruptable)`
            : `gap ${r.gap}f -> frame trap; interruptible by moves with startup ≤ ${r.interruptibleBy}f`,
        );
        return;
      }

      case "punish": {
        const attacker = p[0] ?? fail("punish <char> <blockedMove> [--by <char> [move]]");
        const blocked = p[1] ?? fail("punish <char> <blockedMove>");
        const defender = args.by ?? attacker;
        const punisher = args.by ? p[2] : p[2];
        const r = punish(attacker, blocked, defender, punisher);
        printPunish(r, defender);
        return;
      }

      default:
        fail(`unknown command "${command}". Run "sf6 help".`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function requireCharacterMove(c: ReturnType<typeof requireCharacter>, q: string | undefined) {
  const m = q ? c.moves.find((x) => x.input.toLowerCase() === q.toLowerCase() || x.name.toLowerCase().includes(q.toLowerCase())) : undefined;
  if (!m) fail(`unknown move "${q}" for ${c.name}`);
  return m;
}

function isFastest(r: PunishResult | FastestPunish): r is FastestPunish {
  return "options" in r;
}

function printPunish(r: PunishResult | FastestPunish, defender: string): void {
  if (isFastest(r)) {
    if (r.window <= 0) return void console.log(`Not punishable (${r.window <= 0 ? "not minus on block" : ""}).`);
    if (!r.best) return void console.log(`${defender} has no move fast enough to punish (window ${r.window}f).`);
    console.log(`punishable: window ${r.window}f`);
    console.log(`fastest punish by ${defender}: ${r.best.move.name} (${r.best.move.input}, ${r.best.startup}f) — PUNISH COUNTER`);
    const others = r.options.slice(1, 6).map((o) => `${o.move.name} (${o.startup}f)`);
    if (others.length) console.log(`other options: ${others.join(", ")}`);
  } else {
    if (!r.applicable) return void console.log("That move has no on-block data (can't assess punish).");
    if (!r.punishable) return void console.log(`Not punishable by that move (window ${r.window}f).`);
    console.log(`punishable: window ${r.window}f — ${r.by} lands a PUNISH COUNTER`);
  }
}

main();
