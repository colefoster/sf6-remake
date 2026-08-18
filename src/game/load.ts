/**
 * Node-side convenience: build a fighter or a match from a character name.
 *
 * `src/game/index.ts` and `src/game/match.ts` take the geometry itself and never
 * touch the file system, so the same code runs in the browser against the copy
 * the viewer already fetched. This is the half that knows where the files are.
 */

import { type GeometryFile } from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { requireCharacter } from "../data/index.js";
import { Fighter } from "./index.js";
import { Match, type MatchOptions } from "./match.js";

export function geometryFor(character: string): GeometryFile {
  const resolved = requireCharacter(character);
  const geo = loadGeometry(resolved.id);
  if (!geo) throw new Error(`no geometry for ${resolved.name} — run: npm run geometry`);
  return geo;
}

export function fighterFor(character: string, x = 0, facing: 1 | -1 = 1): Fighter {
  return new Fighter(geometryFor(character), x, facing);
}

export function matchFor(left: string, right: string, options: MatchOptions = {}): Match {
  return new Match(geometryFor(left), geometryFor(right), options);
}
