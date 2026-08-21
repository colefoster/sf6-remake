import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius } from "../../src/game/render.js";
import { hurtPartsAt } from "../../src/data/geometry.js";

type B = { x: number; y: number; width: number; height: number };
const span = (bs: B[]): [number, number, number, number] | null =>
  bs.length
    ? [
        Math.min(...bs.map((b) => b.x)),
        Math.min(...bs.map((b) => b.y)),
        Math.max(...bs.map((b) => b.x + b.width)),
        Math.max(...bs.map((b) => b.y + b.height)),
      ]
    : null;

console.log(
  ["fighter", "stat", "grnd", "air", "air/stat", "airW", "grndW", "botOfStat", "r"].map((s) => s.padStart(9)).join(""),
);
const rows: number[][] = [];
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  const build = buildOf(geo);
  const radius = headRadius(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const sp = hurtPartsAt(stand, 1);
  const g = span([...sp.head, ...sp.body, ...sp.leg])!;
  const air = geo.actions.find((a) => a.name === "BAS_JUMP_N_AIR");
  if (!air) {
    console.log(id, "no jump");
    continue;
  }
  const ap = hurtPartsAt(air, 1);
  const a = span([...ap.head, ...ap.body, ...ap.leg])!;
  const nBoxes = ap.head.length + ap.body.length + ap.leg.length;
  const airH = a[3] - a[1];
  const grndH = g[3] - g[1];
  const stat = build.stature;
  rows.push([airH / stat, (a[2] - a[0]) / 2, (g[2] - g[0]) / 2, a[1] / stat]);
  console.log(
    [
      id,
      stat.toFixed(0),
      `${g[1]}-${g[3]}`,
      `${a[1]}-${a[3]}(${nBoxes})`,
      (airH / stat).toFixed(2),
      `${a[0]}..${a[2]}`,
      `${g[0]}..${g[2]}`,
      (a[1] / stat).toFixed(2),
      radius.toFixed(0),
    ]
      .map((s) => String(s).padStart(9))
      .join(""),
  );
}
const col = (i: number): string => {
  const v = rows.map((r) => r[i]!).sort((x, y) => x - y);
  return `${v[0]!.toFixed(2)} .. ${v.at(-1)!.toFixed(2)} (med ${v[Math.floor(v.length / 2)]!.toFixed(2)})`;
};
console.log("\nair height / idle stature :", col(0));
console.log("air box bottom / stature  :", col(3));
