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
 * Drive Impact is graded through its action name rather than a move mapping.
 * `ATK_CTA` is the same action on all 24 fighters and FAT's `HPHK` is unambiguous,
 * so the join is on identity, not on numbers — which matters, because the frames
 * are the thing under test.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { armorWindows, loadGeometry, type GeometryAction } from "../data/geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

/** Drive Impact's action, universal across the roster, and FAT's notation for it. */
const DRIVE_IMPACT_ACTION = "ATK_CTA";
const DRIVE_IMPACT_INPUT = "HPHK";

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

    // Every action we can put a notation to: the mapped moves, plus Drive Impact,
    // which FAT lists among the normals and the move mapper never matches.
    const cta = geo.actions.find((a) => a.name === DRIVE_IMPACT_ACTION);
    const targets: { input: string; action: GeometryAction | undefined; actionName: string }[] = geo.moves
      // `ATK_CTA` *is* Drive Impact by name on all 24 fighters. Where the move
      // mapper also produced an `HPHK` row it is a frame-unique guess and loses to
      // that — Jamie's lands on `SPA6_H`, which is not Drive Impact at all.
      .filter((m) => !(cta && m.input === DRIVE_IMPACT_INPUT))
      .map((m) => ({
        input: m.input,
        action: geo.actions.find((a) => a.id === m.action),
        actionName: m.actionName,
      }));
    if (cta) targets.push({ input: DRIVE_IMPACT_INPUT, action: cta, actionName: cta.name });

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
