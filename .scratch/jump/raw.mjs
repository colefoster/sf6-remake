import { readFileSync } from "node:fs";
const dir = process.argv[2] ?? "data/raw/mmdk/Ryu";
const id = process.argv[3] ?? "36";
const md = JSON.parse(readFileSync(`${dir}/moves_dict.json`, "utf8"));
const act = md[id] ?? md[String(id)];
console.log("keys:", Object.keys(act).join(" "));
const hit = act.HitBoxKey ?? act.DamageCollisionKey;
console.log(JSON.stringify(act.DamageCollisionKey, null, 1).slice(0, 4000));
