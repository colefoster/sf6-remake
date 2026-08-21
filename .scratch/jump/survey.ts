import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { hurtPartsAt, stanceAt } from "../../src/data/geometry.js";

let total = 0;
const tally: Record<string, number> = {};
const eg: Record<string, string> = {};
const bump = (k: string, at: string): void => {
  tally[k] = (tally[k] ?? 0) + 1;
  eg[k] ??= at;
};
const airborneActions = new Set<string>();
const soloBodyActions = new Set<string>();
let soloBodyAir = 0;
let soloBodySpans: number[] = [];

for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    const arc = action.motion?.y;
    for (let f = 1; f <= end; f++) {
      const p = hurtPartsAt(action, f);
      total++;
      const st = stanceAt(action, f);
      const air = st === 3 || Boolean(arc && (arc[f - 1] ?? 0) > 17);
      if (air) {
        bump("airborne", `${id} ${action.name}`);
        airborneActions.add(`${id} ${action.name}`);
      }
      const solo = !p.head.length && !p.leg.length && p.body.length > 0;
      if (solo) {
        bump("body-only", `${id} ${action.name} f${f}`);
        soloBodyActions.add(`${id} ${action.name}`);
        if (air) soloBodyAir++;
        const lo = Math.min(...p.body.map((b) => b.y));
        const hi = Math.max(...p.body.map((b) => b.y + b.height));
        soloBodySpans.push(hi - lo);
      }
      if (air && !solo) bump("airborne-not-body-only", `${id} ${action.name} f${f}`);
      if (air && !p.body.length && !p.head.length && !p.leg.length) bump("airborne-no-box", `${id} ${action.name} f${f}`);
      if (!air && solo) bump("body-only-grounded", `${id} ${action.name} f${f}`);
    }
  }
}
console.log("frames total", total);
for (const k of Object.keys(tally).sort((a, b) => tally[b]! - tally[a]!))
  console.log(k.padEnd(26), String(tally[k]).padStart(8), " e.g.", eg[k]);
console.log("body-only frames that are airborne:", soloBodyAir);
console.log("body-only actions:", soloBodyActions.size, " airborne actions:", airborneActions.size);
soloBodySpans.sort((a, b) => a - b);
const q = (f: number): number => soloBodySpans[Math.floor(soloBodySpans.length * f)]!;
console.log("body-only span height p5/p50/p95:", q(0.05), q(0.5), q(0.95), "min", soloBodySpans[0], "max", soloBodySpans.at(-1));
