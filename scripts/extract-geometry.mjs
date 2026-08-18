/**
 * Turns MMDK's raw fighter dumps into data/geometry/<char>.json — per-frame
 * hitbox / hurtbox / proximity-box geometry, plus a mapping from FAT move
 * notation onto the game's action ids.
 *
 *   node scripts/fetch-mmdk.mjs Ryu Akuma      # once, populates data/raw/mmdk/
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
 *   DamageCollisionKey  Head/Body/Leg/ThrowList   -> rects[8]              (hurtbox)
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
const RAW = path.join(root, "data/raw/mmdk");
const OUT = path.join(root, "data/geometry");

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

function makeRects(rectsFile) {
  const lists = new Map();
  for (const [listId, list] of Object.entries(rectsFile)) {
    if (!list || typeof list !== "object") continue;
    const byId = new Map();
    for (const [boxId, rect] of Object.entries(list)) byId.set(Number(boxId), rect);
    lists.set(Number(listId), byId);
  }
  return (listId, boxId) => lists.get(listId)?.get(Number(boxId));
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
      throw: boxesFrom(rect, RECT_HURT, key.ThrowList, key.RootOffset),
    };
    if (!Object.values(parts).some((b) => b.length)) continue;
    const entry = { start, end, ...parts };
    if (key.Immune) entry.immune = key.Immune;
    // `TypeFlag` says which kinds of attack the box answers to at all: 1 strike,
    // 2 projectile. 3 is the ordinary box and is left off. See ADR-0014.
    if ((key.TypeFlag ?? 3) !== 3) entry.typeFlag = key.TypeFlag ?? 0;
    hurt.push(entry);
  }

  const push = [];
  for (const key of ordered(action.PushCollisionKey)) {
    const start = key._StartFrame + 1;
    const end = key._EndFrame;
    if (end < start) continue;
    const rct = rect(RECT_PUSH_OVERRIDE, key.BoxNo) ?? rect(RECT_PUSH_BASE, key.BoxNo);
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
  const motion = extractMotion(action, fab.Frame);
  if (motion) out.motion = motion;
  if (branches.length) out.branches = dedupeBranches(branches);
  if (action.mot_name) out.mot = action.mot_name;
  return out;
}

/**
 * A hit-data entry's `common` list is indexed by how the attack landed. Read off
 * the numbers: entry 1 deals no damage and hands the defender Drive, entry 2 is
 * damage x1.2 with exactly 2 more frames of stun, entry 3 exactly 4 more — which
 * is SF6's counter hit and punish counter to the frame.
 */
const HIT_CONDITIONS = ["hit", "block", "counter", "punishCounter", "driveHit"];

/** The fields worth keeping out of ~200 per entry. */
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
  };
  if (entry.ArmorPoint) out.armor = entry.ArmorPoint;
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
function extractTriggers(file, used) {
  const out = {};
  for (const slots of Object.values(file ?? {})) {
    if (!slots || typeof slots !== "object") continue;
    for (const [index, trigger] of Object.entries(slots)) {
      const id = Number(index);
      if (!used.has(id) || !trigger || typeof trigger !== "object") continue;
      // Classic is the style that has a command on all but 32 triggers; the
      // others are Modern and the assist styles, which reuse the same trigger.
      const style = ["norm", "sprt", "easy", "supr"].find((s) => (trigger[s]?.command_index ?? -1) > -1);
      const record = {
        action: trigger.action_id,
        /** Input buffer in frames: 4 almost everywhere, 6 on air specials. */
        buffer: trigger[style ?? "norm"]?.preceding_time ?? 0,
      };
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
function signature(action) {
  const strikes = action.hit.filter((h) => h.kind !== "proximity");
  if (!strikes.length) return null;
  const start = Math.min(...strikes.map((h) => h.start));
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
    hits: strikes.length,
  };
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
 * Map a FAT move onto an action. Names get us a candidate set; FAT's startup
 * picks the right sibling (Ryu's `ATK_5HK` is 5HK at startup 12, `ATK_5HK(1)`
 * is the 5HP > HK follow-up at 9, `ATK_5HK_2` the 5MP > LK > HK one at 17).
 */
function mapMove(fatMove, actions, sigs) {
  const fatStartup = int(fatMove.startup);
  let pool = candidatesFor(fatMove.numCmd, actions);

  // Prefer the newest rebalance of a move when both are present.
  const years = pool.filter((a) => /_Y\d$/.test(a.name));
  if (years.length) pool = years;

  const scored = pool
    .map((a) => ({ action: a, sig: sigs.get(a.id) }))
    .filter((c) => c.sig)
    .map((c) => ({ ...c, delta: fatStartup === undefined ? null : Math.abs(c.sig.startup - fatStartup) }))
    .sort((a, b) => (a.delta ?? 99) - (b.delta ?? 99));

  const best = scored[0];
  if (best && best.delta !== null && best.delta <= 1) {
    return mapping(fatMove, best, best.delta === 0 ? "exact" : "close", scored);
  }

  // No plausibly-named action: fall back to a unique frame-data fingerprint.
  // This is how notation disagreements get caught (Ryu's 6HK is ATK_3HK) and how
  // specials land, since their action names are Japanese move names, not inputs.
  const unique = frameUnique(fatMove, sigs, actions);
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
    fat: {
      startup: fatMove.startup ?? null,
      active: fatMove.active ?? null,
      recovery: fatMove.recovery ?? null,
      onBlock: fatMove.onBlock ?? null,
      onHit: fatMove.onHit ?? null,
    },
    startupDelta: int(fatMove.startup) === undefined ? null : cand.sig.startup - int(fatMove.startup),
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
  const live = keys.filter((c) => !c.buffered && c.end >= firstActive);
  if (!live.length) return null;
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
  const [rectsFile, movesFile, hitFile, groupFile, triggerFile] = await Promise.all([
    readFile(path.join(dir, "rects.json"), "utf8").then(JSON.parse),
    readFile(path.join(dir, "moves_dict.json"), "utf8").then(JSON.parse),
    readFile(path.join(dir, "HIT_DT.json"), "utf8").then(JSON.parse).catch(() => null),
    readFile(path.join(dir, "tgroups.json"), "utf8").then(JSON.parse).catch(() => null),
    readFile(path.join(dir, "triggers.json"), "utf8").then(JSON.parse).catch(() => null),
  ]);
  const rect = makeRects(rectsFile);

  const actions = [];
  const unresolvedPush = new Set();
  for (const action of Object.values(movesFile)) {
    if (typeof action?.id !== "number" || !action.name) continue;
    const extracted = extractAction(action, rect, unresolvedPush);
    if (!extracted.hit.length && !extracted.hurt.length && !extracted.prox.length && !extracted.push.length) {
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
  const sigs = new Map(actions.map((a) => [a.id, signature(a)]));

  const fatMoves = Object.values(fat.moves.normal);
  const moves = [];
  const unmapped = [];
  for (const m of fatMoves) {
    if (!m.numCmd) continue;
    const mapped = mapMove(m, actions, sigs);
    if (mapped) moves.push({ ...mapped, category: m.moveType });
    else unmapped.push({ input: m.numCmd, name: m.moveName, category: m.moveType });
  }

  const referenced = new Set(actions.flatMap((a) => (a.cancels ?? []).map((c) => c.group)));
  const cancelGroups = extractCancelGroups(groupFile, referenced);
  const triggers = extractTriggers(triggerFile, new Set(Object.values(cancelGroups).flat()));
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
  const out = {
    character: fatName,
    id,
    source: {
      geometry: `MMDK (alphazolam/MMDK) @ ${source.commit.slice(0, 8)} — dump of the game's CharacterAsset data`,
      frames: "FAT (D4RKONION/FrameDataAssistantTool) SF6FrameData.json",
      note: "Boxes are game units: x=0 is the character origin, y=0 the ground, +x forward.",
    },
    calibration: calibrate(actions),
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
const wanted = (requested.length ? requested : ["Ryu", "Akuma"]).map((name) => {
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
