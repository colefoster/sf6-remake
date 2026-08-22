import { loadGeometry } from "../../../src/data/load-geometry.js";
import { clockOf } from "../../../src/game/pose-library.js";
import { activeWindows } from "../../../src/data/geometry.js";

const geo = loadGeometry("ryu")!;
const names = [
  "ATK_5LP",
  "ATK_5MP",
  "ATK_5HP",
  "ATK_2LK",
  "ATK_2HK",
  "ATK_5HK",
  "ATK_8HK",
  "SPA_HADO",
  "SPA_SYORYU_START",
  "SPA_TATSUMAKI_END",
  "ATK_2MK_Y2",
];
for (const n of names) {
  const a = geo.actions.find((x) => x.name === n);
  if (!a) {
    console.log(n, "MISSING");
    continue;
  }
  console.log(
    n,
    "id",
    a.id,
    JSON.stringify(clockOf(a)),
    "windows",
    JSON.stringify(activeWindows(a)),
    "shots",
    JSON.stringify(a.shots ?? []),
  );
}
