/**
 * How much of the project's residual is version skew?
 *
 * The geometry comes from a dump of one game build; FAT's frame data is current.
 * Every `sf6 verify` percentage therefore carries an unquantified confound, and
 * `docs/agents/refresh-the-dump.md` has said so since the second dump became
 * possible without being able to put a number on it. This puts the number on it.
 *
 *   node scripts/skew-audit.mjs data/geometry /tmp/fresh-geo
 *
 * It grades both trees (`sf6 rows`, one child process each, since the loader
 * takes its directory from the environment), intersects the rosters, and reports
 * per check:
 *
 *   dumpMoved   rows whose value differs between the two builds
 *   skewFixed   rows the older tree got wrong and the newer one gets right
 *   skewBroke   rows the older tree got right and the newer one gets wrong —
 *               not an error but a measurement of FAT's own currency
 *
 * A row is `<check>|<character>|<move>`; rows present in one tree only (the move
 * mapped elsewhere, or the action is new) are excluded and counted separately,
 * because a missing row is a mapping difference rather than a disagreement.
 * See docs/adr/0043.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node scripts/skew-audit.mjs <olderTree> <newerTree>");
  process.exit(1);
}

/** `sf6 rows` against one tree. Restricted to `only` when given. */
function grade(dir, only = []) {
  const out = execFileSync("npx", ["tsx", "src/cli/index.ts", "rows", ...only], {
    cwd: root,
    env: { ...process.env, GEOMETRY_DIR: path.resolve(dir) },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// The newer tree first, to learn which characters it has: the live dump is a
// subset of the pinned one in some fighters and a superset in patches.
const newer = grade(b);
const older = grade(a, newer.characters);
const roster = newer.characters.filter((c) => older.characters.includes(c));

const shared = Object.keys(older.rows).filter((k) => k in newer.rows && roster.includes(k.split("|")[1]));
const onlyOlder = Object.keys(older.rows).filter((k) => !(k in newer.rows)).length;
const onlyNewer = Object.keys(newer.rows).filter((k) => !(k in older.rows)).length;

console.log(`\n${path.basename(a)} -> ${path.basename(b)}, ${roster.length} characters both trees have\n`);
console.log(
  `  ${shared.length} rows in both, ${onlyOlder} only in the older tree, ${onlyNewer} only in the newer ` +
    `(mapping differences, not disagreements)\n`,
);

const head = `  ${"check".padEnd(16)}${"n".padStart(6)}${"older".padStart(9)}${"newer".padStart(9)}${"delta".padStart(8)}   ${"dumpMoved".padStart(9)}${"skewFixed".padStart(10)}${"skewBroke".padStart(10)}`;
console.log(head);
console.log(`  ${"-".repeat(head.length - 2)}`);

const checks = [...new Set(shared.map((k) => k.split("|")[0]))].sort();
const all = { n: 0, old: 0, new: 0, moved: 0, fixed: 0, broke: 0 };
const rate = (n, of) => (of ? `${((n / of) * 100).toFixed(1)}%` : "—");

for (const check of [...checks, null]) {
  const keys = check === null ? shared : shared.filter((k) => k.startsWith(`${check}|`));
  const t = { n: keys.length, old: 0, new: 0, moved: 0, fixed: 0, broke: 0 };
  for (const k of keys) {
    const o = older.rows[k];
    const n = newer.rows[k];
    if (o.agrees) t.old++;
    if (n.agrees) t.new++;
    if (o.dump !== n.dump) t.moved++;
    if (!o.agrees && n.agrees) t.fixed++;
    if (o.agrees && !n.agrees) t.broke++;
  }
  if (check === null) console.log(`  ${"-".repeat(head.length - 2)}`);
  const points = t.n ? ((t.new - t.old) / t.n) * 100 : 0;
  const delta = t.n ? `${points >= 0 ? "+" : ""}${points.toFixed(1)}%` : "—";
  console.log(
    `  ${(check ?? "ALL").padEnd(16)}${String(t.n).padStart(6)}${rate(t.old, t.n).padStart(9)}` +
      `${rate(t.new, t.n).padStart(9)}${delta.padStart(8)}   ` +
      `${String(t.moved).padStart(9)}${String(t.fixed).padStart(10)}${String(t.broke).padStart(10)}`,
  );
  if (check === null) Object.assign(all, t);
}

// The clean population is the one every headline percentage is quoted over: an
// exact name-and-frame mapping of a single-hit move. A row has to be clean in
// both trees to be comparable.
const clean = shared.filter((k) => older.rows[k].clean && newer.rows[k].clean);
const cleanOld = clean.filter((k) => older.rows[k].agrees).length;
const cleanNew = clean.filter((k) => newer.rows[k].agrees).length;
const cleanBad = clean.filter((k) => !older.rows[k].agrees);
console.log(
  `\n  clean population: ${clean.length} rows, ${rate(cleanOld, clean.length)} -> ${rate(cleanNew, clean.length)}`,
);
console.log(
  `  of its ${cleanBad.length} disagreements, ${cleanBad.filter((k) => newer.rows[k].agrees).length} are skew and ` +
    `${cleanBad.filter((k) => !newer.rows[k].agrees).length} survive the newer dump`,
);

// Every row whose value moved, named. This is the part worth reading twice: a
// row that agreed before and disagrees now is FAT lagging the game, not a bug.
const moved = shared.filter((k) => older.rows[k].dump !== newer.rows[k].dump);
console.log(`\n  ${moved.length} rows whose dumped value moved between the builds:\n`);
for (const k of moved.sort()) {
  const o = older.rows[k];
  const n = newer.rows[k];
  const verdict = o.agrees === n.agrees ? (o.agrees ? "both agree" : "both disagree") : o.agrees ? "FAT lags" : "skew fixed";
  console.log(`    ${k.padEnd(42)} ${String(o.dump).padStart(7)} -> ${String(n.dump).padStart(7)}   FAT ${String(n.fat).padStart(7)}   ${verdict}`);
}
