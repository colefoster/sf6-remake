/**
 * The throw geometry, checked against FAT's published per-character stats.
 *
 * This one sits apart from `CHECKS` because a throw is not a *move* in the
 * mapping: nothing in `geo.moves` points at the `NGS` action, so the per-move
 * loop in `index.ts` has nowhere to hang it. Same shape as `verifyArmor`.
 *
 * What it establishes is a unit conversion. FAT states throw range in the same
 * unit it states walk speed in — where ADR-0030 found 4.70 units a frame, it
 * publishes throw range as `0.8` — and the dump's throw box reaches 80. The
 * factor is exactly 100 on every character that has both, which is a second,
 * independent confirmation of the ruler ADR-0030 borrowed the stage width with.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actionByName, type GeometryFile } from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

/** FAT states these in metres; the dump states everything in game units. */
export const UNITS_PER_METRE = 100;

/**
 * No offset. An earlier reading needed three units of fudge here; that was the
 * throwable box being resolved against the wrong rect table, not a convention
 * of FAT's. See ADR-0035.
 */
export const THROW_HURT_OFFSET = 0;

export interface ThrowRow {
  character: string;
  /** How far the throw's own hitbox reaches, in game units. */
  reach: number | undefined;
  /** How far the throwable hurtbox extends. */
  hurt: number | undefined;
  publishedReach: number | undefined;
  publishedHurt: number | undefined;
  reachAgrees: boolean;
  hurtAgrees: boolean;
}

export interface ThrowReport {
  rows: ThrowRow[];
  reach: { checked: number; agreeing: number };
  hurt: { checked: number; agreeing: number };
}

interface Stats {
  throwRange?: string | number;
  throwHurt?: string | number;
}

let cache: Record<string, Stats> | undefined;

function stats(character: string): Stats | undefined {
  if (!cache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<string, { stats?: Stats }>;
    cache = {};
    for (const [name, entry] of Object.entries(file)) if (entry.stats) cache[name] = entry.stats;
  }
  return cache[character];
}

const metres = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * UNITS_PER_METRE) : undefined;
};

/** How far the normal throw's hitbox reaches in front of the origin. */
export function throwReach(geo: GeometryFile): number | undefined {
  // Most of the roster calls the normal throw `NGS`; Guile splits his into
  // `NGS_6`/`NGS_4` and Zangief his into `NGS_L`/`NGS_R`. The parenthesised
  // continuations (`NGS_R(1)`) are the follow-through animation, and the
  // command grabs are `SPA_*` — neither is the throw's own reach.
  const actions = geo.actions.filter((a) => /^NGS(_[A-Z0-9]+)?$/.test(a.name));
  let reach = 0;
  for (const action of actions) {
    for (const key of action.hit) {
      if (key.kind !== "throw") continue;
      for (const box of key.boxes) reach = Math.max(reach, box.x + box.width);
    }
  }
  return reach || undefined;
}

/** How far the standing throwable hurtbox extends. */
export function throwableReach(geo: GeometryFile): number | undefined {
  const idle = actionByName(geo, "BAS_STD_Loop");
  if (!idle) return undefined;
  let reach = 0;
  for (const key of idle.hurt) for (const box of key.throw) reach = Math.max(reach, box.x + box.width);
  return reach || undefined;
}

export function verifyThrows(characters?: string[]): ThrowReport {
  const names = characters?.length ? characters : listCharacters();
  const rows: ThrowRow[] = [];
  const reach = { checked: 0, agreeing: 0 };
  const hurt = { checked: 0, agreeing: 0 };

  for (const name of names) {
    const character = requireCharacter(name);
    const geo = loadGeometry(character.id);
    if (!geo) continue;
    const published = stats(geo.character);
    const mine = throwReach(geo);
    const theirs = metres(published?.throwRange);
    const myHurt = throwableReach(geo);
    const theirHurt = metres(published?.throwHurt);

    const reachAgrees = mine !== undefined && theirs !== undefined && Math.round(mine) === theirs;
    const hurtAgrees =
      myHurt !== undefined && theirHurt !== undefined && Math.round(myHurt) + THROW_HURT_OFFSET === theirHurt;
    if (mine !== undefined && theirs !== undefined) {
      reach.checked++;
      if (reachAgrees) reach.agreeing++;
    }
    if (myHurt !== undefined && theirHurt !== undefined) {
      hurt.checked++;
      if (hurtAgrees) hurt.agreeing++;
    }
    rows.push({
      character: geo.character,
      reach: mine,
      hurt: myHurt,
      publishedReach: theirs,
      publishedHurt: theirHurt,
      reachAgrees,
      hurtAgrees,
    });
  }
  return { rows, reach, hurt };
}
