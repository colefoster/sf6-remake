import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "seeds");
const src = join(dir, "sheets.b64.txt");
const raw = readFileSync(src, "utf8").replace(/^"|"$/g, "");
for (const line of raw.split(/\\n|\n/)) {
  const i = line.indexOf("|");
  if (i < 0) continue;
  const name = line.slice(0, i).trim();
  const b64 = line.slice(i + 1).trim();
  writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
  console.log(name, Buffer.from(b64, "base64").length);
}
unlinkSync(src);
