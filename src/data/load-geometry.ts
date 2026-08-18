/**
 * Reading `data/geometry/<char>.json` off disk.
 *
 * Split out of `geometry.ts` so that module stays pure: every box, window and
 * decode helper in there has to run in a browser, where the geometry arrives as
 * a fetched object rather than a file. This half is Node's. See docs/adr/0028.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Character } from "../domain/types.js";
import type { GeometryFile } from "./geometry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "data", "geometry");

const cache = new Map<string, GeometryFile | undefined>();

export function loadGeometry(characterId: string): GeometryFile | undefined {
  if (!cache.has(characterId)) {
    // The domain model slugs punctuation to hyphens (`a-k-i`) and the extractor
    // drops it (`aki`), so five of the twenty-four fighters were reachable under
    // one spelling and not the other — and every caller treats a miss as "no
    // geometry" rather than an error. Try both.
    const path = [characterId, characterId.replace(/[^a-z0-9]/gi, "")]
      .map((id) => join(DIR, `${id}.json`))
      .find((p) => existsSync(p));
    cache.set(characterId, path ? (JSON.parse(readFileSync(path, "utf8")) as GeometryFile) : undefined);
  }
  return cache.get(characterId);
}

export function hasGeometry(character: Character): boolean {
  return loadGeometry(character.id) !== undefined;
}
