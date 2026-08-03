/**
 * Roster registry: loads the vendored FAT data once and exposes lookups.
 *
 * Character and move lookups are forgiving: they match on id, input notation
 * (e.g. "2mk", "236p"), or name substring, case-insensitively — so the CLI
 * can accept what a player would actually type.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Character, Move } from "../domain/types.js";
import { toRoster, type FatFile } from "./fat-adapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

let cache: Character[] | undefined;

export function loadRoster(): Character[] {
  if (!cache) {
    const file = JSON.parse(readFileSync(DATA_PATH, "utf8")) as FatFile;
    cache = toRoster(file);
  }
  return cache;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findCharacter(query: string): Character | undefined {
  const roster = loadRoster();
  const q = norm(query);
  return (
    roster.find((c) => norm(c.id) === q || norm(c.name) === q) ??
    roster.find((c) => norm(c.name).includes(q) || norm(c.id).includes(q))
  );
}

/**
 * Find a move on a character by id, input notation, or name.
 * Exact matches (id / input / name) win over substring matches; among
 * substring matches the shortest name wins, which favours base normals over
 * their OD / charged variants.
 */
export function findMove(character: Character, query: string): Move | undefined {
  const q = norm(query);
  const exact = character.moves.find(
    (m) => norm(m.id) === q || norm(m.input) === q || norm(m.name) === q,
  );
  if (exact) return exact;
  const partial = character.moves
    .filter((m) => norm(m.input).includes(q) || norm(m.name).includes(q) || norm(m.id).includes(q))
    .sort((a, b) => a.name.length - b.name.length);
  return partial[0];
}

export function requireCharacter(query: string): Character {
  const c = findCharacter(query);
  if (!c) throw new Error(`Unknown character: "${query}". Try one of: ${listCharacters().join(", ")}`);
  return c;
}

export function requireMove(character: Character, query: string): Move {
  const m = findMove(character, query);
  if (!m) throw new Error(`Unknown move "${query}" for ${character.name}.`);
  return m;
}

export function listCharacters(): string[] {
  return loadRoster().map((c) => c.name);
}
