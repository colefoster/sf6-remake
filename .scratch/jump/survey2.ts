import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { hurtPartsAt, stanceAt } from "../../src/data/geometry.js";

// A "body-only" frame: the body key is the fighter's only hurt key. Group the
// actions those frames belong to, and say whether the *action* is airborne
// anywhere (stance 3, or an arc that ever leaves the floor).
const rows: { at: string; air: boolean; n: number; span: string }[] = [];
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    const arc = action.motion?.y;
    let n = 0;
    let air = Boolean(arc && Math.max(...arc) > 17);
    let span = "";
    for (let f = 1; f <= end; f++) {
      const p = hurtPartsAt(action, f);
      if (stanceAt(action, f) === 3) air = true;
      if (!p.head.length && !p.leg.length && p.body.length > 0) {
        n++;
        if (!span) {
          const lo = Math.min(...p.body.map((b) => b.y));
          const hi = Math.max(...p.body.map((b) => b.y + b.height));
          span = `${lo}-${hi}`;
        }
      }
    }
    if (n) rows.push({ at: `${id} ${action.name}`, air, n, span });
  }
}
const grounded = rows.filter((r) => !r.air);
console.log("actions with body-only frames:", rows.length, " of which never airborne:", grounded.length);
console.log("body-only frames on never-airborne actions:", grounded.reduce((a, r) => a + r.n, 0));
console.log("\nthe never-airborne ones:");
for (const r of grounded.sort((a, b) => b.n - a.n).slice(0, 40)) console.log(` ${String(r.n).padStart(4)}  ${r.span.padStart(9)}  ${r.at}`);
