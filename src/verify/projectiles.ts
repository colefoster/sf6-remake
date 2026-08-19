/**
 * A shot's launch speed, checked against FAT's published "Projectile Speed".
 *
 * Like `verifyArmor` this grades against a sentence rather than a column — the
 * number lives in `extraInfo` — and like `verifyThrows` it establishes a unit
 * conversion: FAT's `0.055` is the dump's `5.5` units a frame, the same factor
 * of 100 that turns published throw range into game units.
 *
 * It is also the only check in the project that grades the special-move
 * *mapping* independently of frames. Ryu's four Hadoken strengths are 5.5 / 7 /
 * 8.5 / 9.5 / 12 / 14.5 across six actions with identical lengths, so a mapping
 * that lands on the wrong one is invisible to every frame-based check and
 * obvious here. See ADR-0040.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { spawnsFrom } from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

/** FAT states projectile speed as a fraction; the dump states game units a frame. */
export const UNITS_PER_PUBLISHED = 100;

export interface SpeedRow {
  character: string;
  input: string;
  shot: string;
  /** The shot action's launch velocity, in game units a frame. */
  launch: number | undefined;
  published: number | undefined;
  agrees: boolean;
}

/** How many bodies a projectile move puts in the air, against FAT's hit count. */
export interface HitCountRow {
  character: string;
  input: string;
  category: string;
  bodies: number;
  published: number;
  agrees: boolean;
}

export interface ProjectileReport {
  rows: SpeedRow[];
  speed: { checked: number; agreeing: number };
  counts: HitCountRow[];
  /** Specials only: a super's extra hits are repeats in time, not extra bodies. */
  hitCount: { checked: number; agreeing: number };
}

let cache: Record<string, Record<string, number>> | undefined;
let countCache: Record<string, Record<string, number>> | undefined;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every "2-hit OD projectile" FAT publishes, by character and input. */
function publishedCount(character: string): Record<string, number> {
  if (!countCache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<
      string,
      { moves?: Record<string, Record<string, { numCmd?: string; extraInfo?: string[] }>> }
    >;
    countCache = {};
    for (const [name, entry] of Object.entries(file)) {
      const byInput: Record<string, number> = {};
      for (const category of Object.values(entry.moves ?? {})) {
        for (const move of Object.values(category)) {
          for (const line of move.extraInfo ?? []) {
            const found = /\b(\d+)-hit\b[^.]*projectile/i.exec(line);
            // The first sentence only: a charged variant shares its `numCmd`
            // with the uncharged one and says a different number.
            if (found && move.numCmd && byInput[move.numCmd] === undefined) {
              byInput[move.numCmd] = Number(found[1]);
            }
          }
        }
      }
      countCache[norm(name)] = byInput;
    }
  }
  return countCache[norm(character)] ?? {};
}

/** Every "Projectile Speed: 0.055" FAT publishes, by character and input. */
function published(character: string): Record<string, number> {
  if (!cache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<
      string,
      { moves?: Record<string, Record<string, { numCmd?: string; extraInfo?: string[] }>> }
    >;
    cache = {};
    for (const [name, entry] of Object.entries(file)) {
      const byInput: Record<string, number> = {};
      for (const category of Object.values(entry.moves ?? {})) {
        for (const move of Object.values(category)) {
          for (const line of move.extraInfo ?? []) {
            const found = /Projectile Speed:\s*([\d.]+)/i.exec(line);
            if (found && move.numCmd) byInput[move.numCmd] = Number(found[1]);
          }
        }
      }
      cache[norm(name)] = byInput;
    }
  }
  return cache[norm(character)] ?? {};
}

/** Grade every published projectile speed against the shot action it maps to. */
export function verifyProjectiles(characters?: string[]): ProjectileReport {
  const names = characters?.length ? characters : listCharacters();
  const rows: SpeedRow[] = [];
  const counts: HitCountRow[] = [];

  for (const name of names) {
    const geo = loadGeometry(requireCharacter(name).id);
    if (!geo) continue;
    const table = published(geo.character);
    const countTable = publishedCount(geo.character);
    for (const move of geo.moves) {
      const action = geo.actions.find((a) => a.id === move.action);
      if (!action) continue;
      const shots = spawnsFrom(geo, action);
      if (!shots.length) continue;

      const theirs = table[move.input];
      if (theirs !== undefined) {
        const launch = shots[0]!.action.motion?.launch;
        rows.push({
          character: geo.character,
          input: move.input,
          shot: shots[0]!.action.name,
          launch,
          published: theirs,
          agrees: launch !== undefined && Math.abs(launch - theirs * UNITS_PER_PUBLISHED) < 0.05,
        });
      }

      const wanted = countTable[move.input];
      if (wanted !== undefined) {
        counts.push({
          character: geo.character,
          input: move.input,
          category: move.category,
          bodies: shots.length,
          published: wanted,
          agrees: shots.length === wanted,
        });
      }
    }
  }

  const specials = counts.filter((c) => c.category === "special");
  return {
    rows,
    speed: { checked: rows.length, agreeing: rows.filter((r) => r.agrees).length },
    counts,
    hitCount: { checked: specials.length, agreeing: specials.filter((c) => c.agrees).length },
  };
}
