/**
 * The grader for armor: the dump's atemi keys checked against FAT's published
 * armor notes.
 *
 * Like `invuln.ts` this compares a frame range to a sentence, because FAT records
 * armor only in `extraInfo`. Unlike it, the field being graded has no payload in
 * the dump at all: `AtemiDataListIndex` points into an atemi table MMDK does not
 * ship, so the index says *which* armor a box has and nothing about what it does.
 * What the dump does carry is where the armor is and which hurtboxes it covers,
 * and those are the two things FAT writes down.
 *
 * Drive Impact reaches this grader through the ordinary move mapping. It did not
 * when the check was written — `HPHK` has no action name to match and the mapper's
 * frame-fingerprint fallback put it on an unrelated special — so this graded it
 * through `ATK_CTA` directly. ADR-0017 fixed the mapper instead.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { armorWindows} from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

export interface ArmorClaim {
  character: string;
  input: string;
  actionName: string;
  /** FAT's published window, and the dump's. */
  fat: [number, number];
  dump: [number, number] | undefined;
  /** How many hits of armor FAT credits the move with. */
  hits: number;
  /** The atemi table rows the dump's window is built from. */
  index: number[];
  /** FAT says a low attack goes under this armor. */
  losesToLow: boolean;
  /** The dump's window covers the leg hurtbox, so a low is absorbed too. */
  coversLeg: boolean;
  agrees: boolean;
  claim: string;
}

export interface ArmorReport {
  claims: ArmorClaim[];
  /** Window agreement, and the low-attack cross-tab that decodes `covers`. */
  totals: {
    checked: number;
    exact: number;
    within1: number
    absent: number;
    /** Claims where FAT says lows beat the armor, split by what the dump covers. */
    losesToLow: { total: number; bodyOnly: number };
    /** Claims where FAT says no such thing. */
    holdsLow: { total: number; coversLeg: number };
  };
}

interface FatMove {
  numCmd?: string;
  extraInfo?: string[];
}

/** Only the two `GeometryFile` fields this module reads beyond the actions. */
interface TriggerLike {
  action: number;
  kind?: string[];
  super?: number;
}

let fatCache: Record<string, Record<string, FatMove>> | undefined;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function fatMoves(character: string): Record<string, FatMove> {
  if (!fatCache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<
      string,
      { moves?: Record<string, Record<string, FatMove>> }
    >;
    fatCache = {};
    for (const [name, entry] of Object.entries(file)) {
      const byInput: Record<string, FatMove> = {};
      for (const category of Object.values(entry.moves ?? {})) {
        for (const move of Object.values(category)) if (move.numCmd) byInput[move.numCmd] = move;
      }
      fatCache[norm(name)] = byInput;
    }
  }
  return fatCache[norm(character)] ?? {};
}

/** `2 hits of armor on frames 1-27` — hits, window, and whether a low beats it. */
function parseArmor(line: string): { hits: number; range: [number, number]; losesToLow: boolean } | undefined {
  if (!/\bhits?\s+of\s+armor\b/i.test(line)) return undefined;
  const found = [...line.matchAll(/frames?\s+(\d+)\s*(?:[-~–]\s*(\d+))?/gi)];
  // More than one range in a sentence means two windows described at once
  // (Honda's EX Headbutt: "1 hit on frames 1-8 and then another on 9-32"), which
  // this grader has no way to attribute. Left out rather than half-matched.
  if (found.length !== 1) return undefined;
  return {
    hits: /\b(?:2|two)\s+hits/i.test(line) ? 2 : 1,
    range: [Number(found[0]![1]), Number(found[0]![2] ?? found[0]![1])],
    losesToLow: /loses to Low|hit low enough|low enough can go past|no armor on the lower body|upper[- ]body/i.test(line),
  };
}

/** Grade every published armor claim we can reach against the dump. */
export function verifyArmor(characters?: string[]): ArmorReport {
  const names = characters?.length ? characters : listCharacters();
  const claims: ArmorClaim[] = [];

  for (const name of names) {
    const geo = loadGeometry(requireCharacter(name).id);
    if (!geo) continue;
    const fat = fatMoves(geo.character);

    // Super Arts are left out: their action carries the cinematic freeze and
    // FAT's frames do not, so the two windows are not in the same frame space.
    // See ADR-0018.
    const targets = geo.moves
      .filter((m) => m.category !== "super")
      .map((m) => ({
        input: m.input,
        action: geo.actions.find((a) => a.id === m.action),
        actionName: m.actionName,
      }));

    for (const { input, action, actionName } of targets) {
      const info = fat[input]?.extraInfo;
      if (!info || !action) continue;
      const windows = armorWindows(action);
      for (const line of info) {
        const parsed = parseArmor(line);
        if (!parsed) continue;
        const dump: [number, number] | undefined = windows.length
          ? [Math.min(...windows.map((w) => w.start)), Math.max(...windows.map((w) => w.end))]
          : undefined;
        claims.push({
          character: geo.character,
          input,
          actionName,
          fat: parsed.range,
          dump,
          hits: parsed.hits,
          index: [...new Set(windows.map((w) => w.index))].sort((a, b) => a - b),
          losesToLow: parsed.losesToLow,
          coversLeg: windows.some((w) => w.covers.leg),
          agrees: !!dump && dump[0] === parsed.range[0] && dump[1] === parsed.range[1],
          claim: line,
        });
      }
    }
  }

  const totals: ArmorReport["totals"] = {
    checked: claims.length,
    exact: 0,
    within1: 0,
    absent: 0,
    losesToLow: { total: 0, bodyOnly: 0 },
    holdsLow: { total: 0, coversLeg: 0 },
  };
  for (const c of claims) {
    if (!c.dump) totals.absent++;
    else {
      if (c.agrees) totals.exact++;
      if (Math.abs(c.dump[0] - c.fat[0]) <= 1 && Math.abs(c.dump[1] - c.fat[1]) <= 1) totals.within1++;
    }
    if (!c.dump) continue;
    const bucket = c.losesToLow ? totals.losesToLow : totals.holdsLow;
    bucket.total++;
    if (c.losesToLow ? !c.coversLeg : c.coversLeg) {
      if (c.losesToLow) totals.losesToLow.bodyOnly++;
      else totals.holdsLow.coversLeg++;
    }
  }

  return { claims, totals };
}

/** Just the claims the dump does not reproduce. */
export function armorDisagreements(report: ArmorReport): ArmorClaim[] {
  return report.claims.filter((c) => !c.agrees);
}

export interface BreakRow {
  character: string;
  input: string;
  actionName: string;
  /** FAT tags the move "Armor Break". */
  published: boolean;
  /** The dump says it is a Super Art or a Drive Reversal. */
  predicted: boolean;
  agrees: boolean;
}

/**
 * Armor Break, which turns out not to be a property of a move at all.
 *
 * Nothing in the dump marks it: `ArmorPoint` on the hit-data entry is zero on all
 * 79,175 occurrences in the roster, and no other hit-data field separates the
 * moves FAT tags from the ones it doesn't. What does separate them is the move's
 * *class* — every Super Art and every Drive Reversal breaks armor, and nothing
 * else does. So this check grades FAT's tag against the dump's own classification:
 * the trigger `kind` flags ADR-0009 extracted, plus the Drive Reversal action.
 *
 * A rule rather than a flag is a real answer to "where is Armor Break stored".
 * See ADR-0017.
 */
export function verifyArmorBreak(characters?: string[]): { rows: BreakRow[]; checked: number; agreeing: number } {
  const names = characters?.length ? characters : listCharacters();
  const rows: BreakRow[] = [];

  for (const name of names) {
    const geo = loadGeometry(requireCharacter(name).id);
    if (!geo) continue;
    const fat = fatMoves(geo.character);

    const supers = new Set<number>();
    for (const trigger of Object.values(geo.triggers ?? {}) as TriggerLike[]) {
      const isSuper = (trigger.kind ?? []).some((k) => /^Lv[1-4]$/.test(k)) || (trigger.super ?? 0) > 0;
      if (isSuper) supers.add(trigger.action);
    }
    const reversals = new Set(
      geo.actions.filter((a) => /^ATK_CTA_4/.test(a.name)).map((a) => a.id),
    );

    for (const move of geo.moves) {
      const info = fat[move.input]?.extraInfo;
      if (!info) continue;
      const published = info.some((s) => /armor break/i.test(s));
      const predicted = supers.has(move.action) || reversals.has(move.action);
      rows.push({
        character: geo.character,
        input: move.input,
        actionName: move.actionName,
        published,
        predicted,
        agrees: published === predicted,
      });
    }
  }

  return { rows, checked: rows.length, agreeing: rows.filter((r) => r.agrees).length };
}
