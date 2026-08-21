import { loadGeometry } from "../../src/data/load-geometry.js";
const g = loadGeometry("ryu")!;
console.log(g.actions.filter((a) => /SHORYU|SPA_/.test(a.name)).map((a) => a.name).join(" "));
const j = g.actions.find((a) => a.name === "BAS_JUMP_N_AIR")!;
const y = j.motion!.y!;
console.log("len", y.length);
console.log("arc:", y.map((v) => v.toFixed(0)).join(","));
console.log("diffs:", y.map((v, i) => (i ? (v - y[i - 1]!).toFixed(1) : "-")).join(","));
