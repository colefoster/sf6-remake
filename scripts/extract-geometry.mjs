/**
 * Turns MMDK's raw fighter dumps into data/geometry/<char>.json — per-frame
 * hitbox / hurtbox / proximity-box geometry, plus a mapping from FAT move
 * notation onto the game's action ids.
 *
 *   node scripts/fetch-mmdk.mjs Ryu Akuma      # the Dec-2024 upstream snapshot
 *   node scripts/extract-geometry.mjs          # Ryu Akuma
 *   node scripts/extract-geometry.mjs Ken      # any fetched character
 *
 * HOW THE RAW DATA WORKS (reverse-engineered from MMDK.lua:350-403)
 *
 * `moves_dict.json` is every action (`fab` = fight action block) keyed by name.
 * An action's collision comes from typed key lists, each key covering a frame
 * range and naming box ids into the fighter's rect tables in `rects.json`:
 *
 *   AttackCollisionKey, AttackDataListIndex > -1  -> rects[CollisionType]  (hitbox)
 *   AttackCollisionKey, AttackDataListIndex = -1, CollisionType 3 -> rects[3] (proximity)
 *   DamageCollisionKey  Head/Body/Leg               -> rects[8]              (hurtbox)
 *   DamageCollisionKey  ThrowList                   -> rects[5] then rects[7] (throwable)
 *
 * A rect is a CENTRE plus HALF-EXTENTS (`OffsetX/Y`, `SizeX/Y`), which is why
 * Ryu's standing head/body/leg hurtboxes tile exactly 0-54, 54-138, 138-166
 * game units. We convert to the min-corner + full-size `Box` of domain/types.ts.
 *
 * Key frames are 0-indexed with an EXCLUSIVE end; we emit 1-indexed inclusive
 * frames so "first active frame == startup" holds as CONTEXT.md defines it.
 *
 *   PushCollisionKey    BoxNo                     -> rects[5] then rects[7] (pushbox)
 *
 * `HIT_DT.json` is the outcome table an AttackCollisionKey's `AttackDataListIndex`
 * points into: what the hit actually does. See `extractHitData`.
 *
 * Boxes are placed relative to the character origin, and the origin itself moves
 * during dashes, jumps and stepping attacks. Two key types drive it, and they
 * are the whole movement model (see `extractMotion`):
 *
 *   PlaceKey   an explicit per-frame position curve on one axis
 *   SteerKey   velocity and acceleration setters (ValueType 0/1 = velocity x/y,
 *              3/4 = acceleration x/y)
 *
 * DELIBERATE OMISSIONS
 * - General branch chasing. Actions branch mid-move for hit-confirms, follow-ups
 *   and rebalanced variants, and following them blindly double-counts active
 *   frames. Only the wind-up handoff is spliced (see `spliceContinuations`);
 *   every other branch is recorded as metadata for the viewer to link.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Overridable so a *second* dump can be extracted beside the pinned one and the
// two compared — which is how `diff-geometry.mjs` answers "did the game change
// under us, or did we read it wrong". See docs/agents/refresh-the-dump.md.
const RAW = process.env.MMDK_RAW ? path.resolve(process.env.MMDK_RAW) : path.join(root, "data/raw/mmdk");
const OUT = process.env.GEOMETRY_OUT ? path.resolve(process.env.GEOMETRY_OUT) : path.join(root, "data/geometry");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rect list ids. Hit lists are `CollisionType`; the rest were derived — see below. */
const RECT_PROXIMITY = 3;
const RECT_HURT = 8;
/**
 * Pushboxes live in two lists and MMDK's own code never settled which
 * ("fixme, 5 or 9 or 10?" — MMDK.lua:402). Resolved here from usage:
 * list 7 holds the base body boxes that `BoxNo` 1/2/3 point at — and those
 * are used by, respectively, every standing damage reaction, every crouching
 * one, and every jumping attack, with exactly the geometry that implies
 * (x +/-33 y 0-130 standing, y 0-100 crouching, y 90-180 airborne).
 * List 5 holds per-move overrides at `BoxNo` 32+: the box that rises through a
 * Shoryuken, the raised one a Tatsumaki spins in, a fireball's own body.
 * Overrides win, which is what makes Akuma's jumping HP (`BoxNo` 37, present in
 * both lists) take the raised box rather than the grounded one.
 */
const RECT_PUSH_OVERRIDE = 5;
const RECT_PUSH_BASE = 7;

/** First signed integer in a FAT value ("10*20" -> 10), or undefined. */
const int = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : undefined;
};

/** Rect centre + half-extents -> min-corner + full size, in game units, y up. */
function toBox(rect, rootOffset) {
  if (!rect) return null;
  const ox = rootOffset?.X ?? 0;
  const oy = rootOffset?.Y ?? 0;
  const w = rect.SizeX * 2;
  const h = rect.SizeY * 2;
  if (w === 0 && h === 0) return null;
  return {
    x: rect.OffsetX - rect.SizeX + ox,
    y: rect.OffsetY - rect.SizeY + oy,
    width: w,
    height: h,
  };
}

/** Entries of a dict-as-object as [number, value] pairs, in numeric key order. */
function numeric(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([k, v]) => [Number(k), v])
    .sort((a, b) => a[0] - b[0]);
}

/** Values of a MMDK-dumped dict-as-object, in numeric key order. */
function ordered(obj) {
  return numeric(obj)
    .map(([, v]) => v)
    .filter((v) => v && typeof v === "object");
}

/**
 * The fighter's rect tables, with the game's **shared** tables behind them.
 *
 * `common_rects.json` is dumped once for the whole roster rather than per
 * fighter, and it is where the boxes a character's own tables do not carry live.
 * The long-standing case is pushbox `BoxNo` 6: every fighter's knockdown and
 * tech actions reference it, no fighter's list 5 or 7 has it, and the extractor
 * has warned about it since ADR-0004. The common list 5 does.
 *
 * The fighter's own tables win; the common ones are consulted only where an id
 * resolves to nothing, so this can add boxes and never move one. `viaCommon`
 * counts what it added, because a silent fallback is how a shared default gets
 * mistaken for a per-character value. See ADR-0046.
 */
function makeRects(rectsFile, commonFile, stats) {
  const index = (file) => {
    const lists = new Map();
    for (const [listId, list] of Object.entries(file ?? {})) {
      if (!list || typeof list !== "object") continue;
      const byId = new Map();
      for (const [boxId, rect] of Object.entries(list)) byId.set(Number(boxId), rect);
      lists.set(Number(listId), byId);
    }
    return lists;
  };
  const own = index(rectsFile);
  const common = index(commonFile);
  /**
   * `listId` may be a list of lists, in preference order — pushboxes are
   * "the override list, then the base list". The fighter's tables are searched
   * across *all* of them before the shared ones are consulted, so a shared
   * default can never displace a box the fighter actually carries.
   */
  return (listId, boxId) => {
    const ids = Array.isArray(listId) ? listId : [listId];
    const id = Number(boxId);
    for (const list of ids) {
      const mine = own.get(list)?.get(id);
      if (mine) return mine;
    }
    for (const list of ids) {
      const shared = common.get(list)?.get(id);
      if (!shared) continue;
      if (stats) {
        const key = `${list}/${id}`;
        stats.viaCommon.set(key, (stats.viaCommon.get(key) ?? 0) + 1);
      }
      return shared;
    }
    return undefined;
  };
}

/** Resolve a key's BoxList / HeadList / ... into boxes. */
function boxesFrom(rect, listId, idList, rootOffset) {
  const out = [];
  for (const id of Object.values(idList ?? {})) {
    const boxId = typeof id === "object" ? id.mValue : id;
    if (typeof boxId !== "number") continue;
    const box = toBox(rect(listId, boxId), rootOffset);
    if (box) out.push(box);
  }
  return out;
}

/** Attack kind, from the flags MMDK derives off KindFlag. */
function attackKind(key) {
  if (key._isThr) return "throw";
  if (key._isPrj) return "projectile";
  if (key._isPrx) return "proximity";
  return "strike";
}

function extractAction(action, rect, unresolvedPush) {
  const fab = action.fab ?? {};
  const af = fab.ActionFrame ?? {};
  const cat = fab.Category ?? {};

  const hit = [];
  const prox = [];
  for (const kind of ["AttackCollisionKey", "GimmickCollisionKey", "OtherCollisionKey"]) {
    for (const key of ordered(action[kind])) {
      const start = key._StartFrame + 1;
      const end = key._EndFrame;
      if (end < start) continue;
      if ((key.AttackDataListIndex ?? -1) > -1) {
        const boxes = boxesFrom(rect, key.CollisionType, key.BoxList, key.RootOffset);
        if (!boxes.length) continue;
        hit.push({
          start,
          end,
          kind: attackKind(key),
          attackData: key.AttackDataListIndex,
          guardBit: key.GuardBit ?? null,
          hitId: key.HitID ?? 0,
          boxes,
        });
      } else if (key.CollisionType === RECT_PROXIMITY) {
        const boxes = boxesFrom(rect, RECT_PROXIMITY, key.BoxList, key.RootOffset);
        if (boxes.length) prox.push({ start, end, boxes });
      }
    }
  }

  const hurt = [];
  for (const key of ordered(action.DamageCollisionKey)) {
    const start = key._StartFrame + 1;
    const end = key._EndFrame;
    if (end < start) continue;
    const parts = {
      head: boxesFrom(rect, RECT_HURT, key.HeadList, key.RootOffset),
      body: boxesFrom(rect, RECT_HURT, key.BodyList, key.RootOffset),
      leg: boxesFrom(rect, RECT_HURT, key.LegList, key.RootOffset),
      // `ThrowList` does NOT resolve against the hurtbox table, despite sitting
      // beside Head/Body/Leg on the same key. Its ids are 1,2,3,10,34 — the
      // *pushbox* namespace — where the hurt table's are 100+. Read against
      // `rects[8]` it silently returned the head box, which sits at y 132-166
      // and cannot overlap a throw hitbox spanning y 0-130.
      //
      // The **base** table only, not the override the pushbox itself uses:
      // base-only reproduces FAT's published `throwHurt` on 23 of 24 fighters,
      // override-first on 19. See ADR-0035.
      throw: boxesFrom(rect, RECT_PUSH_BASE, key.ThrowList, key.RootOffset),
    };
    if (!Object.values(parts).some((b) => b.length)) continue;
    const entry = { start, end, ...parts };
    if (key.Immune) entry.immune = key.Immune;
    // `TypeFlag` says which kinds of attack the box answers to at all: 1 strike,
    // 2 projectile. 3 is the ordinary box and is left off. See ADR-0014.
    if ((key.TypeFlag ?? 3) !== 3) entry.typeFlag = key.TypeFlag ?? 0;
    // `AtemiDataListIndex` is armor: a row in a table the dump does not ship, so
    // the index is a discriminator rather than a payload. Which frames and which
    // body parts it covers are here, and that is what FAT publishes. See ADR-0016.
    if ((key.AtemiDataListIndex ?? -1) >= 0) entry.atemi = key.AtemiDataListIndex;
    hurt.push(entry);
  }

  const push = [];
  for (const key of ordered(action.PushCollisionKey)) {
    const start = key._StartFrame + 1;
    const end = key._EndFrame;
    if (end < start) continue;
    const rct = rect([RECT_PUSH_OVERRIDE, RECT_PUSH_BASE], key.BoxNo);
    const box = toBox(rct, key.RootOffset);
    if (!box) {
      unresolvedPush.add(key.BoxNo);
      continue;
    }
    push.push({ start, end, boxNo: key.BoxNo, box });
  }

  const cancels = [];
  for (const key of ordered(action.TriggerKey)) {
    const start = key._StartFrame + 1;
    const end = key._EndFrame;
    if (end < start) continue;
    const entry = {
      start,
      end,
      group: key.TriggerGroup,
      // `_NotDefer` false means an input here is held and fires when the window
      // opens for real: this is the buffer, and it always abuts the live window.
      buffered: key._NotDefer === false,
      cond: key._Condition ?? 0,
    };
    // `ConditionFlag` is four packed fields and only `_Condition` resists
    // reading; keep the rest rather than the one number, so a later attempt at
    // the nibble starts from the whole flag. See docs/adr/0013.
    if (key._State) entry.state = key._State;
    if (key._Input) entry.input = key._Input;
    if (key._Other) entry.other = key._Other;
    cancels.push(entry);
  }

  // A Super Art's `WorldKey` carries a negative `Timer`: the cinematic freeze, in
  // frames. Everything after it sits that much later in the action's own timeline
  // than in FAT's numbers. See docs/adr/0019.
  const freezes = ordered(action.WorldKey)
    .filter((k) => k && k._IsTIMER && typeof k.Timer === "number" && k.Timer !== 0)
    .map((k) => Math.abs(k.Timer));

  const branches = ordered(action.BranchKey)
    .filter((k) => typeof k.Action === "number" && k.Action > 0)
    .map((k) => ({ frame: (k._StartFrame ?? 0) + 1, action: k.Action, type: k.Type ?? null }));

  const out = {
    id: action.id,
    name: action.name,
    frames: fab.Frame ?? null,
    // MainFrame is the action's own first active frame (0-indexed): startup - 1.
    mainFrame: af.MainFrame ?? null,
    marginFrame: af.MarginFrame ?? null,
    // What starting a combo with this move costs it. `fab.Combo._StartScaling`
    // is a percentage and −1 means "unset", which is most moves; it lines up
    // with FAT's `dmgScaling` "20% Start" exactly. `ComboScaling`/`InstScaling`
    // are its mid-combo and immediate siblings, kept on the same terms.
    ...scaling(fab.Combo),
    ...locks(action.LockKey),
    flags: {
      high: !!cat._IsHigh,
      low: !!cat._IsLow,
      overhead: !!cat._IsOverhead,
      invincible: cat._Invincible ?? 0,
      strikeInvuln: !!cat._IsMutekiStrike,
      throwInvuln: !!cat._IsMutekiThrow,
      fullInvuln: !!cat._IsMutekiAll,
    },
    hit,
    prox,
    hurt,
    push,
  };
  if (cancels.length) out.cancels = cancels;
  const shots = extractShots(action);
  if (shots.length) out.shots = shots;
  const motion = extractMotion(action, fab.Frame);
  if (motion) out.motion = motion;
  if (branches.length) out.branches = dedupeBranches(branches);
  if (freezes.length) out.freeze = Math.max(...freezes);
  if (action.mot_name) out.mot = action.mot_name;
  return out;
}

/**
 * `ShotKey` is where a projectile comes from: which action the fireball itself
 * is, the frame it is spawned on, and where relative to the origin it appears.
 *
 * It is what makes a fireball gradeable at all. A projectile special's own
 * action carries no hitbox — the fireball is a separate action with its own
 * timeline starting at its frame 1 — so before this there was no startup on the
 * parent to compare with anything. The spawn frame is that startup: Ryu's
 * `SPA_HADO` spawns on 15 (0-indexed) and FAT publishes LP Hadoken at 16.
 * See docs/adr/0022.
 */
function extractShots(action) {
  const out = [];
  for (const key of ordered(action.ShotKey)) {
    if (typeof key.ActionId !== "number" || key.ActionId < 0) continue;
    out.push({
      action: key.ActionId,
      frame: key._StartFrame + 1,
      // Game units from the character origin, the same frame as every box.
      offset: { x: key.PosOffset?.x ?? 0, y: key.PosOffset?.y ?? 0 },
    });
  }
  return out.sort((a, b) => a.frame - b.frame || a.action - b.action);
}

/**
 * A hit-data entry's `common` list is indexed by how the attack landed. Read off
 * the numbers: entry 1 deals no damage and hands the defender Drive, entry 2 is
 * damage x1.2 with exactly 2 more frames of stun, entry 3 exactly 4 more — which
 * is SF6's counter hit and punish counter to the frame.
 */
const HIT_CONDITIONS = ["hit", "block", "counter", "punishCounter", "driveHit"];

/** The three combo-scaling percentages, dropping the −1 that means "unset". */
/**
 * A throw's damage, which is on none of its hit keys.
 *
 * `NGS` catches for zero damage; the animation that carries the opponent
 * (`NGA_6`, `NGA_4`) has no `AttackCollisionKey` at all. The hit-data row is
 * named by a `LockKey` entry flagged `_IsAttackDataHash02`, whose `Param02` is
 * the `AttackDataListIndex` — which is why those rows are referenced by nothing
 * else in the file. See ADR-0035.
 */
function locks(lockKey) {
  const out = [];
  for (const key of Object.values(lockKey ?? {})) {
    if (!key?._IsAttackDataHash02) continue;
    const attackData = key.Param02;
    if (typeof attackData !== "number" || attackData < 0) continue;
    out.push({ frame: (key._StartFrame ?? 0) + 1, attackData });
  }
  return out.length ? { locks: out } : {};
}

function scaling(combo) {
  if (!combo) return {};
  const out = {};
  if ((combo._StartScaling ?? -1) >= 0) out.start = combo._StartScaling;
  if ((combo.ComboScaling ?? -1) >= 0) out.combo = combo.ComboScaling;
  if ((combo.InstScaling ?? -1) >= 0) out.immediate = combo.InstScaling;
  return Object.keys(out).length ? { scaling: out } : {};
}

/** 65535 in a `Drive*` column means "no entry", not "65535 units of Drive". */
const NONE_16 = 65535;

/**
 * The fields worth keeping out of the 104 per entry.
 *
 * The first block is what a *grader* needs — damage and stun to check against
 * FAT. The rest is what a *player* needs, and none of it was extracted before
 * ADR-0025: which reaction animation to put the defender in, what the corner
 * does, whether the hit combos, and what it costs the defender's Drive gauge.
 * Sound, hit sparks, screen shake and the animation curves are still dropped.
 */
function hitOutcome(entry) {
  if (!entry) return null;
  const out = {
    damage: entry.DmgValue ?? 0,
    stun: entry.HitStun ?? 0,
    hitStop: { owner: entry.HitStopOwner ?? 0, target: entry.HitStopTarget ?? 0 },
    /** Where the defender is carried to, over `moveTime` frames. */
    knockback: { x: entry.MoveDest?.x ?? 0, y: entry.MoveDest?.y ?? 0, frames: entry.MoveTime ?? 0 },
    downTime: entry.DownTime ?? 0,
    juggle: { start: entry.Juggle1st ?? 0, add: entry.JuggleAdd ?? 0, limit: entry.JuggleLimit ?? 0 },
    /** Drive gauge for attacker / defender, and super meter for each. */
    drive: { own: entry.FocusOwn ?? 0, target: entry.FocusTgt ?? 0 },
    super: { own: entry.SuperOwn ?? 0, target: entry.SuperTgt ?? 0 },
    dmgType: entry.DmgType ?? 0,
    /**
     * Which reaction the defender plays. `strength` picks the L/M/H suffix of a
     * `DMG_*` / `GRD_*` action and `part` its height prefix; `kind` separates the
     * ordinary reactions from crumple, launch and the rest. See docs/adr/0025.
     */
    reaction: {
      strength: entry._IsStrength_S ? "S" : entry._IsStrength_H ? "H" : entry._IsStrength_M ? "M" : "L",
      kind: entry.DmgKind ?? 0,
      part: entry.DmgPart ?? 0,
      attr: [entry.Attr0 ?? 0, entry.Attr1 ?? 0, entry.Attr2 ?? 0, entry.Attr3 ?? 0],
    },
    /** Combo counting: `add` is what this hit adds, and two flags that opt out. */
    combo: {
      add: entry.ComboAdd ?? 0,
      none: entry._no_combo === true,
      black: entry._black_combo === true,
    },
    /** Recoverable ("grey") damage, and the stun/dizzy points the hit is worth. */
    recoverable: entry.DmgRecover ?? 0,
    stunPoint: entry.PiyoPoint ?? 0,
    /** Frames the defender is untouchable for afterwards. */
    invulnAfter: entry.MutekiTime ?? 0,
  };
  if (entry.ArmorPoint) out.armor = entry.ArmorPoint;

  // What the corner does with this hit: a wall bounce, a wall splat, or nothing.
  if (entry._kabe_bound || entry._kabe_tataki || entry.WallTime) {
    out.wall = {
      bounce: entry._kabe_bound === true,
      first: entry._kabe_bound_1st === true,
      splat: entry._kabe_tataki === true,
      dest: { x: entry.WallDest?.x ?? 0, y: entry.WallDest?.y ?? 0 },
      stop: entry.WallStop ?? 0,
      time: entry.WallTime ?? 0,
    };
  }
  // And what the ground does: a bounce, and where it puts them.
  if (entry._jimen_bound || entry.FloorTime || entry.BoundDest) {
    out.floor = {
      bounce: entry._jimen_bound === true,
      dest: { x: entry.FloorDest?.x ?? 0, y: entry.FloorDest?.y ?? 0 },
      time: entry.FloorTime ?? 0,
      boundDest: entry.BoundDest ?? 0,
    };
  }
  // Drive gauge the *defender* loses: blocking costs, and a just-parry costs less.
  const norm = entry.DriveNorm ?? NONE_16;
  const just = entry.DriveJust ?? NONE_16;
  if (norm !== NONE_16 || just !== NONE_16) {
    out.driveDamage = { normal: norm === NONE_16 ? 0 : norm, just: just === NONE_16 ? 0 : just };
  }
  // Chip damage rules, and which side the defender ends up facing.
  const flags = [];
  if (entry._kezu_down) flags.push("chipDown");
  if (entry._kezu_stand) flags.push("chipStand");
  if (entry._no_death) flags.push("noDeath");
  if (entry._no_kezu_death) flags.push("noChipDeath");
  if (entry._no_esc) flags.push("noEscape");
  // Whether the knockdown can be quick-risen out of. True on 11,131 of the
  // roster's 79,175 condition rows and the only thing in the row that speaks to
  // wakeup timing at all. See ADR-0033.
  if (entry._no_rolling) flags.push("noQuickRise");
  if (entry._weak_attack) flags.push("weak");
  if (entry._chara_forward) flags.push("turnForward");
  if (entry._chara_reverse) flags.push("turnReverse");
  if (entry._no_gauge_gain) flags.push("noGauge");
  if (entry._no_hit_stop) flags.push("noHitStop");
  if (flags.length) out.flags = flags;
  return out;
}

/**
 * The outcome table, keyed by the `attackData` index its hit keys carry.
 * `common` holds one entry per hit condition; `param` is that crossed with the
 * defender's state (index 2 of each group of four is the airborne variant, the
 * one that launches — Ryu's 2MK carries a grounded opponent 50 units and an
 * airborne one 100 up and 70 back).
 */
function extractHitData(file) {
  const out = {};
  for (const [index, entry] of Object.entries(file ?? {})) {
    const common = entry?.common;
    if (!common) continue;
    const row = {};
    HIT_CONDITIONS.forEach((name, i) => {
      const outcome = hitOutcome(common[String(i)]);
      if (outcome) row[name] = outcome;
    });
    const air = hitOutcome(entry.param?.["02"]);
    if (air) row.airHit = air;
    if (Object.keys(row).length) out[Number(index)] = row;
  }
  return out;
}

/**
 * The cancel lists. `tgroups.json` is one entry per trigger group, and each is a
 * bit array whose set bits are **trigger indices**. MMDK dumps them annotated
 * with the action each leads to, but we keep the indices: a group lists the same
 * action once per strength, and it is the trigger, not the action, that carries
 * what the option costs. MMDK's own UI calls these CancelLists.
 *
 * Only groups an action actually references are kept; a fighter's file typically
 * declares a few more than it uses.
 */
function extractCancelGroups(file, referenced) {
  const out = {};
  for (const [gid, group] of Object.entries(file ?? {})) {
    const id = Number(gid);
    if (!referenced.has(id) || !group || typeof group !== "object") continue;
    const triggers = Object.keys(group)
      .filter((k) => /^\d+$/.test(k))
      .map(Number)
      .sort((a, b) => a - b);
    if (triggers.length) out[id] = triggers;
  }
  return out;
}

/**
 * What it takes to actually get the cancel out. `triggers.json` is keyed by the
 * action a trigger leads to, and within that by the trigger's own index — the
 * same index the cancel lists hold.
 *
 * The costs are in gauge units, and they check themselves against the game:
 * Drive is 60000 over six bars and super 30000 over three, so an EX special
 * reads 20000 (two bars), Drive Impact 10000, Drive Parry 5000, a Drive Rush
 * cancel 30000, and SA1/2/3 come out at exactly 10000/20000/30000.
 *
 * `focus_need` is a flag rather than an amount (0 or 1 on all but one trigger
 * in the roster); `focus_consume` is the number that matters.
 */
/**
 * The input bitmask, decoded.
 *
 * Directions are the low nibble and buttons the next six bits, which reads
 * straight off the motions: Ryu's command 1 is `0x2, 0xa, 0x8` and FAT calls it
 * `236` — down, down-forward, forward. The multi-button masks are unions of the
 * single ones, so OD (`0x70`, all three punches) needs no separate flag.
 * See docs/adr/0025.
 */
const KEY_BITS = {
  up: 0x1,
  down: 0x2,
  back: 0x4,
  forward: 0x8,
  LP: 0x10,
  MP: 0x20,
  HP: 0x40,
  LK: 0x80,
  MK: 0x100,
  HK: 0x200,
};

/** The eight numpad directions, as the direction nibble spells them. */
const NUMPAD = { 0x4: 4, 0x8: 6, 0x2: 2, 0x1: 8, 0x6: 1, 0xa: 3, 0x5: 7, 0x9: 9 };

/** `ok_key_flags` as names: `0x70` is `["LP","MP","HP"]`, `0xa` is `["down","forward"]`. */
function keyNames(mask) {
  return Object.entries(KEY_BITS)
    .filter(([, bit]) => (mask & bit) === bit)
    .map(([name]) => name);
}

/**
 * A motion input: the ordered directions to sweep through, and how long each
 * step stays valid.
 *
 * A step with `ok_key_flags` bit 30 set and `rotate.point` non-zero is a
 * **wildcard**: any direction the step does not forbid. It is how the table
 * writes the parts of a motion that are not pinned — a `236236` is stored as
 * wildcard, `6`, wildcard, `6`, and a `66` dash as wildcard, `6`, wildcard, `6`
 * with back and down forbidden. Kept as `any` rather than expanded, because what
 * the wildcard has to pass through is not stated.
 */
function extractCommand(cmd) {
  if (!cmd || !cmd.input_num) return null;
  const steps = [];
  for (let i = 0; i < cmd.input_num; i++) {
    const step = cmd.inputs?.[String(i).padStart(2, "0")];
    if (!step) continue;
    const mask = step.normal?.ok_key_flags ?? 0;
    const out = { frames: step.frame_num ?? 0 };
    // A charge release writes its slot id into the low bits and sets bit 16, so
    // the nibble is not a direction on this step. Which *way* the slot is held is
    // not in the table at all; `chargeHold` infers it from what follows.
    if (step.charge?.is_release) {
      out.charge = step.charge.id;
      out.release = true;
    } else if (step.rotate?.point) out.any = true;
    else if (mask & 0xf) out.dir = NUMPAD[mask & 0xf] ?? mask & 0xf;
    if (step.normal?.ng_key_flags) out.forbid = keyNames(step.normal.ng_key_flags);
    steps.push(out);
  }
  if (!steps.length) return null;
  const hold = chargeHold(steps);
  if (hold) steps[0].dir = hold;
  const out = { steps };
  if (cmd.CommandTimer > 0) out.window = cmd.CommandTimer;
  if (cmd.charge_bit) out.chargeSlots = cmd.charge_bit;
  return out;
}

/**
 * Which direction a charge move is held in — **inferred, not read**.
 *
 * The table names a charge slot and never says which way the slot is held. But
 * across the six charge fighters the release is the only thing that varies, and
 * it varies with the charge: every slot released into forward is a back charge
 * (`[4]6`, `[4]646`) and every slot released into up is a down charge (`[2]8`).
 * Fourteen commands, no counterexample. Recorded here as an inference so it is
 * visible as one. See docs/adr/0025.
 */
function chargeHold(steps) {
  if (!steps[0]?.release) return null;
  const next = steps.find((s) => s.dir);
  if (!next) return null;
  return next.dir === 6 ? 4 : next.dir === 8 ? 2 : null;
}

/**
 * The atemi table — what an armored hurtbox's `AtemiDataListIndex` points at.
 *
 * ADR-0016 called this table "not in the dump" and ADR-0039 read its hit count
 * off FAT's prose instead. MMDK does dump it, under a separate button: a shared
 * `common_atemi.json` at the dump root plus per-fighter `atemi.json` overrides
 * (only Luke, Marisa and Zangief have one). Both hold rows in the same index
 * space, the per-character keys zero-padded ("07") and the common ones not
 * ("7"), so both are read as numbers and the fighter's own row wins.
 *
 * Kept: `ResistLimit`, the number of hits the armor absorbs, and the three
 * ratios — percentages applied to what an absorbed hit does. See docs/adr/0042.
 */
function extractAtemi(commonFile, charFile) {
  const rows = {};
  for (const file of [commonFile, charFile]) {
    for (const [key, row] of Object.entries(file ?? {})) {
      if (!row || typeof row !== "object") continue;
      const index = Number(key);
      if (!Number.isInteger(index)) continue;
      rows[index] = {
        hits: row.ResistLimit ?? 0,
        damageRatio: row.DamageRatio ?? 100,
        recoverRatio: row.RecoverRatio ?? 0,
        gaugeRatio: row.GaugeRatio ?? 0,
      };
    }
  }
  return Object.keys(rows).length ? rows : undefined;
}

/**
 * The fighter's own constants, from `char_info.json` — health, meter maxima, and
 * the Drive gauge's regeneration rates.
 *
 * `Vitality` and `Gauge` are the game's numbers outright. The Drive maximum is
 * not stated anywhere in the dump; ADR-0009 inferred 60000 from what the triggers
 * charge for an OD special, and that inference is recorded here rather than
 * silently assumed elsewhere.
 *
 * `Recover*` and `FocusRecover*` are regeneration, in units whose period is not
 * stated. They are copied through undecoded. See docs/adr/0025.
 */
function extractFighter(file) {
  const pl = file?.PlData;
  const basic = file?.Styles?.["0"]?.StyleData?.Basic;
  if (!pl) return null;
  return {
    health: pl.Vitality ?? 0,
    superMax: pl.Gauge ?? 0,
    weight: pl.Weight ?? 0,
    /** Drive Impact's armour, and how long it holds: the same 100/50 on everyone. */
    armor: { point: pl.ArmorPoint ?? 0, timer: pl.ArmorTimer ?? 0 },
    /** Body size in game units — `SizeU` is the standing height the boxes agree with. */
    size: { up: pl.SizeU ?? 0, front: pl.SizeF ?? 0, back: pl.SizeB ?? 0 },
    driveRecover: { normal: pl.RecoverDrvNorm ?? 0, just: pl.RecoverDrvJust ?? 0 },
    scales: basic
      ? {
          offensive: basic.OffensiveScale ?? 100,
          defensive: basic.DefensiveScale ?? 100,
          moveSpeed: basic.MoveSpeedScale ?? 100,
          gaugeGain: basic.GaugeGainRatio ?? 100,
          /** Drive regen: `NM` neutral, `IC` in burnout, `A` the airborne pair. */
          focusRecover: {
            normal: basic.FocusRecoverNM ?? 0,
            normalAir: basic.FocusRecoverNMA ?? 0,
            burnout: basic.FocusRecoverIC ?? 0,
            burnoutAir: basic.FocusRecoverICA ?? 0,
          },
        }
      : undefined,
  };
}

function extractTriggers(file, used, commandFile) {
  const out = {};
  for (const slots of Object.values(file ?? {})) {
    if (!slots || typeof slots !== "object") continue;
    for (const [index, trigger] of Object.entries(slots)) {
      const id = Number(index);
      if (!used.has(id) || !trigger || typeof trigger !== "object") continue;
      // Classic is the style that has a command on all but 32 triggers; the
      // others are Modern and the assist styles, which reuse the same trigger.
      const style = ["norm", "sprt", "easy", "supr"].find((s) => (trigger[s]?.command_index ?? -1) > -1);
      const scheme = trigger[style ?? "norm"] ?? {};
      const record = {
        action: trigger.action_id,
        /** Input buffer in frames: 4 almost everywhere, 6 on air specials. */
        buffer: scheme.preceding_time ?? 0,
      };
      // Which buttons, and (where there is one) the motion in front of them.
      if (scheme.ok_key_flags) record.keys = keyNames(scheme.ok_key_flags);
      if (scheme.ng_key_flags) record.forbid = keyNames(scheme.ng_key_flags);
      // `dc_exc_flags` is the direction the button has to be pressed with, in
      // the same nibble as everything else: Ryu's 5MP, 2MP and 6MP are one
      // button and three triggers differing only here (0, down, forward). It is
      // the only thing that tells a crouching normal from a standing one.
      if (scheme.dc_exc_flags) record.dir = keyNames(scheme.dc_exc_flags & 0xf);
      if (commandFile && (scheme.command_index ?? -1) > -1) {
        const group = commandFile[String(scheme.command_no).padStart(2, "0")];
        const motions = Object.values(group ?? {})
          .map(extractCommand)
          .filter(Boolean);
        if (motions.length) record.motions = motions;
      }
      if (trigger.focus_consume) record.drive = trigger.focus_consume;
      if (trigger.gauge_consume) record.super = trigger.gauge_consume;
      const kinds = Object.entries(trigger)
        .filter(([k, v]) => k.startsWith("_Is") && v === true)
        .map(([k]) => k.slice(3));
      if (kinds.length) record.kind = kinds;
      out[id] = record;
    }
  }
  return out;
}

/** SteerKey ValueType: which component of the origin's motion it sets. */
const STEER = { 0: "vx", 1: "vy", 3: "ax", 4: "ay" };
/** OperationType 1 sets a value outright; 6 is the stop that zeroes it. */
const STEER_OPS = new Set([1, 6]);

/**
 * The per-frame path of the character origin, in game units from where the
 * action began.
 *
 * `PlaceKey` wins wherever it has a value: it is the animation's own root
 * motion, and it disagrees with the SteerKey velocities on moves that have both
 * (Ryu's Shoryuken steers x by 3.0/frame but places itself 30.3 units forward).
 * Everywhere else the SteerKeys integrate: velocity set on a frame, then
 * acceleration applied each frame after, which is what gives jumps their arc —
 * Ryu's forward jump sets y velocity 24 against gravity 1.17, predicting ~41
 * frames of airtime for an action that lasts 40.
 */
function extractMotion(action, frames) {
  const place = { 0: new Map(), 1: new Map() };
  for (const key of ordered(action.PlaceKey)) {
    const axis = key.Axis === 1 ? 1 : 0;
    const ratio = key.Ratio ?? 1;
    // PosList is keyed "00".."39", and JS iterates the canonical integer keys
    // ("10"+) before the zero-padded ones, so the curve must be sorted, not
    // walked in object order.
    for (const [index, value] of numeric(key.PosList)) {
      if (typeof value === "number") place[axis].set(key._StartFrame + index, value * ratio);
    }
  }

  const steer = new Map();
  for (const key of ordered(action.SteerKey)) {
    const field = STEER[key.ValueType];
    if (!field || !STEER_OPS.has(key.OperationType)) continue;
    const at = steer.get(key._StartFrame) ?? {};
    at[field] = key.FixValue ?? 0;
    steer.set(key._StartFrame, at);
  }

  if (!place[0].size && !place[1].size && !steer.size) return null;

  const x = [];
  const y = [];
  let pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  const acc = { x: 0, y: 0 };
  for (let frame = 0; frame < (frames ?? 0); frame++) {
    const set = steer.get(frame);
    if (set) {
      if (set.vx !== undefined) vel.x = set.vx;
      if (set.vy !== undefined) vel.y = set.vy;
      if (set.ax !== undefined) acc.x = set.ax;
      if (set.ay !== undefined) acc.y = set.ay;
    }
    if (frame > 0) {
      vel.x += acc.x;
      vel.y += acc.y;
      pos = { x: pos.x + vel.x, y: pos.y + vel.y };
      if (pos.y < 0) {
        pos.y = 0;
        vel.y = 0;
        acc.y = 0;
      }
    }
    // Root motion overrides the integration, and the integration resumes from it.
    if (place[0].has(frame)) pos.x = place[0].get(frame);
    if (place[1].has(frame)) pos.y = place[1].get(frame);
    x.push(round2(pos.x));
    y.push(round2(pos.y));
  }

  const moves = (list) => list.some((v) => v !== 0);
  if (!moves(x) && !moves(y)) return null;
  const motion = { travel: { x: x[x.length - 1] ?? 0, maxX: extreme(x), maxY: Math.max(...y) } };
  // The speed the action is still carrying when its curve runs out, and the one
  // it set off at. A projectile outlives its own action — every shot action in
  // the roster is shorter than the flight it describes — so the flight past the
  // end continues at `velocity`, and `launch` is what FAT publishes as
  // "Projectile Speed" x 100. See ADR-0040.
  motion.velocity = { x: round2(vel.x), y: round2(vel.y) };
  const first = ordered(action.SteerKey).find(
    (k) => STEER[k.ValueType] === "vx" && STEER_OPS.has(k.OperationType) && (k.FixValue ?? 0) > 0,
  );
  if (first) motion.launch = round2(first.FixValue);
  if (moves(x)) motion.x = x;
  if (moves(y)) motion.y = y;
  return motion;
}

const round2 = (n) => Math.round(n * 100) / 100;
/** The furthest the origin gets from home, keeping the sign (back dashes). */
const extreme = (list) => list.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);

/**
 * Where an airborne action puts itself down.
 *
 * An action that ends in the air carries no `MarginFrame` of its own — there is
 * nothing to recover from until you touch the ground — and hands off to a
 * landing action that does. Ryu's Shoryuken runs its 35 frames, which is
 * exactly when its own motion curve returns to y = 0, then branches into
 * `SPA_SYORYU_END` whose margin is 12. FAT publishes that move's recovery as
 * "21+12": 35 - (startup + active - 1) = 21, and 12 is the landing action's
 * margin. Both halves of the published number come out of the dump.
 *
 * Chased through intermediate branches, because some moves land via an
 * in-between action; capped in depth because branches can cycle.
 */
function extractLanding(action, byId, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(action.id)) return null;
  seen.add(action.id);
  for (const branch of action.branches ?? []) {
    const target = byId.get(branch.action);
    if (!target) continue;
    if (target.marginFrame > 0) return { action: target.id, margin: target.marginFrame };
    const deeper = extractLanding(target, byId, depth + 1, seen);
    if (deeper) return deeper;
  }
  return null;
}

/** 5HK branches to the same action on four consecutive frames; keep the first. */
function dedupeBranches(branches) {
  const seen = new Set();
  return branches.filter((b) => {
    if (seen.has(b.action)) return false;
    seen.add(b.action);
    return true;
  });
}

/**
 * Some moves are two actions: a wind-up that branches into the hit at its own
 * first active frame. Ryu's 2HP is `ATK_2HP_H` branching into `ATK_2HP` on
 * frame 9 — read alone the wind-up shows 4 active frames, spliced it shows the
 * published 6. Only this exact shape is spliced (`_H` handing off to its base,
 * whose hitboxes start on its frame 1); the conditional branches that follow a
 * confirmed hit look the same at the key level but must NOT be followed.
 *
 * Hurtboxes are left alone: the wind-up's own keys already span its full length.
 */
function spliceContinuations(actions) {
  const byName = new Map(actions.map((a) => [a.name, a]));
  for (const action of actions) {
    if (!action.name.endsWith("_H") || !action.branches) continue;
    const base = byName.get(action.name.slice(0, -2));
    const branch = base && action.branches.find((b) => b.action === base.id);
    if (!branch) continue;
    const starts = base.hit.filter((h) => h.kind !== "proximity").map((h) => h.start);
    if (!starts.length || Math.min(...starts) !== 1) continue;

    const shift = branch.frame - 1;
    const shifted = (keys) =>
      keys.map((k) => ({ ...k, start: k.start + shift, end: k.end + shift, from: base.id }));
    action.hit = [...action.hit.filter((h) => h.start < branch.frame), ...shifted(base.hit)];
    action.prox = [...action.prox.filter((p) => p.start < branch.frame), ...shifted(base.prox)];
    action.continues = base.id;
  }
}

/** Startup / active as the frame data would read them, from the hit keys. */
function signature(action, byId) {
  let strikes = action.hit.filter((h) => h.kind !== "proximity");
  // A fireball's own action has no hitbox: it spawns one. The startup is the
  // frame it spawns on, and the active window belongs to the projectile's own
  // action. Without this a projectile special has no frames to match on at all,
  // which is why every fireball family was unmapped. See docs/adr/0022.
  let spawn;
  if (!strikes.length && action.shots?.length && byId) {
    for (const shot of action.shots) {
      const projectile = byId.get(shot.action);
      const own = projectile?.hit.filter((h) => h.kind !== "proximity") ?? [];
      if (!own.length) continue;
      spawn = shot.frame;
      strikes = own;
      break;
    }
  }
  if (!strikes.length) return null;
  const start = spawn ?? Math.min(...strikes.map((h) => h.start));
  // Contiguous keys are one active window; a gap means a multi-hit move.
  const windows = [];
  for (const h of [...strikes].sort((a, b) => a.start - b.start)) {
    const last = windows[windows.length - 1];
    if (last && h.start <= last.end + 1) last.end = Math.max(last.end, h.end);
    else windows.push({ start: h.start, end: h.end });
  }
  return {
    startup: start,
    active: windows[0].end - windows[0].start + 1,
    windows,
    hits: countHits(strikes, windows),
  };
}

/**
 * How many times the move connects: distinct `HitID` per contiguous window, summed.
 *
 * Neither half alone reads. Counting *keys* calls a single blow multi-hit —
 * the dump routinely splits one active window into three boxes that come and go
 * — and that is what kept 397 single-hit moves out of the clean population.
 * Counting *windows* misses the back-to-back hits FAT writes `1*3`, which share
 * a window and are separated only by the id. `HitID` is the game's own statement
 * of what one hit is: keys carrying the same id can only connect once between
 * them. See docs/adr/0024.
 */
function countHits(strikes, windows) {
  let hits = 0;
  for (const w of windows) {
    const ids = new Set();
    for (const h of strikes) if (h.start >= w.start && h.start <= w.end) ids.add(h.hitId);
    hits += ids.size;
  }
  return hits;
}

/**
 * MMDK action names for normals are the notation with an `ATK_` prefix and an
 * optional variant suffix: `ATK_5LP`, `ATK_2MK_Y2` (a Year-2 rebalance),
 * `ATK_5HK(1)` (a same-named sibling action), `ATK_5LP_B` (chain variant).
 */
const VARIANT = /^(?:\(\d+\)|_[A-Z0-9]+)*$/;

/**
 * The stems an action could be named after. Simple normals are the notation
 * itself; the rest is target-combo naming, which MMDK dumps three ways:
 *   "5MP > MP"        -> ATK_5MP_MP        (tokens joined)
 *   "9 > 2MK"         -> ATK_92MK          (tokens concatenated)
 *   "6HP > 6HP > HK"  -> ATK_6HP_TC_TC     (base plus one _TC per follow-up)
 *   "5HP > HK"        -> ATK_5HK(1)        (the follow-up as a standalone normal)
 */
function stemsFor(input) {
  const tokens = input
    .replace(/\s*\(air\)/i, "")
    .split(">")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return [];
  const [first, ...rest] = tokens;
  const stems = [tokens.join("_"), tokens.join("")];
  if (rest.length) {
    stems.push(`${first}${"_TC".repeat(rest.length)}`);
    const last = tokens[tokens.length - 1];
    // A bare follow-up strength ("HK") is really the standing normal.
    stems.push(last, /^[LMH][PK]$/.test(last) ? `5${last}` : last);
  }
  return [...new Set(stems)];
}

function candidatesFor(input, actions) {
  const out = new Map();
  for (const stem of stemsFor(input)) {
    const wanted = norm(`ATK_${stem}`);
    for (const a of actions) {
      if (!norm(a.name).startsWith(wanted)) continue;
      if (!VARIANT.test(a.name.slice(`ATK_${stem}`.length))) continue;
      out.set(a.id, a);
    }
  }
  return [...out.values()];
}

/**
 * FAT's `cmnName` says what a move *is* — "Drive Impact", "Super Art Level 2",
 * "Critical Art" — independently of its notation. Notation is what the name path
 * matches on, and for these moves it is useless: the Drive system's actions are
 * `ATK_CTA` and `ATK_CTA_4`, and a super's action carries the move's Japanese
 * name. So the fallback used to guess from frames alone and land on whatever
 * shared the profile. See docs/adr/0018.
 */
const SYSTEM_ACTIONS = { "Drive Impact": "ATK_CTA", "Drive Reversal": "ATK_CTA_4" };
const isSystemAction = (name) => Object.values(SYSTEM_ACTIONS).some((n) => name === n || name.startsWith(`${n}(`));

/** "Super Art Level 2 (air)" -> 2, "Critical Art" -> 4. */
function superLevel(cmnName) {
  if (typeof cmnName !== "string") return null;
  if (/^Critical Art/.test(cmnName)) return 4;
  const m = cmnName.match(/^Supe?rt? (?:Art )?Level (\d)/);
  return m ? Number(m[1]) : null;
}

/**
 * The dump names a Super Art's own action `SAA_*`, `CAA_*` or `SA<n>_*` — 217 of
 * the 237 actions a level trigger points at. The other 20 are handoffs through
 * something that is not a super at all: Cammy's SA1 reuses her Spiral Arrow
 * animation, and Akuma's install trigger points at a standing loop. Taking those
 * would put a confidently wrong action on a super, which is the failure ADR-0017
 * just removed from the Drive moves.
 */
const isSuperAction = (name) => /^(SAA|CAA|SA\d)/.test(name);

/**
 * Every trigger in `triggers.json`, in the dump's own numeric order.
 *
 * The file keys its slots by action id and MMDK zero-pads some of them ("0900")
 * and not others ("1052"). JavaScript puts canonical integer-like keys **first**,
 * in ascending order, before any string key — so `Object.values` hands back 1052
 * before 0900, and every "the first trigger for this slot wins" read of this file
 * silently prefers whichever slot happened to be written unpadded. Ryu's Denjin
 * Hadoken took the Heavy and OD slots off the plain Hadoken exactly that way.
 *
 * Sorting numerically restores the order the dump is written in, which is also
 * the order the game authors variants in: the base move, then its rebalances.
 * See ADR-0048.
 */
function triggersInOrder(file) {
  const out = [];
  const slots = Object.entries(file ?? {})
    .filter(([, group]) => group && typeof group === "object")
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [, group] of slots) {
    const entries = Object.entries(group).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [index, trigger] of entries) {
      if (trigger && typeof trigger === "object") out.push([Number(index), trigger]);
    }
  }
  return out;
}

/**
 * Which actions each super level can lead to, from the triggers' own `_IsLv1`..
 * `_IsLv4` flags. This is the dump's classification, not ours, and it turns a
 * 300-action guess into a pool of two or three.
 */
function superActionsByLevel(triggerFile) {
  const out = new Map();
  for (const [, trigger] of triggersInOrder(triggerFile)) {
    for (const [k, v] of Object.entries(trigger)) {
      const level = v === true && k.match(/^_IsLv(\d)$/);
      if (!level) continue;
      const key = Number(level[1]);
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(trigger.action_id);
    }
  }
  return out;
}

/**
 * The dump classifies its own specials, the same way it classifies supers.
 * A trigger carries `_IsSpecial_<n>` for the family, `_IsLight` / `_IsMiddle` /
 * `_IsHeavy` for the strength and `_IsExtra` for OD, plus `_IsPunch` / `_IsKick`.
 *
 * That is the join FAT's notation needs and `cmnName` only hints at: `236LP` is
 * light punch, `236PP` is the OD one, and a family is the four of them. The
 * action names are Japanese move names, so nothing matches them by string.
 *
 * Returns `Special_<n>` -> { button, slots: strength -> action }.
 */
const STRENGTHS = ["Light", "Middle", "Heavy"];
function specialFamilies(triggerFile, byId, sigs) {
  const out = new Map();
  // In the dump's own order, so that "the first trigger for a strength wins"
  // means the base variant rather than whichever slot key JavaScript hoists.
  // See `triggersInOrder`.
  for (const [, trigger] of triggersInOrder(triggerFile)) {
    const kinds = Object.entries(trigger)
      .filter(([k, v]) => k.startsWith("_Is") && v === true)
      .map(([k]) => k.slice(3));
    const family = kinds.find((k) => /^Special_\d+$/.test(k));
    const strength = kinds.includes("Extra") ? "Extra" : STRENGTHS.find((s) => kinds.includes(s));
    if (!family || !strength) continue;
    const action = byId.get(trigger.action_id);
    // A fireball's own action has no hitbox — the projectile is a separate
    // action and the frame it spawns on is not extracted — so those families
    // have nothing to score and are left out. See docs/adr/0021.
    if (!action || !sigs.get(action.id)) continue;
    if (!out.has(family)) out.set(family, { button: null, slots: new Map() });
    const fam = out.get(family);
    fam.button ??= kinds.includes("Punch") ? "P" : kinds.includes("Kick") ? "K" : null;
    if (!fam.slots.has(strength)) fam.slots.set(strength, action);
  }
  return out;
}

/** `236LP` -> light punch on the `236P` family; `214KK (air)` -> OD on `214K(air)`. */
const BUTTONS = { LP: "Light", MP: "Middle", HP: "Heavy", LK: "Light", MK: "Middle", HK: "Heavy" };
function notationFamily(input) {
  const m = /^([\[\]0-9]+)(PP|KK|LP|MP|HP|LK|MK|HK)\s*(.*)$/.exec(input ?? "");
  if (!m) return null;
  const [, motion, btn, tag] = m;
  const button = btn.includes("P") ? "P" : "K";
  return {
    key: `${motion}${button}${tag.trim()}`,
    button,
    strength: btn === "PP" || btn === "KK" ? "Extra" : BUTTONS[btn],
  };
}

/**
 * Assign FAT's special families onto the dump's, whole family at a time.
 *
 * Matching one move at a time is what put Drive Impact on a special in ADR-0017:
 * a single startup is a weak fingerprint and several families share one. A
 * family is a much stronger one — three or four startups that all have to agree
 * at once — so this scores every (notation family, dump family) pair by mean
 * disagreement, takes them cheapest first, and lets each side be used once.
 * Nothing averaging worse than a frame is taken at all.
 *
 * Returns FAT move -> action.
 */
function assignSpecials(fatMoves, families, sigs) {
  const byNotation = new Map();
  for (const move of fatMoves) {
    if (move.moveType !== "special") continue;
    const parsed = notationFamily(move.numCmd);
    const startup = int(move.startup);
    if (!parsed?.strength || startup === undefined) continue;
    if (!byNotation.has(parsed.key)) byNotation.set(parsed.key, { button: parsed.button, slots: new Map() });
    // FAT reuses a notation for charge variants (Ryu's two `236PP`); the first
    // is the plain one and the rest stay unmapped rather than overwrite it.
    const slots = byNotation.get(parsed.key).slots;
    if (!slots.has(parsed.strength)) slots.set(parsed.strength, { move, startup });
  }

  const pairs = [];
  for (const [key, notation] of byNotation) {
    for (const [family, fam] of families) {
      if (fam.button && fam.button !== notation.button) continue;
      const paired = [...notation.slots].filter(([strength]) => fam.slots.has(strength));
      if (paired.length < 2) continue;
      const cost = paired.reduce(
        (sum, [strength, m]) => sum + Math.abs(sigs.get(fam.slots.get(strength).id).startup - m.startup),
        0,
      );
      pairs.push({ key, family, fam, paired, per: cost / paired.length });
    }
  }
  pairs.sort((a, b) => a.per - b.per || b.paired.length - a.paired.length);

  const out = new Map();
  const takenNotation = new Set();
  const takenFamily = new Set();
  for (const pair of pairs) {
    if (pair.per > 1 || takenNotation.has(pair.key) || takenFamily.has(pair.family)) continue;
    takenNotation.add(pair.key);
    takenFamily.add(pair.family);
    for (const [strength, m] of pair.paired) out.set(m.move, pair.fam.slots.get(strength));
  }
  return out;
}

/**
 * Map a FAT move onto an action. Names get us a candidate set; FAT's startup
 * picks the right sibling (Ryu's `ATK_5HK` is 5HK at startup 12, `ATK_5HK(1)`
 * is the 5HP > HK follow-up at 9, `ATK_5HK_2` the 5MP > LK > HK one at 17).
 */
function mapMove(fatMove, actions, sigs, superActions, specials) {
  const fatStartup = int(fatMove.startup);
  const system = SYSTEM_ACTIONS[fatMove.cmnName];
  const level = superLevel(fatMove.cmnName);
  const levelPool = level !== null ? (superActions?.get(level) ?? new Set()) : null;
  const specialAction = specials?.get(fatMove);
  // Classified outright, but still scored the ordinary way: the match quality has
  // to stay honest about whether the frames agree.
  let pool = system
    ? actions.filter((a) => a.name === system)
    : levelPool?.size
      ? actions.filter((a) => levelPool.has(a.id) && isSuperAction(a.name))
      : specialAction
        ? [specialAction]
        : candidatesFor(fatMove.numCmd, actions).filter((a) => !isSystemAction(a.name));

  // A frozen action's frames run `freeze - 1` later than FAT's, so the comparison
  // has to happen in one frame space. The `- 1` is the frame the freeze and the
  // startup share, the same off-by-one CONTEXT.md's `total` identity carries.
  const inFatSpace = (action, startup) => (action.freeze ? startup - action.freeze + 1 : startup);
  // Prefer the newest rebalance of a move, but only between candidates the frames
  // cannot separate. As a filter it was a trap once ADR-0022 gave shot-only
  // actions a signature: Juri's only `_Y2` named `ATK_5MP*` is a super handoff,
  // and preferring it outright took her 5MP off `ATK_5MP` at a delta of 73.
  const year = (a) => (/_Y\d$/.test(a.name) ? 0 : 1);
  const scored = pool
    .map((a) => ({ action: a, sig: sigs.get(a.id) }))
    .filter((c) => c.sig)
    .map((c) => ({
      ...c,
      delta:
        fatStartup === undefined ? null : Math.abs(inFatSpace(c.action, c.sig.startup) - fatStartup),
    }))
    .sort((a, b) => (a.delta ?? 99) - (b.delta ?? 99) || year(a.action) - year(b.action));

  const best = scored[0];
  if (best && best.delta !== null && best.delta <= 1) {
    return mapping(fatMove, best, best.delta === 0 ? "exact" : "close", scored);
  }

  // A move `cmnName` classifies is identified that way or not at all — a
  // coincidental frame profile is what put Drive Impact on a special to begin
  // with. The class is certain; agreeing with FAT's startup is a separate
  // question, so the label still comes from the frames. Drive Reversal lands
  // `weak` on every fighter because FAT's startup for it is 4 higher than the
  // action's own first active frame — consistently, so a structural difference
  // rather than a bad match. See docs/adr/0017 and docs/adr/0018.
  if (system || levelPool?.size || specialAction) return best ? mapping(fatMove, best, "weak", scored) : null;

  // No plausibly-named action: fall back to a unique frame-data fingerprint.
  // This is how notation disagreements get caught (Ryu's 6HK is ATK_3HK) and how
  // specials land, since their action names are Japanese move names, not inputs.
  const unique = frameUnique(fatMove, sigs, actions.filter((a) => !isSystemAction(a.name)));
  if (unique) return mapping(fatMove, unique, "frame-unique", []);

  return best ? mapping(fatMove, best, "weak", scored) : null;
}

function mapping(fatMove, cand, match, scored) {
  return {
    input: fatMove.numCmd,
    name: fatMove.moveName,
    action: cand.action.id,
    actionName: cand.action.name,
    match,
    startup: cand.sig.startup,
    active: cand.sig.active,
    hits: cand.sig.hits,
    ...(cand.action.freeze ? { freeze: cand.action.freeze } : {}),
    fat: {
      startup: fatMove.startup ?? null,
      active: fatMove.active ?? null,
      recovery: fatMove.recovery ?? null,
      onBlock: fatMove.onBlock ?? null,
      onHit: fatMove.onHit ?? null,
    },
    // `startup` is the action's own first active frame; `startupDelta` compares it
    // to FAT in FAT's frame space, which for a frozen action means net of the
    // cinematic freeze. The two differ by `freeze - 1` and both are wanted: the
    // sim counts in the action's frames, the grader in FAT's. See docs/adr/0019.
    startupDelta:
      int(fatMove.startup) === undefined
        ? null
        : (cand.action.freeze ? cand.sig.startup - cand.action.freeze + 1 : cand.sig.startup) -
          int(fatMove.startup),
    alternates: scored.slice(1, 4).map((c) => c.action.id),
  };
}

/**
 * The one action whose startup AND first active window match the frame data.
 * Scoped by category, or a throw would happily match a normal that happens to
 * share a 5f startup (Akuma's LPLK vs his 5LK).
 */
function frameUnique(fatMove, sigs, actions) {
  const startup = int(fatMove.startup);
  const active = int(fatMove.active);
  if (startup === undefined || active === undefined) return null;
  const named = (a) => a.name.startsWith("ATK_");
  const inScope =
    fatMove.moveType === "normal"
      ? named
      : fatMove.moveType === "throw"
        ? (a) => a.hit.some((h) => h.kind === "throw")
        : (a) => !named(a);
  const hits = [];
  for (const a of actions) {
    if (!inScope(a)) continue;
    const sig = sigs.get(a.id);
    if (sig && sig.startup === startup && sig.active === active) hits.push({ action: a, sig });
  }
  return hits.length === 1 ? hits[0] : null;
}

const isPlainInt = (v) => typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()));

/**
 * A move's special-cancel window: the frames on which pressing a special comes
 * out, plus the buffer window in front of it.
 *
 * A group is a *special* cancel list rather than a target combo when it holds
 * something that is not a normal — specials are named for the move in Japanese,
 * so there is no name pattern to match on, but "not all `ATK_`" holds across all
 * 24 fighters. The neutral list is excluded because idle actions open it too.
 *
 * The live window never opens before the move's own first active frame — on a
 * single-hit normal it opens on it — and the buffered key in front of it is the
 * input buffer. Validated against FAT's `xx` column, which says independently
 * which normals are special-cancellable at all.
 */
function cancelWindow(actions, cancelGroups, triggers, neutralGroups, move) {
  const action = actions.find((a) => a.id === move.action);
  if (!action?.cancels?.length) return null;
  const neutral = new Set(neutralGroups);
  // A group entry we can't resolve is not evidence of anything: several fighters
  // open a one-frame group holding a single boxless action at the end of a heavy
  // (Chun-Li's stance handoff), which would otherwise read as a special cancel.
  const isSpecialList = (gid) =>
    !neutral.has(gid) &&
    (cancelGroups[gid] ?? []).some((index) => {
      const name = actions.find((a) => a.id === triggers[index]?.action)?.name;
      return name && !name.startsWith("ATK_");
    });

  const strikes = action.hit.filter((h) => h.kind !== "proximity");
  if (!strikes.length) return null;
  const firstActive = Math.min(...strikes.map((h) => h.start));

  const keys = action.cancels.filter((c) => isSpecialList(c.group));
  const all = keys.filter((c) => !c.buffered && c.end >= firstActive);
  if (!all.length) return null;
  // A key whose low nibble is 4 opens *after* the active frames and is the Drive
  // Rush extension, not a special cancel: FAT's `hcWinSpCa` ends where the
  // nibble-11 key ends and excludes it, on 4 of 4 moves that carry one. Dropping
  // it would sometimes leave no window at all, and an empty window is a worse
  // answer than a long one. See docs/adr/0015.
  const narrowed = all.filter((c) => (c.cond & 15) !== 4);
  const live = narrowed.length ? narrowed : all;
  const buffer = keys.filter((c) => c.buffered);
  return {
    start: Math.min(...live.map((c) => c.start)),
    end: Math.max(...live.map((c) => c.end)),
    buffer: buffer.length ? Math.min(...buffer.map((c) => c.start)) : null,
    groups: [...new Set(live.map((c) => c.group))].sort((a, b) => a - b),
  };
}

/**
 * Standing height, and the pushbox half-widths that set how close two
 * characters can stand — the minimum distance between their origins is the sum
 * of their facing half-widths.
 */
function calibrate(actions) {
  const byName = (name) => actions.find((a) => a.name === name);
  const stand = byName("BAS_STD_Loop") ?? actions.find((a) => a.hurt.length);
  const boxes = stand?.hurt.flatMap((h) => [...h.head, ...h.body, ...h.leg]) ?? [];
  if (!boxes.length) return null;
  const halfWidth = (action) => {
    const box = action?.push[0]?.box;
    return box ? Math.max(Math.abs(box.x), Math.abs(box.x + box.width)) : null;
  };
  return {
    standingHeight: Math.max(...boxes.map((b) => b.y + b.height)),
    standingHalfWidth: Math.max(...boxes.map((b) => Math.max(Math.abs(b.x), Math.abs(b.x + b.width)))),
    standAction: stand.id,
    crouchAction: byName("BAS_CRH_Loop")?.id ?? null,
    pushHalfWidth: { stand: halfWidth(stand), crouch: halfWidth(byName("BAS_CRH_Loop")) },
  };
}

async function buildCharacter(fatName, dumpDir, fat, source) {
  const dir = path.join(RAW, dumpDir);
  const [rectsFile, movesFile, hitFile, groupFile, triggerFile, infoFile, commandFile, atemiFile, commonAtemiFile, commonRectsFile] =
    await Promise.all([
      readFile(path.join(dir, "rects.json"), "utf8").then(JSON.parse),
      readFile(path.join(dir, "moves_dict.json"), "utf8").then(JSON.parse),
      readFile(path.join(dir, "HIT_DT.json"), "utf8").then(JSON.parse).catch(() => null),
      readFile(path.join(dir, "tgroups.json"), "utf8").then(JSON.parse).catch(() => null),
      readFile(path.join(dir, "triggers.json"), "utf8").then(JSON.parse).catch(() => null),
      readFile(path.join(dir, "char_info.json"), "utf8").then(JSON.parse).catch(() => null),
      readFile(path.join(dir, "commands.json"), "utf8").then(JSON.parse).catch(() => null),
      // The atemi table ships as two layers, and the shared one sits at the dump
      // root rather than under the fighter. Absent from any dump taken before
      // MMDK's "Dump Atemis" button was found; the read side falls back then.
      readFile(path.join(dir, "atemi.json"), "utf8").then(JSON.parse).catch(() => null),
      readFile(path.join(RAW, "common_atemi.json"), "utf8").then(JSON.parse).catch(() => null),
      // The shared rect tables, dumped once for the roster. See `makeRects`.
      readFile(path.join(RAW, "common_rects.json"), "utf8").then(JSON.parse).catch(() => null),
    ]);
  const rectStats = { viaCommon: new Map() };
  const rect = makeRects(rectsFile, commonRectsFile, rectStats);

  const actions = [];
  const unresolvedPush = new Set();
  for (const action of Object.values(movesFile)) {
    if (typeof action?.id !== "number" || !action.name) continue;
    const extracted = extractAction(action, rect, unresolvedPush);
    // No boxes at all is normally a round intro or a win pose. `NGD_*` is the
    // exception: being thrown is a real state a fighter spends frames in, and it
    // carries no boxes precisely because you cannot be hit while held. A state
    // machine needs it; the grader never did. See docs/adr/0025.
    const stateOnly = /^NGD_/.test(extracted.name);
    if (
      !stateOnly &&
      !extracted.hit.length &&
      !extracted.hurt.length &&
      !extracted.prox.length &&
      !extracted.push.length
    ) {
      continue;
    }
    actions.push(extracted);
  }
  actions.sort((a, b) => a.id - b.id);
  spliceContinuations(actions);
  // Airborne actions have no margin of their own; theirs is on the landing.
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (const action of actions) {
    if (action.marginFrame > 0) continue;
    const lands = extractLanding(action, byId);
    if (lands) action.lands = lands;
  }
  const sigs = new Map(actions.map((a) => [a.id, signature(a, byId)]));

  const fatMoves = Object.values(fat.moves.normal);
  const superActions = superActionsByLevel(triggerFile);
  const specials = assignSpecials(fatMoves, specialFamilies(triggerFile, byId, sigs), sigs);
  const moves = [];
  const unmapped = [];
  for (const m of fatMoves) {
    if (!m.numCmd) continue;
    const mapped = mapMove(m, actions, sigs, superActions, specials);
    if (mapped) moves.push({ ...mapped, category: m.moveType });
    else unmapped.push({ input: m.numCmd, name: m.moveName, category: m.moveType });
  }

  const referenced = new Set(actions.flatMap((a) => (a.cancels ?? []).map((c) => c.group)));
  const cancelGroups = extractCancelGroups(groupFile, referenced);
  const triggers = extractTriggers(triggerFile, new Set(Object.values(cancelGroups).flat()), commandFile);
  const unresolvedTriggers = Object.values(cancelGroups)
    .flat()
    .filter((index) => !triggers[index]).length;
  // The idle actions' own groups are the neutral list — everything the fighter
  // can do from standing. Any other group an attack opens is a cancel list.
  const idle = actions.filter((a) => /^BAS_(STD|CRH)_Loop$/.test(a.name));
  const neutralGroups = [...new Set(idle.flatMap((a) => (a.cancels ?? []).map((c) => c.group)))].sort(
    (a, b) => a - b,
  );
  // FAT's `xx` column lists a normal's cancel options, so it is an independent
  // check on the windows: `sp`/`su` there should mean a window here.
  const cancelMismatches = [];
  for (const move of moves) {
    const window = cancelWindow(actions, cancelGroups, triggers, neutralGroups, move);
    if (window) move.cancel = window;
    if (move.category !== "normal" || move.input.includes(">")) continue;
    const fatMove = fatMoves.find((m) => m.numCmd === move.input);
    const fatSays = Array.isArray(fatMove?.xx) && (fatMove.xx.includes("sp") || fatMove.xx.includes("su"));
    if (fatSays !== !!window) {
      cancelMismatches.push({ input: move.input, actionName: move.actionName, match: move.match, fatSays });
    }
  }

  const id = slug(fatName);
  const atemi = extractAtemi(commonAtemiFile, atemiFile);
  const out = {
    character: fatName,
    id,
    source: {
      geometry: `MMDK (alphazolam/MMDK) @ ${source.commit.slice(0, 8)} — dump of the game's CharacterAsset data`,
      frames: "FAT (D4RKONION/FrameDataAssistantTool) SF6FrameData.json",
      note: "Boxes are game units: x=0 is the character origin, y=0 the ground, +x forward.",
    },
    calibration: calibrate(actions),
    fighter: extractFighter(infoFile),
    atemi,
    hitData: extractHitData(hitFile),
    cancelGroups,
    triggers,
    neutralGroups,
    counts: {
      actions: actions.length,
      withPushboxes: actions.filter((a) => a.push.length).length,
      withMotion: actions.filter((a) => a.motion).length,
      hitData: Object.keys(extractHitData(hitFile)).length,
      withHitboxes: actions.filter((a) => a.hit.some((h) => h.kind !== "proximity")).length,
      mapped: moves.length,
      exact: moves.filter((m) => m.match === "exact").length,
      weak: moves.filter((m) => m.match === "weak").length,
      cancelGroups: Object.keys(cancelGroups).length,
      triggers: Object.keys(triggers).length,
      withCancels: actions.filter((a) => a.cancels).length,
      cancellable: moves.filter((m) => m.cancel).length,
      cancelMismatches: cancelMismatches.length,
      atemi: Object.keys(atemi ?? {}).length,
    },
    moves,
    unmapped,
    actions,
  };

  await mkdir(OUT, { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(path.join(OUT, `${id}.json`), json);
  // The box viewer is served straight out of web/, so it gets its own copy.
  await writeFile(path.join(root, "web", `${id}.boxes.json`), json);
  const { actions: n, withHitboxes, mapped, exact, cancellable } = out.counts;
  console.log(
    `${fatName}: ${n} actions (${withHitboxes} with hitboxes), ` +
      `${mapped} moves mapped (${exact} name+frame exact, ${cancellable} special-cancellable) ` +
      `-> data/geometry/${id}.json`,
  );
  for (const c of cancelMismatches) {
    const disagreement = c.fatSays ? "FAT says cancellable, no window found" : "window found, FAT says not cancellable";
    console.log(`  ? ${c.input.padEnd(16)} ${c.actionName.padEnd(16)} ${disagreement} (${c.match})`);
  }
  if (rectStats.viaCommon.size) {
    const via = [...rectStats.viaCommon.entries()].map(([k, n]) => `${k} x${n}`).join(", ");
    console.log(`  + boxes from the shared rect tables (list/id): ${via}`);
  }
  if (unresolvedPush.size) {
    // BoxNo 6 is the downed-state pushbox, which lives in a shared asset MMDK
    // does not dump per fighter. Only knockdown/tech actions reference it.
    console.log(`  ! pushbox BoxNo not in either rect list: ${[...unresolvedPush].sort((a, b) => a - b).join(", ")}`);
  }
  return {
    id,
    name: fatName,
    // Only the mappings worth a human's attention: a name we had to guess at, or
    // geometry that disagrees with the published frames.
    mismatches: moves.filter(
      (m) => m.match === "weak" || m.startupDelta || (isPlainInt(m.fat.active) && m.active !== int(m.fat.active)),
    ),
  };
}

const fat = JSON.parse(await readFile(path.join(root, "data/raw/SF6FrameData.json"), "utf8"));
const stampPath = path.join(RAW, "source.json");
if (!existsSync(stampPath)) {
  console.error("no dumps found — run: node scripts/fetch-mmdk.mjs Ryu Akuma");
  process.exit(1);
}
const source = JSON.parse(await readFile(stampPath, "utf8"));

const requested = process.argv.slice(2);
// No arguments means every character that has been dumped. It used to mean Ryu
// and Akuma, which silently left the other 22 files stale after a rebuild.
const wanted = (requested.length ? requested : source.characters).map((name) => {
  const dumpDir = source.characters.find((c) => norm(c) === norm(name));
  const fatName = Object.keys(fat).find((k) => norm(k) === norm(name));
  if (!dumpDir) throw new Error(`no dump for "${name}" — run: node scripts/fetch-mmdk.mjs ${name}`);
  if (!fatName) throw new Error(`no FAT frame data for "${name}"`);
  return { fatName, dumpDir };
});

const built = [];
for (const { fatName, dumpDir } of wanted) {
  const { id, mismatches } = await buildCharacter(fatName, dumpDir, fat[fatName], source);
  built.push({ id, name: fatName });
  for (const m of mismatches) {
    console.log(
      `  ~ ${m.input.padEnd(16)} ${m.actionName.padEnd(16)} ` +
        `geometry ${m.startup}/${m.active} vs FAT ${m.fat.startup}/${m.fat.active} (${m.match})`,
    );
  }
}

// The box viewer's own character list. Separate from web/characters.json, which
// build-site.mjs owns and which only holds characters that have move art.
const indexPath = path.join(root, "web", "boxes-index.json");
const existing = existsSync(indexPath) ? JSON.parse(await readFile(indexPath, "utf8")) : [];
const merged = [...existing.filter((c) => !built.some((b) => b.id === c.id)), ...built].sort((a, b) =>
  a.name.localeCompare(b.name),
);
await writeFile(indexPath, JSON.stringify(merged, null, 2));
console.log(`boxes-index.json: ${merged.length} characters`);
