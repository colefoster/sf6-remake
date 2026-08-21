/**
 * Reading `data/poses/<char>/<move>.json` off disk.
 *
 * Split from `pose-library.ts` for the same reason `load-geometry.ts` is split
 * from `geometry.ts`: the resolver has to run in a browser, where a pose file
 * arrives as a fetched object rather than as a path. This half is Node's.
 *
 * Unlike `data/geometry/`, which is generated and gitignored, these files are
 * **authored source and are committed**. There is no script that writes them.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { PoseFile } from "../game/pose-library.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.POSES_DIR ? resolve(process.env.POSES_DIR) : join(HERE, "..", "..", "data", "poses");

export function loadPose(characterId: string, move: string): PoseFile | undefined {
  const path = [characterId, characterId.replace(/[^a-z0-9]/gi, "")]
    .map((id) => join(DIR, id, `${move}.json`))
    .find((p) => existsSync(p));
  return path ? (JSON.parse(readFileSync(path, "utf8")) as PoseFile) : undefined;
}

/** Every move a character has an authored file for, by its file name. */
export function authoredMoves(characterId: string): string[] {
  const dir = [characterId, characterId.replace(/[^a-z0-9]/gi, "")]
    .map((id) => join(DIR, id))
    .find((p) => existsSync(p));
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}
