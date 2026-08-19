/**
 * Compare two extracted geometry files and say what actually moved.
 *
 *   node scripts/diff-geometry.mjs data/geometry/ryu.json /tmp/fresh/ryu.json
 *
 * The point is version skew. The committed pipeline reads a *pinned* MMDK
 * snapshot (`data/raw/mmdk/source.json`), and the game has been patched since.
 * Every disagreement `sf6 verify` reports has two possible causes — we read the
 * dump wrong, or the dump is older than the frame data we grade it against —
 * and until this diff is run there is no way to tell them apart.
 *
 * Diffing the raw dumps is useless: Ryu's `moves_dict` alone is 8.6 MB of
 * mostly-cosmetic keys. This diffs the *extracted* artifact instead, which is
 * exactly the subset the engine consumes, so anything it reports is something
 * that can change an answer.
 */

import { readFile } from "node:fs/promises";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/diff-geometry.mjs <before.json> <after.json>");
  process.exit(1);
}

const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));

const changes = [];
const record = (area, what, from, to) => changes.push({ area, what, from, to });

/** Scalars worth comparing on an action: everything a check or the sim reads. */
const ACTION_FIELDS = ["frames", "mainFrame", "marginFrame", "freeze"];

function diffActions() {
  const byId = (file) => new Map(file.actions.map((a) => [a.id, a]));
  const b = byId(before);
  const a = byId(after);
  for (const [id, action] of a) if (!b.has(id)) record("action", `+ ${action.name} (${id})`, "-", "added");
  for (const [id, action] of b) if (!a.has(id)) record("action", `- ${action.name} (${id})`, "present", "gone");
  for (const [id, was] of b) {
    const now = a.get(id);
    if (!now) continue;
    for (const field of ACTION_FIELDS) {
      if ((was[field] ?? null) !== (now[field] ?? null)) {
        record("action", `${was.name}.${field}`, was[field] ?? "-", now[field] ?? "-");
      }
    }
    // Hit windows: the frames a move is actually active on.
    const windows = (x) =>
      (x.hit ?? [])
        .filter((h) => h.kind !== "proximity")
        .map((h) => `${h.start}-${h.end}#${h.hitId}/${h.attackData}`)
        .join(",");
    if (windows(was) !== windows(now)) record("hitkeys", was.name, windows(was) || "-", windows(now) || "-");
    // Launch speed, which is what a projectile's whole flight hangs off.
    if ((was.motion?.launch ?? null) !== (now.motion?.launch ?? null)) {
      record("speed", was.name, was.motion?.launch ?? "-", now.motion?.launch ?? "-");
    }
  }
}

/** The outcome table: the numbers every grader check is built on. */
const OUTCOME_FIELDS = ["damage", "stun", "downTime", "dmgType", "recoverable"];

function diffHitData() {
  const b = before.hitData ?? {};
  const a = after.hitData ?? {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const was = b[key];
    const now = a[key];
    if (!was) { record("hitData", `+ row ${key}`, "-", "added"); continue; }
    if (!now) { record("hitData", `- row ${key}`, "present", "gone"); continue; }
    for (const condition of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const x = was[condition];
      const y = now[condition];
      if (!x || !y) { record("hitData", `row ${key}.${condition}`, x ? "present" : "-", y ? "present" : "-"); continue; }
      for (const field of OUTCOME_FIELDS) {
        if ((x[field] ?? null) !== (y[field] ?? null)) {
          record("hitData", `row ${key}.${condition}.${field}`, x[field] ?? "-", y[field] ?? "-");
        }
      }
    }
  }
}

/** Which action each notation maps to — a change here moves every check at once. */
function diffMoves() {
  const byInput = (file) => new Map(file.moves.map((m) => [m.input, m]));
  const b = byInput(before);
  const a = byInput(after);
  for (const [input, move] of a) if (!b.has(input)) record("move", `+ ${input}`, "-", move.actionName);
  for (const [input, move] of b) if (!a.has(input)) record("move", `- ${input}`, move.actionName, "gone");
  for (const [input, was] of b) {
    const now = a.get(input);
    if (!now) continue;
    if (was.action !== now.action) record("move", `${input} -> action`, was.actionName, now.actionName);
    if (was.startup !== now.startup) record("move", `${input}.startup`, was.startup, now.startup);
    if (was.match !== now.match) record("move", `${input}.match`, was.match, now.match);
  }
}

diffActions();
diffHitData();
diffMoves();

const areas = [...new Set(changes.map((c) => c.area))];
console.log(`${before.character}: ${changes.length} change${changes.length === 1 ? "" : "s"}`);
console.log(`  ${before.actions.length} -> ${after.actions.length} actions, ` +
  `${before.moves.length} -> ${after.moves.length} moves, ` +
  `${Object.keys(before.hitData ?? {}).length} -> ${Object.keys(after.hitData ?? {}).length} hit rows`);

if (!changes.length) {
  console.log("\n  Identical. The pinned snapshot is not stale for this character, so");
  console.log("  version skew is not what any of its disagreements are made of.");
  process.exit(0);
}

for (const area of areas) {
  const rows = changes.filter((c) => c.area === area);
  console.log(`\n  ${area} (${rows.length})`);
  for (const row of rows.slice(0, 40)) {
    console.log(`    ${String(row.what).padEnd(44)} ${String(row.from)} -> ${row.to}`);
  }
  if (rows.length > 40) console.log(`    ... and ${rows.length - 40} more`);
}
