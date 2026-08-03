/**
 * Adapter: FAT (Frame Assistant Tool) JSON  ->  our domain model.
 *
 * The vendored source (data/raw/SF6FrameData.json) is the community-standard
 * frame-data set that powers fullmeter.com/fatonline. See
 * docs/adr/0002-data-sourcing.md for provenance and licensing.
 *
 * FAT stores many fields as human strings ("11(13)", "21+12", "KD +40",
 * "2(13)2"). This adapter parses the leading integer for engine use while
 * preserving the raw string on `move.raw` so nothing is silently lost.
 */

import type { Character, Move, MoveCategory } from "../domain/types.js";

interface FatMove {
  moveName?: string;
  plnCmd?: string;
  numCmd?: string;
  startup?: number | string | null;
  active?: number | string | null;
  recovery?: number | string | null;
  onHit?: number | string | null;
  onBlock?: number | string | null;
  onPC?: number | string | null;
  dmg?: number | string | null;
  range?: number | null;
  xx?: string[];
  moveType?: string;
  extraInfo?: string[];
}

type FatCharacter = { moves?: Record<string, Record<string, FatMove>> };
export type FatFile = Record<string, FatCharacter>;

/** Extract the first signed integer from a FAT value, or undefined. */
export function firstInt(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const m = v.match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : undefined;
}

const KNOCKDOWN_TOKENS: { re: RegExp; reaction: NonNullable<Move["hitReaction"]> }[] = [
  { re: /HKD/i, reaction: "hard-knockdown" },
  { re: /\bKD\b/i, reaction: "knockdown" },
  { re: /Crumple/i, reaction: "crumple" },
  { re: /Tumble|Wall|WB/i, reaction: "wall-bounce" },
  { re: /Launch|Juggle/i, reaction: "launch" },
];

function reactionOf(v: number | string | null | undefined): Move["hitReaction"] | undefined {
  if (typeof v !== "string") return undefined;
  for (const { re, reaction } of KNOCKDOWN_TOKENS) if (re.test(v)) return reaction;
  return undefined;
}

const CATEGORY: Record<string, MoveCategory> = {
  normal: "normal",
  special: "special",
  super: "super",
  throw: "throw",
  drive: "drive",
  taunt: "taunt",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toMove(fat: FatMove, usedIds: Set<string>): Move | null {
  const name = fat.moveName?.trim();
  if (!name) return null;

  // Prefer numpad input for the id; fall back to name. Ensure uniqueness.
  let id = slug(fat.numCmd || name);
  if (!id || usedIds.has(id)) id = slug(name);
  let candidate = id;
  let n = 2;
  while (usedIds.has(candidate)) candidate = `${id}-${n++}`;
  id = candidate;
  usedIds.add(id);

  const startup = firstInt(fat.startup);
  const active = firstInt(fat.active) ?? 0; // projectiles have no active window
  const recovery = firstInt(fat.recovery);
  const onBlock = firstInt(fat.onBlock);
  const onHit = firstInt(fat.onHit);
  const damage = firstInt(fat.dmg);
  const hitReaction = reactionOf(fat.onHit);

  const properties: string[] = [];
  if (firstInt(fat.active) === undefined && fat.active == null) properties.push("projectile");
  const num = fat.numCmd ?? "";
  if (/\bPP\b|KK|OD/i.test(fat.moveName ?? "") || /PP$|KK$/.test(num)) properties.push("od");

  const raw: NonNullable<Move["raw"]> = {};
  const keep = (k: keyof NonNullable<Move["raw"]>, v: unknown) => {
    if (typeof v === "string") raw[k] = v;
  };
  keep("startup", fat.startup);
  keep("active", fat.active);
  keep("recovery", fat.recovery);
  keep("onBlock", fat.onBlock);
  keep("onHit", fat.onHit);
  keep("damage", fat.dmg);

  const move: Move = {
    id,
    name,
    input: fat.numCmd || fat.plnCmd || name,
    category: CATEGORY[fat.moveType ?? "normal"] ?? "normal",
    startup: startup ?? 0,
    active,
    recovery: recovery ?? 0,
  };
  if (onBlock !== undefined) move.onBlock = onBlock;
  if (onHit !== undefined) move.onHit = onHit;
  if (damage !== undefined) move.damage = damage;
  if (hitReaction) move.hitReaction = hitReaction;
  if (fat.xx && fat.xx.length) move.cancelTags = [...fat.xx];
  if (typeof fat.range === "number") move.reach = fat.range;
  if (properties.length) move.properties = properties;
  if (Object.keys(raw).length) move.raw = raw;
  move.source = "FAT (D4RKONION/FAT) SF6FrameData.json";

  return move;
}

/** Convert one FAT character entry into our Character. */
export function toCharacter(id: string, fat: FatCharacter): Character {
  const usedIds = new Set<string>();
  const moves: Move[] = [];
  const groups = fat.moves ?? {};
  for (const group of Object.values(groups)) {
    for (const fatMove of Object.values(group)) {
      const m = toMove(fatMove, usedIds);
      if (m) moves.push(m);
    }
  }
  return { id: slug(id), name: id, moves };
}

/** Convert the whole FAT file into our roster. */
export function toRoster(file: FatFile): Character[] {
  return Object.entries(file).map(([name, char]) => toCharacter(name, char));
}
