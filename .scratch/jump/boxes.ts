import { loadGeometry } from "../../src/data/load-geometry.js";
import { hurtPartsAt, originAt, pushboxesAt } from "../../src/data/geometry.js";

const id = process.argv[2] ?? "ryu";
const geo = loadGeometry(id)!;
const names = process.argv.slice(3);
for (const n of names) {
  const act = geo.actions.find((a) => a.name === n);
  if (!act) {
    console.log(n, "MISSING");
    continue;
  }
  const A = act as unknown as Record<string, unknown>;
  console.log(`\n== ${act.name} id=${act.id} frames=${String(A.frames)} lands=${String(A.lands)} stance=${JSON.stringify(A.stance)}`);
  const end = Math.max(...act.hurt.map((h) => h.end ?? h.start ?? 1));
  for (let f = 1; f <= Math.min(end, 60); f++) {
    const p = hurtPartsAt(act, f);
    const o = originAt(act, f);
    const push = pushboxesAt(act, f);
    if (f % 6 === 1 || f === end) {
      const d = (bs: typeof p.body): string =>
        bs.map((b) => `[${b.x},${b.y}→${b.x + b.width},${b.y + b.height}]`).join("") || "-";
      console.log(
        `f${String(f).padStart(2)} o=(${o.x.toFixed(0)},${o.y.toFixed(0)}) H${d(p.head)} B${d(p.body)} L${d(p.leg)} P${d(push)}`,
      );
    }
  }
}
