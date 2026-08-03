/**
 * Domain types for the SF6 frame-data engine.
 *
 * Every term here is defined in CONTEXT.md. Keep them in sync: this file is the
 * type-level source of truth, CONTEXT.md is the prose source of truth.
 */

export type MoveCategory =
  | "normal"
  | "special"
  | "super"
  | "throw"
  | "drive"
  | "taunt";

/**
 * Cancel tags as used by the source data (FAT `xx`): what a move can be
 * cancelled INTO, by class rather than by specific target.
 *  - "ch" chain / target-normal   - "sp" special   - "su"/"su1".."su3" super (by level)
 *  - "tc" target combo            - "dr" drive rush
 */
export type CancelTag = string;

/** A single collision box in game units, relative to the character origin. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-frame collision geometry. Optional — see "Data reality" in CONTEXT.md. */
export interface Geometry {
  /** Hitboxes keyed by 1-indexed active frame. */
  hitboxes?: Record<number, Box[]>;
  /** Hurtboxes keyed by 1-indexed frame of the whole animation. */
  hurtboxes?: Record<number, Box[]>;
}

export interface Move {
  /** Stable id, unique within a character, e.g. "2mk". */
  id: string;
  /** Human name, e.g. "Crouching Medium Kick". */
  name: string;
  /** Notation input, e.g. "2MK" or "236P". */
  input: string;
  category: MoveCategory;

  /** Frames before the first active frame. */
  startup: number;
  /** Number of active frames. */
  active: number;
  /** Frames after the last active frame before actionable. */
  recovery: number;

  /**
   * Net attacker advantage when blocked / hit, contacting on the first active
   * frame. `+` = attacker actionable first. Undefined when not applicable
   * (e.g. a move that can't be blocked, or a launch that changes state).
   */
  onBlock?: number;
  onHit?: number;

  /** Damage on a clean hit. */
  damage?: number;

  /** Cancel classes this move can cancel into (from source `xx`). */
  cancelTags?: CancelTag[];

  /** Specific target move ids this move can cancel into, when known. */
  cancelsInto?: string[];

  /**
   * On a hit that ends in a special state (knockdown, crumple, wall-bounce),
   * the reaction type. When set, `onHit` holds the resulting oki/advantage
   * frames (e.g. "KD +40" -> onHit 40, hitReaction "knockdown").
   */
  hitReaction?: "knockdown" | "hard-knockdown" | "crumple" | "launch" | "wall-bounce";

  /**
   * Raw source strings for fields we parsed to integers, kept for provenance
   * and for multi-hit moves whose single-integer parse is lossy.
   */
  raw?: Partial<Record<"startup" | "active" | "recovery" | "onBlock" | "onHit" | "damage", string>>;

  /**
   * Known exact ending advantage for specific cancel targets, overriding the
   * first-order model. Keyed by the cancelled-into move id, split by context.
   */
  comboAdvantage?: Record<string, { onBlock?: number; onHit?: number }>;

  /** Coarse horizontal range in game units; used for whiff checks. */
  reach?: number;

  geometry?: Geometry;

  /** Freeform tags: "knockdown", "launcher", "low", "overhead", "armor"... */
  properties?: string[];

  /** Where this datum came from, for provenance. */
  source?: string;
}

export interface Character {
  id: string;
  name: string;
  moves: Move[];
}
