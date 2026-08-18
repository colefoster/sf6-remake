/**
 * The runtime's browser entry point.
 *
 * `scripts/build-play.mjs` bundles this to `web/play.js`, so the viewer runs the
 * *same* state machine, input reader and contact resolution as `sf6 fight`
 * rather than a second implementation of them. Nothing here may reach the file
 * system: geometry arrives as the `<char>.boxes.json` the page fetched.
 */

export { Fighter, InputHistory, NEUTRAL, lean } from "./index.js";
export type { Button, Direction, FighterState, InputFrame, Stance } from "./index.js";
export { COUNT, Match, STAGE_HALF_WIDTH, hold, projectileBoxes, reactionFor } from "./match.js";
export type { Contact, Hit, MatchOptions, Projectile, Result } from "./match.js";
export {
  activeWindows,
  hitboxesAt,
  hurtboxesAt,
  originAt,
  pushboxesAt,
  shift,
} from "../data/geometry.js";
export type { GeometryAction, GeometryFile } from "../data/geometry.js";
