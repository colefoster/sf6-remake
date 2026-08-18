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
import {
  actionFor,
  activeWindows,
  connectFrames,
  idleHurtboxes,
  BAR,
  cancelOptions,
  armorWindows,
  hitDataFor,
  invulnerableWindows,
  loadGeometry,
  minDistance,
  originAt,
  reach,
  type GeometryAction,
} from "../data/geometry.js";
import { runScenario, type ScenarioResult } from "../sim/index.js";
import { CHECKS, disagreements, verify } from "../verify/index.js";
import { INVULN_CHECKS, invulnDisagreements, verifyInvuln } from "../verify/invuln.js";
import { armorDisagreements, verifyArmor, verifyArmorBreak } from "../verify/armor.js";
import type { Character, Move } from "../domain/types.js";
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
  /** `boxes` only: spacing in game units, opponent character, opponent stance. */
  at?: number;
  vs?: string;
  crouch: boolean;
}

function parse(argv: string[]): Args {
  const positional: string[] = [];
  let guard: Guard = "block";
  let meaty = 0;
  let by: string | undefined;
  let at: number | undefined;
  let vs: string | undefined;
  let crouch = false;
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
    } else if (a === "--at") {
      at = Number.parseInt(argv[++i] ?? "", 10);
    } else if (a.startsWith("--at=")) {
      at = Number.parseInt(a.slice(5), 10);
    } else if (a === "--vs") {
      vs = argv[++i];
    } else if (a.startsWith("--vs=")) {
      vs = a.slice(5);
    } else if (a === "--crouch") {
      crouch = true;
    } else {
      positional.push(a);
    }
  }
  const args: Args = { positional, guard, meaty, crouch };
  if (by !== undefined) args.by = by;
  if (at !== undefined && Number.isFinite(at)) args.at = at;
  if (vs !== undefined) args.vs = vs;
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
  boxes <char> <move>              Hitbox/hurtbox geometry: reach, and which
                                   frames connect.  --at <units> --vs <char> --crouch
  verify [char ...]                Grade the game's dumped data against the
                                   published frame data. No args = whole roster.
  play <char> <move>               Run the move against a dummy frame by frame:
                                   contact, stun, knockback, who acts first.
                                   --at <units> --vs <char> --on hit --crouch --meaty N

SCENARIO FLAGS
  --on block | hit   (default block)   --meaty N   (frames deep, default 0)

EXAMPLES
  sf6 adv ryu 2mk
  sf6 seq ryu 2mk 236lp --on block          # is 2MK xx Hadoken plus or minus?
  sf6 seq ryu 5mp 5mp --on block            # tight-string gap check
  sf6 cancel ryu 2mk 236hp --on hit
  sf6 punish ryu 623hp --by ken             # can Ken punish a blocked HP DP?
  sf6 gap ryu 5mp 2mk
  sf6 boxes ryu 2mk --at 140                # does crouching MK still reach?
  sf6 boxes akuma 5hp --vs ryu --crouch     # vs a crouching Ryu's hurtboxes
  sf6 play ryu 2mk --at 150                 # does it reach, and what happens?
  sf6 play ryu 5hp --meaty 3 --on block     # meaty timing, simulated

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
        const punisher = p[2];
        const r = punish(attacker, blocked, defender, punisher);
        printPunish(r, defender);
        return;
      }

      case "play": {
        const c = requireCharacter(p[0] ?? fail("play <char> <move> [--at N] [--vs <char>]"));
        const m = requireCharacterMove(c, p[1]);
        const opts: Parameters<typeof runScenario>[2] = {
          guard: args.guard === "block",
          defenderStance: args.crouch ? "crouch" : "stand",
          meaty: args.meaty,
        };
        if (args.at !== undefined) opts.distance = args.at;
        if (args.vs !== undefined) opts.defender = args.vs;
        printScenario(runScenario(c.name, m.input, opts));
        return;
      }

      case "boxes": {
        const c = requireCharacter(p[0] ?? fail("boxes <char> <move> [--at N] [--vs <char>] [--crouch]"));
        const m = requireCharacterMove(c, p[1]);
        printBoxes(c, m, args);
        return;
      }

      case "verify": {
        const only = p.length ? p.map((q) => requireCharacter(q).name) : undefined;
        printVerification(verify(only));
        printInvulnerability(verifyInvuln(only));
        printArmor(verifyArmor(only));
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

/** Positions carry sub-unit precision; nobody needs to read it. */
const u = (n: number): string => `${Math.round(n * 10) / 10}u`;

/** [8,9,10,14] -> "8-10, 14" */
function frameRanges(frames: number[]): string {
  const spans: [number, number][] = [];
  for (const frame of frames) {
    const last = spans[spans.length - 1];
    if (last && frame === last[1] + 1) last[1] = frame;
    else spans.push([frame, frame]);
  }
  return spans.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
}

function printBoxes(character: Character, move: Move, args: Args): void {
  const geo = loadGeometry(character.id);
  if (!geo) {
    fail(
      `no geometry for ${character.name} — run: node scripts/fetch-mmdk.mjs ${character.name} && ` +
        `node scripts/extract-geometry.mjs ${character.name}`,
    );
  }
  const found = actionFor(geo, move);
  if (!found) fail(`no action mapped to ${move.input} for ${character.name}`);
  const { action, mapping } = found;

  const defender = args.vs ? requireCharacter(args.vs) : character;
  const defGeo = loadGeometry(defender.id);
  if (!defGeo) fail(`no geometry for the defender (${defender.name})`);
  const stance = args.crouch ? "crouch" : "stand";
  const opponent = idleHurtboxes(defGeo, stance);

  const windows = activeWindows(action);
  const maxReach = reach(action, opponent);
  const closest = minDistance(geo, defGeo, { defender: stance });

  console.log(`${character.name} — ${move.name} (${move.input})`);
  console.log(`  action       ${action.name} (#${action.id})`);
  console.log(`  active       ${windows.map((w) => `${w.start}-${w.end}`).join(", ") || "no hitboxes"}`);
  const invuln = (["airborne-strike", "projectile", "strike"] as const)
    .map((kind) => ({ kind, windows: invulnerableWindows(action, kind) }))
    .filter((row) => row.windows.length);
  for (const { kind, windows } of invuln) {
    console.log(`  invuln       ${windows.map((w) => `${w.start}-${w.end}`).join(", ")} to ${kind}`);
  }
  for (const w of armorWindows(action)) {
    // Which parts the armor covers is the load-bearing part: body-only armor is
    // armor a low attack goes under. See ADR-0016.
    const parts = (["head", "body", "leg"] as const).filter((p) => w.covers[p]);
    const gloss = w.covers.leg ? "" : " — a low attack goes under it";
    console.log(`  armor        ${w.start}-${w.end} on ${parts.join("+")}${gloss}`);
  }
  console.log(`  vs           ${defender.name}, ${stance}ing (${opponent.length} hurtboxes)`);
  if (closest !== undefined) console.log(`  point blank  ${u(closest)} (pushboxes touching)`);
  console.log(`  max reach    ${maxReach === undefined ? "never connects" : u(maxReach)}`);
  if (maxReach !== undefined && closest !== undefined) {
    console.log(
      `  connects in  ${Math.round(closest)}-${u(maxReach)} (${u(maxReach - closest)} of usable spacing)`,
    );
  }

  // Reach above is measured from where the attacker stood when the move began,
  // so a move that steps in covers more ground than its boxes alone suggest.
  const travel = action.motion?.travel;
  if (travel && (travel.maxX || travel.maxY)) {
    const atContact = windows.length ? originAt(action, windows[0]!.start) : { x: 0, y: 0 };
    const parts = [
      `${u(atContact.x)} forward at first contact`,
      travel.maxX ? `${u(travel.maxX)} at furthest` : null,
      travel.maxY ? `${u(travel.maxY)} up` : null,
    ].filter(Boolean);
    console.log(`  travels      ${parts.join(", ")}`);
  }

  if (mapping?.cancel) {
    const { start, end, buffer } = mapping.cancel;
    const options = cancelOptions(geo, mapping).filter((o) => !o.action.name.startsWith("ATK_"));
    const distinct = new Set(options.map((o) => o.action.id)).size;
    console.log(
      `  cancel       f${start}-${end}` +
        (buffer !== null && buffer < start ? ` (buffered from f${buffer})` : "") +
        ` into ${distinct} specials/supers`,
    );
    // Grouped by price, because "what can I afford from here" is the question.
    const free = new Set<number>();
    const drive = new Map<number, Set<number>>();
    const supers = new Set<number>();
    for (const { trigger, action } of options) {
      if (trigger.super) supers.add(trigger.super / BAR);
      else if (trigger.drive) {
        const bars = trigger.drive / BAR;
        if (!drive.has(bars)) drive.set(bars, new Set());
        drive.get(bars)!.add(action.id);
      } else free.add(action.id);
    }
    const costs = [
      free.size ? `${free.size} free` : null,
      ...[...drive].sort((a, b) => a[0] - b[0]).map(([bars, ids]) => `${ids.size} at ${bars} drive`),
      ...[...supers].sort().map((level) => `SA${level}`),
    ].filter(Boolean);
    console.log(`  costs        ${costs.join(", ")}`);
    const buffered = options[0]?.trigger.buffer;
    if (buffered) console.log(`  buffer       ${buffered}f of input buffer`);
  }

  const data = hitDataFor(geo, action);
  if (data?.hit) {
    const { hit, block, counter, punishCounter } = data;
    console.log(`  damage       ${hit.damage}${counter ? ` (counter ${counter.damage})` : ""}`);
    const stuns = [
      `${hit.stun} on hit`,
      block ? `${block.stun} on block` : null,
      counter ? `${counter.stun} CH` : null,
      punishCounter ? `${punishCounter.stun} PC` : null,
    ].filter(Boolean);
    console.log(`  stun         ${stuns.join(", ")}`);
    console.log(`  hitstop      ${hit.hitStop.owner}f attacker, ${hit.hitStop.target}f defender`);
    console.log(`  knockback    ${u(hit.knockback.x)} over ${hit.knockback.frames}f`);
    console.log(`  drive        +${hit.drive.own} you, ${hit.drive.target >= 0 ? "+" : ""}${hit.drive.target} them`);
  }

  const props = [
    action.flags.low ? "low" : null,
    action.flags.overhead ? "overhead" : null,
    action.flags.fullInvuln ? "full invuln" : action.flags.strikeInvuln ? "strike invuln" : null,
  ].filter(Boolean);
  if (props.length) console.log(`  properties   ${props.join(", ")}`);
  if (mapping.match !== "exact") {
    console.log(`  mapping      ${mapping.match} (FAT startup ${mapping.fat.startup}, geometry ${mapping.startup})`);
  }

  if (args.at !== undefined) {
    if (closest !== undefined && args.at < closest) {
      console.log(`  at ${args.at}u      IMPOSSIBLE — pushboxes stop them closer than ${closest}u`);
      return;
    }
    const frames = connectFrames(action, opponent, args.at);
    console.log(
      frames.length
        ? `  at ${args.at}u      CONNECTS on frame${frames.length > 1 ? "s" : ""} ${frameRanges(frames)}`
        : `  at ${args.at}u      WHIFFS (needs ${maxReach === undefined ? "—" : `< ${u(maxReach)}`})`,
    );
  } else if (maxReach !== undefined) {
    printReachTable(action, opponent, maxReach, closest);
  }
}

/** A quick feel for how the move's reach changes across its active frames. */
function printReachTable(
  action: GeometryAction,
  opponent: Parameters<typeof reach>[1],
  maxReach: number,
  closest: number | undefined,
): void {
  const rows: string[] = [];
  for (const key of action.hit.filter((h) => h.kind !== "proximity")) {
    const per = reach({ ...action, hit: [key] }, opponent);
    rows.push(`    frames ${key.start}-${key.end}  ${key.kind.padEnd(10)} reach ${per === undefined ? "—" : u(per)}`);
  }
  if (rows.length > 1) console.log(rows.join("\n"));
  const pointBlank = closest ?? 0;
  const max = Math.floor(maxReach);
  console.log(
    `  try:         --at ${Math.ceil(pointBlank)} (point blank) / --at ${Math.max(Math.ceil(pointBlank), max)} (max) ` +
      `/ --at ${max + 1} (whiff)`,
  );
}

function printScenario(r: ScenarioResult): void {
  console.log(`${r.attacker} ${r.move} vs ${r.defender} at ${r.distance}u  [${r.action}]`);
  if (r.note) console.log(`  note: ${r.note}`);

  for (const e of r.events) console.log(`  f${String(e.frame).padStart(3)}  ${e.detail}`);

  if (!r.contact) {
    console.log(`\nWHIFF — nothing connected at ${r.distance}u.`);
    return;
  }
  const { contact, advantage } = r;
  console.log(
    `\n${contact.type === "block" ? "BLOCKED" : "HIT"} on frame ${contact.frame}` +
      (contact.depth ? `, ${contact.depth} frame${contact.depth > 1 ? "s" : ""} deep` : "") +
      ` — ${r.damage} damage`,
  );
  if (advantage === null) {
    console.log(`defender free in ${r.defenderActionable}f; the attacker's recovery is unknown`);
  } else {
    const from = r.recoverySource === "landing" ? " (recovery from the landing)" : "";
    console.log(
      `attacker free in ${r.attackerActionable}f, defender in ${r.defenderActionable}f  ->  ` +
        `${f(advantage)}  ${verdict(signOfNumber(advantage))}${from}`,
    );
  }
  console.log(`pushed to ${r.endDistance}u (from ${r.distance}u)`);
  const gain = contact.outcome.drive;
  console.log(`drive ${gain.own >= 0 ? "+" : ""}${gain.own} you, ${gain.target >= 0 ? "+" : ""}${gain.target} them`);
}

const signOfNumber = (n: number): string => (n > 0 ? "plus" : n < 0 ? "minus" : "neutral");

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

/**
 * The grader's report: the game's own numbers against the published ones.
 *
 * Split into the clean population — an exact mapping of a single-hit move whose
 * startup already agrees — and everything else, because a disagreement only
 * means something in the first. The rest is patch skew and soft mappings that
 * ADR-0004 and ADR-0008 already report.
 */
function printVerification(report: ReturnType<typeof verify>): void {
  const pct = (t: { checked: number; agreeing: number }) =>
    t.checked ? `${t.agreeing}/${t.checked} ${((t.agreeing / t.checked) * 100).toFixed(1)}%` : "—";

  console.log("the game's dumped data vs the published frame data\n");
  for (const [check, describes] of Object.entries(CHECKS)) {
    const t = report.totals[check as keyof typeof report.totals];
    console.log(`  ${check.padEnd(10)} ${pct(t.clean).padEnd(18)} ${describes}`);
    console.log(`  ${"".padEnd(10)} ${pct(t.other).padEnd(18)} (multi-hit and soft mappings)`);
  }

  // The clean population is no longer one population — ADR-0019 let supers and the
  // Drive moves in — so the pooled figure alone hides where a check stands.
  const categories = [
    ...new Set(report.comparisons.filter((c) => c.clean).map((c) => c.category ?? "?")),
  ].sort();
  console.log("\n  by move category, clean population:");
  console.log(`    ${"".padEnd(10)} ${categories.map((c) => c.padStart(9)).join(" ")}`);
  for (const check of Object.keys(CHECKS)) {
    const cell = (cat: string) => {
      const rows = report.comparisons.filter(
        (c) => c.clean && c.check === check && (c.category ?? "?") === cat,
      );
      return rows.length ? `${rows.filter((r) => r.agrees).length}/${rows.length}` : "—";
    };
    console.log(`    ${check.padEnd(10)} ${categories.map((c) => cell(c).padStart(9)).join(" ")}`);
  }

  const worst = report.byCharacter.slice(0, 5);
  if (worst.length) {
    console.log("\n  worst agreement, clean population only:");
    for (const row of worst) console.log(`    ${row.character.padEnd(10)} ${pct(row.clean)}`);
  }

  const bad = disagreements(report, { cleanOnly: true });
  if (bad.length) {
    console.log(`\n  ${bad.length} disagreements in the clean population:`);
    for (const c of bad.slice(0, 40)) {
      console.log(
        `    ${c.character.padEnd(9)} ${c.input.padEnd(16)} ${c.check.padEnd(10)} ` +
          `dump ${String(c.dump).padStart(3)} vs published ${String(c.fat).padStart(3)}  (${c.actionName})`,
      );
    }
    if (bad.length > 40) console.log(`    ... and ${bad.length - 40} more`);
  }
}

/**
 * The invulnerability grader, which compares frame ranges to FAT's prose rather
 * than numbers to a column, because prose is the only place FAT records it.
 */
function printInvulnerability(report: ReturnType<typeof verifyInvuln>): void {
  const pct = (n: number, of: number) => (of ? `${n}/${of} ${((n / of) * 100).toFixed(1)}%` : "—");

  console.log("\n\nper-frame invulnerability vs the published notes\n");
  for (const [kind, describes] of Object.entries(INVULN_CHECKS)) {
    const t = report.totals[kind as keyof typeof report.totals];
    console.log(`  ${kind.padEnd(16)} ${pct(t.exact, t.checked).padEnd(18)} ${describes}`);
    console.log(
      `  ${"".padEnd(16)} ${pct(t.within1, t.checked).padEnd(18)} (within a frame; ${t.absent} not in the dump at all)`,
    );
  }

  const bad = invulnDisagreements(report);
  if (bad.length) {
    console.log(`\n  ${bad.length} claims the dump does not reproduce:`);
    for (const c of bad.slice(0, 30)) {
      const got = c.dump ? `${c.dump[0]}-${c.dump[1]}` : "absent";
      console.log(
        `    ${c.character.padEnd(9)} ${c.input.padEnd(16)} ${c.kind.padEnd(16)} ` +
          `published ${`${c.fat[0]}-${c.fat[1]}`.padStart(7)} vs dump ${got.padStart(7)}`,
      );
    }
    if (bad.length > 30) console.log(`    ... and ${bad.length - 30} more`);
  }
}

/**
 * The armor grader. `AtemiDataListIndex` points into a table the dump does not
 * ship, so what is checkable is where the armor is and what it covers — and both
 * are what FAT writes down.
 */
function printArmor(report: ReturnType<typeof verifyArmor>): void {
  const { totals } = report;
  const pct = (n: number, of: number) => (of ? `${n}/${of} ${((n / of) * 100).toFixed(1)}%` : "—");

  console.log("\n\narmor vs the published notes\n");
  console.log(`  window       ${pct(totals.exact, totals.checked).padEnd(18)} the atemi keys' frames == FAT's published armor window`);
  console.log(
    `  low beats it ${pct(totals.losesToLow.bodyOnly, totals.losesToLow.total).padEnd(18)} FAT says a low goes under it == the window skips the leg box`,
  );
  console.log(
    `  low does not ${pct(totals.holdsLow.coversLeg, totals.holdsLow.total).padEnd(18)} FAT says nothing == the window covers the leg box`,
  );
  // Armor Break has no field at all: it is what supers and Drive Reversals do.
  const brk = verifyArmorBreak();
  console.log(
    `  armor break  ${pct(brk.agreeing, brk.checked).padEnd(18)} FAT's "Armor Break" tag == the move is a super or a Drive Reversal`,
  );

  const bad = armorDisagreements(report);
  if (bad.length) {
    console.log(`\n  ${bad.length} claims the dump does not reproduce:`);
    for (const c of bad) {
      const got = c.dump ? `${c.dump[0]}-${c.dump[1]}` : "absent";
      console.log(
        `    ${c.character.padEnd(9)} ${c.input.padEnd(14)} published ${`${c.fat[0]}-${c.fat[1]}`.padStart(7)} vs dump ${got.padStart(7)}  (${c.actionName})`,
      );
    }
  }
}
